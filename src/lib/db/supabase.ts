/**
 * Persistencia de señales con filtros dinámicos.
 * - Supabase (Postgres) si existen SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * - SQLite nativo (node:sqlite) como fallback automático para que nunca falle en local.
 * Esquema Postgres: supabase/migrations/001_trend_signals.sql (SQLITE_SCHEMA es su espejo).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { optionalEnv } from "@/lib/env";
import { computePriority } from "@/lib/intelligence/trend-stage";
import { fingerprintUrl } from "@/lib/url";
import type {
  SortKey,
  SourceReport,
  StagedSignal,
  TrendAnalysis,
  TrendFilters,
  TrendPage,
  TrendSignal,
} from "@/types/trends";

export interface DiscoveryRunLog {
  query: string;
  networks: string[];
  windowDays: number;
  sources: SourceReport[];
  signalsFound: number;
  startedAt: string;
}

export interface TrendRepository {
  readonly kind: "supabase" | "sqlite";
  upsertSignals(signals: StagedSignal[]): Promise<TrendSignal[]>;
  saveAnalysis(id: string, analysis: TrendAnalysis): Promise<TrendSignal>;
  markAnalysisFailed(id: string, error: string): Promise<void>;
  getSignal(id: string): Promise<TrendSignal | null>;
  getSignalByUrl(url: string): Promise<TrendSignal | null>;
  querySignals(filters: TrendFilters): Promise<TrendPage>;
  logDiscoveryRun(run: DiscoveryRunLog): Promise<void>;
  /** Libera conexiones (SQLite mantiene el archivo abierto). */
  close(): Promise<void>;
}

// ── Mapeo común ────────────────────────────────────────────────────

const SORT_COLUMNS: Record<SortKey, string> = {
  priority: "priority_score",
  jev: "jev_score",
  outlier: "outlier_score",
  recent: "published_at",
  velocity: "velocity_per_hour",
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const LIST_COLUMNS = [
  "id", "fingerprint", "network", "source", "url", "query", "title", "excerpt",
  "author_name", "author_handle", "author_url", "thumbnail_url", "language", "format_hint",
  "published_at", "metrics", "outlier_score", "velocity_per_hour", "author_weight",
  "stage", "stage_score", "stage_evidence", "format_type", "jev_score", "priority_score",
  "analysis", "analysis_status", "analysis_error", "raw", "discovered_at", "last_seen_at",
] as const;

/** Columnas que escribe la ingesta. El upsert nunca toca las de análisis. */
function ingestRow(signal: StagedSignal, priority: number) {
  return {
    fingerprint: fingerprintUrl(signal.url),
    network: signal.network,
    source: signal.source,
    url: signal.url,
    query: signal.query,
    title: signal.title,
    excerpt: signal.excerpt,
    author_name: signal.author_name,
    author_handle: signal.author_handle,
    author_url: signal.author_url,
    thumbnail_url: signal.thumbnail_url,
    language: signal.language,
    format_hint: signal.format_hint,
    published_at: signal.published_at ? new Date(signal.published_at).toISOString() : null,
    metrics: signal.metrics,
    outlier_score: signal.outlier_score,
    velocity_per_hour: signal.velocity_per_hour,
    author_weight: signal.author_weight,
    stage: signal.stage,
    stage_score: signal.stage_score,
    stage_evidence: signal.stage_evidence,
    priority_score: priority,
    raw: signal.raw,
    last_seen_at: new Date().toISOString(),
  };
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToSignal(row: Record<string, unknown>): TrendSignal {
  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    network: row.network as TrendSignal["network"],
    source: row.source as TrendSignal["source"],
    url: String(row.url),
    query: String(row.query),
    title: String(row.title ?? ""),
    excerpt: String(row.excerpt ?? ""),
    author_name: (row.author_name as string | null) ?? null,
    author_handle: (row.author_handle as string | null) ?? null,
    author_url: (row.author_url as string | null) ?? null,
    thumbnail_url: (row.thumbnail_url as string | null) ?? null,
    language: (row.language as TrendSignal["language"]) ?? null,
    format_hint: row.format_hint as TrendSignal["format_hint"],
    published_at: (row.published_at as string | null) ?? null,
    metrics: parseJson(row.metrics, {} as TrendSignal["metrics"]),
    outlier_score: toNumber(row.outlier_score),
    velocity_per_hour: toNumber(row.velocity_per_hour),
    author_weight: toNumber(row.author_weight),
    stage: row.stage as TrendSignal["stage"],
    stage_score: toNumber(row.stage_score) ?? 0,
    stage_evidence: parseJson(row.stage_evidence, {} as TrendSignal["stage_evidence"]),
    format_type: (row.format_type as TrendSignal["format_type"]) ?? null,
    jev_score: toNumber(row.jev_score),
    priority_score: toNumber(row.priority_score) ?? 0,
    analysis: parseJson<TrendAnalysis | null>(row.analysis, null),
    analysis_status: row.analysis_status as TrendSignal["analysis_status"],
    analysis_error: (row.analysis_error as string | null) ?? null,
    raw: parseJson(row.raw, {}),
    discovered_at: String(row.discovered_at),
    last_seen_at: String(row.last_seen_at),
  };
}

function clampLimit(limit?: number): number {
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
}

function sinceIso(windowDays: number): string {
  return new Date(Date.now() - windowDays * 86_400_000).toISOString();
}

// ── Supabase ───────────────────────────────────────────────────────

class SupabaseTrendRepository implements TrendRepository {
  readonly kind = "supabase" as const;
  constructor(private readonly client: SupabaseClient) {}

  async upsertSignals(signals: StagedSignal[]): Promise<TrendSignal[]> {
    if (signals.length === 0) return [];
    const fingerprints = signals.map((s) => fingerprintUrl(s.url));
    const { data: existing, error: readError } = await this.client
      .from("trend_signals")
      .select("fingerprint, jev_score")
      .in("fingerprint", fingerprints);
    if (readError) throw new Error(`Supabase: ${readError.message}`);
    const jevByFingerprint = new Map(existing?.map((r) => [r.fingerprint as string, toNumber(r.jev_score)]));

    const rows = signals.map((s, i) => ingestRow(s, computePriority(s, jevByFingerprint.get(fingerprints[i]!) ?? null)));
    const { data, error } = await this.client
      .from("trend_signals")
      .upsert(rows, { onConflict: "fingerprint" })
      .select(LIST_COLUMNS.join(","));
    if (error) throw new Error(`Supabase: ${error.message}`);
    return (data as unknown as Record<string, unknown>[]).map(rowToSignal);
  }

  async saveAnalysis(id: string, analysis: TrendAnalysis): Promise<TrendSignal> {
    const current = await this.getSignal(id);
    if (!current) throw new Error(`Señal ${id} no encontrada`);
    const { data, error } = await this.client
      .from("trend_signals")
      .update({
        analysis,
        format_type: analysis.forensic.format_type.label,
        jev_score: analysis.jev.jev_latam_score,
        priority_score: computePriority(current, analysis.jev.jev_latam_score),
        analysis_status: "analyzed",
        analysis_error: null,
      })
      .eq("id", id)
      .select(LIST_COLUMNS.join(","))
      .single();
    if (error) throw new Error(`Supabase: ${error.message}`);
    return rowToSignal(data as unknown as Record<string, unknown>);
  }

  async markAnalysisFailed(id: string, message: string): Promise<void> {
    const { error } = await this.client
      .from("trend_signals")
      .update({ analysis_status: "failed", analysis_error: message.slice(0, 1000) })
      .eq("id", id);
    if (error) throw new Error(`Supabase: ${error.message}`);
  }

  async getSignal(id: string): Promise<TrendSignal | null> {
    const { data, error } = await this.client.from("trend_signals").select(LIST_COLUMNS.join(",")).eq("id", id).maybeSingle();
    if (error) throw new Error(`Supabase: ${error.message}`);
    return data ? rowToSignal(data as unknown as Record<string, unknown>) : null;
  }

  async getSignalByUrl(url: string): Promise<TrendSignal | null> {
    const { data, error } = await this.client
      .from("trend_signals")
      .select(LIST_COLUMNS.join(","))
      .eq("fingerprint", fingerprintUrl(url))
      .maybeSingle();
    if (error) throw new Error(`Supabase: ${error.message}`);
    return data ? rowToSignal(data as unknown as Record<string, unknown>) : null;
  }

  async querySignals(filters: TrendFilters): Promise<TrendPage> {
    const limit = clampLimit(filters.limit);
    const offset = Math.max(filters.offset ?? 0, 0);
    let q = this.client.from("trend_signals").select(LIST_COLUMNS.join(","), { count: "exact" });

    if (filters.networks?.length) q = q.in("network", filters.networks);
    if (filters.stages?.length) q = q.in("stage", filters.stages);
    if (filters.formats?.length) q = q.in("format_type", filters.formats);
    if (filters.languages?.length) q = q.in("language", filters.languages);
    if (filters.statuses?.length) q = q.in("analysis_status", filters.statuses);
    if (filters.minJev !== undefined) q = q.gte("jev_score", filters.minJev);
    if (filters.maxJev !== undefined) q = q.lte("jev_score", filters.maxJev);
    if (filters.minOutlier !== undefined) q = q.gte("outlier_score", filters.minOutlier);
    if (filters.windowDays) {
      const since = sinceIso(filters.windowDays);
      q = q.or(`published_at.gte."${since}",and(published_at.is.null,discovered_at.gte."${since}")`);
    }
    if (filters.search?.trim()) {
      q = q.textSearch("search_vector", filters.search.trim(), { type: "websearch", config: "simple" });
    }

    const { data, count, error } = await q
      .order(SORT_COLUMNS[filters.sort ?? "priority"], { ascending: false, nullsFirst: false })
      .order("discovered_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(`Supabase: ${error.message}`);
    return { items: (data as unknown as Record<string, unknown>[]).map(rowToSignal), total: count ?? 0 };
  }

  async logDiscoveryRun(run: DiscoveryRunLog): Promise<void> {
    const { error } = await this.client.from("discovery_runs").insert({
      query: run.query,
      networks: run.networks,
      window_days: run.windowDays,
      sources: run.sources,
      signals_found: run.signalsFound,
      started_at: run.startedAt,
    });
    if (error) throw new Error(`Supabase: ${error.message}`);
  }

  async close(): Promise<void> {}
}

// ── SQLite (fallback local) ────────────────────────────────────────

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS trend_signals (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL CHECK (network IN ('youtube','linkedin','instagram','tiktok','web')),
  source TEXT NOT NULL CHECK (source IN ('youtube_api','tavily','google_cse','community')),
  url TEXT NOT NULL,
  query TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  author_name TEXT, author_handle TEXT, author_url TEXT, thumbnail_url TEXT,
  language TEXT CHECK (language IN ('es','en','pt','other')),
  format_hint TEXT NOT NULL DEFAULT 'unknown',
  published_at TEXT,
  metrics TEXT NOT NULL DEFAULT '{}',
  outlier_score REAL,
  velocity_per_hour REAL,
  author_weight REAL,
  stage TEXT NOT NULL CHECK (stage IN ('emerging','peaking','saturated')),
  stage_score INTEGER NOT NULL,
  stage_evidence TEXT NOT NULL DEFAULT '{}',
  format_type TEXT,
  jev_score INTEGER,
  priority_score REAL NOT NULL DEFAULT 0,
  analysis TEXT,
  analysis_status TEXT NOT NULL DEFAULT 'pending' CHECK (analysis_status IN ('pending','analyzed','failed')),
  analysis_error TEXT,
  raw TEXT NOT NULL DEFAULT '{}',
  discovered_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ts_network_published ON trend_signals (network, published_at DESC);
CREATE INDEX IF NOT EXISTS ts_stage_priority ON trend_signals (stage, priority_score DESC);
CREATE INDEX IF NOT EXISTS ts_format ON trend_signals (format_type);
CREATE INDEX IF NOT EXISTS ts_jev ON trend_signals (jev_score DESC);
CREATE INDEX IF NOT EXISTS ts_priority ON trend_signals (priority_score DESC);
CREATE INDEX IF NOT EXISTS ts_outlier ON trend_signals (outlier_score DESC);
CREATE INDEX IF NOT EXISTS ts_velocity ON trend_signals (velocity_per_hour DESC);
CREATE INDEX IF NOT EXISTS ts_published ON trend_signals (published_at DESC);
CREATE INDEX IF NOT EXISTS ts_status ON trend_signals (analysis_status);
CREATE INDEX IF NOT EXISTS ts_language ON trend_signals (language);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  networks TEXT NOT NULL,
  window_days INTEGER NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  signals_found INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);
`;

const INGEST_COLUMNS = [
  "fingerprint", "network", "source", "url", "query", "title", "excerpt",
  "author_name", "author_handle", "author_url", "thumbnail_url", "language", "format_hint",
  "published_at", "metrics", "outlier_score", "velocity_per_hour", "author_weight",
  "stage", "stage_score", "stage_evidence", "priority_score", "raw", "last_seen_at",
] as const;

const JSON_COLUMNS = new Set(["metrics", "stage_evidence", "raw", "analysis"]);

function sqliteValue(column: string, value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null;
  if (JSON_COLUMNS.has(column)) return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "string" || typeof value === "bigint") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return JSON.stringify(value);
}

class SqliteTrendRepository implements TrendRepository {
  readonly kind = "sqlite" as const;
  private dbPromise: Promise<DatabaseSync> | null = null;
  constructor(private readonly path: string) {}

  private db(): Promise<DatabaseSync> {
    this.dbPromise ??= (async () => {
      const { DatabaseSync } = await import("node:sqlite");
      mkdirSync(dirname(this.path), { recursive: true });
      const db = new DatabaseSync(this.path);
      db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
      db.exec(SQLITE_SCHEMA);
      return db;
    })();
    return this.dbPromise;
  }

  async upsertSignals(signals: StagedSignal[]): Promise<TrendSignal[]> {
    if (signals.length === 0) return [];
    const db = await this.db();
    const now = new Date().toISOString();
    const placeholders = INGEST_COLUMNS.map(() => "?").join(", ");
    const updates = INGEST_COLUMNS.filter((c) => c !== "fingerprint").map((c) => `${c} = excluded.${c}`).join(", ");
    const upsert = db.prepare(
      `INSERT INTO trend_signals (id, discovered_at, ${INGEST_COLUMNS.join(", ")})
       VALUES (?, ?, ${placeholders})
       ON CONFLICT(fingerprint) DO UPDATE SET ${updates}`,
    );
    const readJev = db.prepare("SELECT jev_score FROM trend_signals WHERE fingerprint = ?");
    const readBack = db.prepare(`SELECT * FROM trend_signals WHERE fingerprint = ?`);

    const stored: TrendSignal[] = [];
    db.exec("BEGIN");
    try {
      for (const signal of signals) {
        const fingerprint = fingerprintUrl(signal.url);
        const existingJev = toNumber((readJev.get(fingerprint) as { jev_score?: unknown } | undefined)?.jev_score);
        const row = ingestRow(signal, computePriority(signal, existingJev));
        upsert.run(randomUUID(), now, ...INGEST_COLUMNS.map((c) => sqliteValue(c, row[c])));
        stored.push(rowToSignal(readBack.get(fingerprint) as Record<string, unknown>));
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return stored;
  }

  async saveAnalysis(id: string, analysis: TrendAnalysis): Promise<TrendSignal> {
    const db = await this.db();
    const current = await this.getSignal(id);
    if (!current) throw new Error(`Señal ${id} no encontrada`);
    db.prepare(
      `UPDATE trend_signals SET analysis = ?, format_type = ?, jev_score = ?, priority_score = ?,
         analysis_status = 'analyzed', analysis_error = NULL WHERE id = ?`,
    ).run(
      JSON.stringify(analysis),
      analysis.forensic.format_type.label,
      analysis.jev.jev_latam_score,
      computePriority(current, analysis.jev.jev_latam_score),
      id,
    );
    return (await this.getSignal(id))!;
  }

  async markAnalysisFailed(id: string, message: string): Promise<void> {
    const db = await this.db();
    db.prepare("UPDATE trend_signals SET analysis_status = 'failed', analysis_error = ? WHERE id = ?").run(message.slice(0, 1000), id);
  }

  async getSignal(id: string): Promise<TrendSignal | null> {
    const db = await this.db();
    const row = db.prepare("SELECT * FROM trend_signals WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToSignal(row) : null;
  }

  async getSignalByUrl(url: string): Promise<TrendSignal | null> {
    const db = await this.db();
    const row = db.prepare("SELECT * FROM trend_signals WHERE fingerprint = ?").get(fingerprintUrl(url)) as Record<string, unknown> | undefined;
    return row ? rowToSignal(row) : null;
  }

  async querySignals(filters: TrendFilters): Promise<TrendPage> {
    const db = await this.db();
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    const inClause = (column: string, values?: readonly string[]) => {
      if (!values?.length) return;
      where.push(`${column} IN (${values.map(() => "?").join(", ")})`);
      params.push(...values);
    };

    inClause("network", filters.networks);
    inClause("stage", filters.stages);
    inClause("format_type", filters.formats);
    inClause("language", filters.languages);
    inClause("analysis_status", filters.statuses);
    if (filters.minJev !== undefined) { where.push("jev_score >= ?"); params.push(filters.minJev); }
    if (filters.maxJev !== undefined) { where.push("jev_score <= ?"); params.push(filters.maxJev); }
    if (filters.minOutlier !== undefined) { where.push("outlier_score >= ?"); params.push(filters.minOutlier); }
    if (filters.windowDays) {
      const since = sinceIso(filters.windowDays);
      where.push("(published_at >= ? OR (published_at IS NULL AND discovered_at >= ?))");
      params.push(since, since);
    }
    if (filters.search?.trim()) {
      for (const term of filters.search.trim().split(/\s+/).slice(0, 8)) {
        where.push("(title LIKE ? OR excerpt LIKE ? OR query LIKE ?)");
        const like = `%${term.replace(/[%_]/g, "")}%`;
        params.push(like, like, like);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sortColumn = SORT_COLUMNS[filters.sort ?? "priority"];
    const limit = clampLimit(filters.limit);
    const offset = Math.max(filters.offset ?? 0, 0);

    const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM trend_signals ${whereSql}`).get(...params) as { n: number }).n);
    const rows = db
      .prepare(
        `SELECT * FROM trend_signals ${whereSql}
         ORDER BY ${sortColumn} IS NULL, ${sortColumn} DESC, discovered_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Record<string, unknown>[];
    return { items: rows.map(rowToSignal), total };
  }

  async logDiscoveryRun(run: DiscoveryRunLog): Promise<void> {
    const db = await this.db();
    db.prepare(
      `INSERT INTO discovery_runs (id, query, networks, window_days, sources, signals_found, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), run.query, JSON.stringify(run.networks), run.windowDays, JSON.stringify(run.sources), run.signalsFound, run.startedAt, new Date().toISOString());
  }

  async close(): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    this.dbPromise = null;
    db.close();
  }
}

// ── Selector ───────────────────────────────────────────────────────

let repository: TrendRepository | null = null;

export function getTrendRepository(): TrendRepository {
  if (repository) return repository;
  const url = optionalEnv("SUPABASE_URL");
  const key = optionalEnv("SUPABASE_SERVICE_ROLE_KEY");
  repository =
    url && key
      ? new SupabaseTrendRepository(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }))
      : new SqliteTrendRepository(resolve(/*turbopackIgnore: true*/ process.cwd(), optionalEnv("SQLITE_PATH") ?? ".data/trends.db"));
  return repository;
}

/** Solo para tests / scripts: fuerza un repositorio SQLite en una ruta concreta. */
export function createSqliteRepository(path: string): TrendRepository {
  return new SqliteTrendRepository(path);
}
