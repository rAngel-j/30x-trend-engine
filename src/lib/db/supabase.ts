/**
 * Persistencia de señales con filtros dinámicos.
 * - Supabase (Postgres) si existen SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * - SQLite nativo (node:sqlite) como fallback automático para que nunca falle en local.
 * Esquema Postgres: supabase/migrations/001-004 (SQLITE_SCHEMA es su espejo).
 * Privacidad: no se guardan datos de identidad de autores (docs/ARCHITECTURE.md §7b-ter).
 * Perfiles: cada análisis pertenece a un perfil de marca (§7b-quinquies).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { optionalEnv } from "@/lib/env";
import { normalizeAdaptations } from "@/lib/intelligence/bilbao-adapter";
import { computePriority } from "@/lib/intelligence/trend-stage";
import { scrubIndexedTitle, scrubText } from "@/lib/privacy";
import { fingerprintUrl } from "@/lib/url";
import type {
  BrandProfile,
  BrandProfileInput,
  RadarResult,
  RadarRun,
  RadarTopic,
  SavedView,
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

export type NewRadarRun = Omit<RadarRun, "id" | "created_at">;
export type NewRadarTopic = Omit<RadarTopic, "id" | "run_id" | "representative">;

export interface TrendRepository {
  readonly kind: "supabase" | "sqlite";
  upsertSignals(signals: StagedSignal[]): Promise<TrendSignal[]>;
  /** Guarda el análisis y lo asigna al perfil de `analysis.profile`. */
  saveAnalysis(id: string, analysis: TrendAnalysis): Promise<TrendSignal>;
  markAnalysisFailed(id: string, error: string, profileId?: string): Promise<void>;
  /** Con `profileId`, un análisis de otro perfil se presenta como "sin analizar". */
  getSignal(id: string, profileId?: string): Promise<TrendSignal | null>;
  getSignalByUrl(url: string, profileId?: string): Promise<TrendSignal | null>;
  getSignalsByIds(ids: string[], profileId?: string): Promise<TrendSignal[]>;
  querySignals(filters: TrendFilters): Promise<TrendPage>;
  logDiscoveryRun(run: DiscoveryRunLog): Promise<void>;
  /** Borra señales de YouTube no refrescadas en `days` días (políticas de la YouTube API). Devuelve cuántas borró. */
  purgeExpiredYouTube(days?: number): Promise<number>;
  /** Guarda una corrida del Radar semanal con sus temas. */
  saveRadar(run: NewRadarRun, topics: NewRadarTopic[]): Promise<RadarResult>;
  /** Corrida concreta o la más reciente del perfil, con la pieza representativa de cada tema. */
  getRadar(runId?: string, profileId?: string): Promise<RadarResult | null>;

  // ── Perfiles de marca ──
  listProfiles(): Promise<BrandProfile[]>;
  getProfile(id: string): Promise<BrandProfile | null>;
  getDefaultProfile(): Promise<BrandProfile | null>;
  createProfile(input: BrandProfileInput, isDefault?: boolean): Promise<BrandProfile>;
  updateProfile(id: string, patch: Partial<BrandProfileInput>): Promise<BrandProfile>;
  deleteProfile(id: string): Promise<void>;
  /** Análisis guardados antes de existir los perfiles (para asignarlos al perfil por defecto). */
  listUnassignedAnalyses(): Promise<{ id: string; analysis: TrendAnalysis }[]>;
  assignRadarsWithoutProfile(profileId: string): Promise<void>;

  // ── Vistas guardadas ──
  listViews(profileId: string): Promise<SavedView[]>;
  createView(profileId: string, name: string, filters: TrendFilters): Promise<SavedView>;
  deleteView(id: string): Promise<void>;

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
/** Políticas de la YouTube API: los datos guardados se borran o refrescan en un máximo de 30 días. */
export const YOUTUBE_RETENTION_DAYS = 30;
const MAX_LIMIT = 100;

const LIST_COLUMNS = [
  "id", "fingerprint", "network", "source", "url", "query", "title", "excerpt",
  "language", "format_hint",
  "published_at", "metrics", "outlier_score", "velocity_per_hour", "author_weight",
  "stage", "stage_score", "stage_evidence", "format_type", "jev_score", "priority_score",
  "analysis", "analysis_status", "analysis_error", "analysis_profile_id", "raw", "discovered_at", "last_seen_at",
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

/** Análisis guardados: los guiones de versiones anteriores se leen con los nombres actuales. */
function parseAnalysis(value: unknown): TrendAnalysis | null {
  const analysis = parseJson<TrendAnalysis | null>(value, null);
  if (!analysis) return null;
  return { ...analysis, adaptations: normalizeAdaptations(analysis.adaptations) };
}

function rowToSignal(row: Record<string, unknown>, profileId?: string): TrendSignal {
  const signal: TrendSignal = {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    network: row.network as TrendSignal["network"],
    source: row.source as TrendSignal["source"],
    url: String(row.url),
    query: String(row.query),
    title: String(row.title ?? ""),
    excerpt: String(row.excerpt ?? ""),
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
    analysis: parseAnalysis(row.analysis),
    analysis_status: row.analysis_status as TrendSignal["analysis_status"],
    analysis_error: (row.analysis_error as string | null) ?? null,
    analysis_profile_id: (row.analysis_profile_id as string | null) ?? null,
    raw: parseJson(row.raw, {}),
    discovered_at: String(row.discovered_at),
    last_seen_at: String(row.last_seen_at),
  };
  return profileId ? maskForProfile(signal, profileId) : signal;
}

/** Un análisis hecho para otro perfil no vale para este: la pieza se presenta como "sin analizar". */
function maskForProfile(signal: TrendSignal, profileId: string): TrendSignal {
  if (signal.analysis_profile_id === profileId || (signal.analysis_status === "pending" && !signal.analysis)) return signal;
  return { ...signal, analysis: null, analysis_status: "pending", analysis_error: null, jev_score: null, format_type: null };
}

function rowToRadarRun(row: Record<string, unknown>): RadarRun {
  return {
    id: String(row.id),
    created_at: String(row.created_at),
    profile_id: (row.profile_id as string | null) ?? null,
    networks: parseJson(row.networks, []),
    seeds: parseJson(row.seeds, []),
    signals_found: toNumber(row.signals_found) ?? 0,
    sources: parseJson(row.sources, []),
    notes: parseJson(row.notes, []),
    took_ms: toNumber(row.took_ms) ?? 0,
  };
}

function rowToRadarTopic(row: Record<string, unknown>): RadarTopic {
  return {
    id: String(row.id),
    run_id: String(row.run_id),
    rank: toNumber(row.rank) ?? 0,
    label: String(row.label),
    thesis: String(row.thesis ?? ""),
    this_week: toNumber(row.this_week) ?? 0,
    last_week: toNumber(row.last_week) ?? 0,
    growth_index: toNumber(row.growth_index) ?? 0,
    volume_index: toNumber(row.volume_index) ?? 0,
    score: toNumber(row.score) ?? 0,
    stage: row.stage as RadarTopic["stage"],
    stage_score: toNumber(row.stage_score) ?? 0,
    stage_evidence: parseJson(row.stage_evidence, {} as RadarTopic["stage_evidence"]),
    jev_score: toNumber(row.jev_score),
    networks: parseJson(row.networks, []),
    representative_id: (row.representative_id as string | null) ?? null,
    member_ids: parseJson(row.member_ids, []),
  };
}

function rowToProfile(row: Record<string, unknown>): BrandProfile {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    audience: String(row.audience),
    topic_scope: String(row.topic_scope),
    personal_label: String(row.personal_label),
    brand_label: String(row.brand_label),
    dna: String(row.dna),
    seeds: parseJson(row.seeds, []),
    is_default: row.is_default === true || row.is_default === 1,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function rowToView(row: Record<string, unknown>): SavedView {
  return {
    id: String(row.id),
    profile_id: String(row.profile_id),
    name: String(row.name),
    filters: parseJson(row.filters, {}),
    created_at: String(row.created_at),
  };
}

function attachRepresentatives(topics: RadarTopic[], signals: TrendSignal[]): RadarTopic[] {
  const byId = new Map(signals.map((s) => [s.id, s]));
  return topics.map((t) => ({ ...t, representative: t.representative_id ? byId.get(t.representative_id) ?? null : null }));
}

function clampLimit(limit?: number): number {
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
}

function sinceIso(windowDays: number): string {
  return new Date(Date.now() - windowDays * 86_400_000).toISOString();
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "perfil"
  );
}

function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Filtros que dependen de la IA: con perfil activo, solo cuentan los análisis de ese perfil. */
function usesAiFilters(f: TrendFilters): boolean {
  return f.minJev !== undefined || f.maxJev !== undefined || Boolean(f.formats?.length) || f.sort === "jev";
}

// ── Supabase ───────────────────────────────────────────────────────

class SupabaseTrendRepository implements TrendRepository {
  readonly kind = "supabase" as const;
  constructor(private readonly client: SupabaseClient) {}

  private fail(error: { message: string } | null): void {
    if (error) throw new Error(`Supabase: ${error.message}`);
  }

  async upsertSignals(signals: StagedSignal[]): Promise<TrendSignal[]> {
    if (signals.length === 0) return [];
    const fingerprints = signals.map((s) => fingerprintUrl(s.url));
    const { data: existing, error: readError } = await this.client
      .from("trend_signals")
      .select("fingerprint, jev_score")
      .in("fingerprint", fingerprints);
    this.fail(readError);
    const jevByFingerprint = new Map(existing?.map((r) => [r.fingerprint as string, toNumber(r.jev_score)]));

    const rows = signals.map((s, i) => ingestRow(s, computePriority(s, jevByFingerprint.get(fingerprints[i]!) ?? null)));
    const { data, error } = await this.client
      .from("trend_signals")
      .upsert(rows, { onConflict: "fingerprint" })
      .select(LIST_COLUMNS.join(","));
    this.fail(error);
    return (data as unknown as Record<string, unknown>[]).map((r) => rowToSignal(r));
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
        analysis_profile_id: analysis.profile?.id ?? null,
      })
      .eq("id", id)
      .select(LIST_COLUMNS.join(","))
      .single();
    this.fail(error);
    return rowToSignal(data as unknown as Record<string, unknown>);
  }

  async markAnalysisFailed(id: string, message: string, profileId?: string): Promise<void> {
    const { error } = await this.client
      .from("trend_signals")
      .update({ analysis_status: "failed", analysis_error: message.slice(0, 1000), ...(profileId ? { analysis_profile_id: profileId } : {}) })
      .eq("id", id);
    this.fail(error);
  }

  async getSignal(id: string, profileId?: string): Promise<TrendSignal | null> {
    const { data, error } = await this.client.from("trend_signals").select(LIST_COLUMNS.join(",")).eq("id", id).maybeSingle();
    this.fail(error);
    return data ? rowToSignal(data as unknown as Record<string, unknown>, profileId) : null;
  }

  async getSignalByUrl(url: string, profileId?: string): Promise<TrendSignal | null> {
    const { data, error } = await this.client
      .from("trend_signals")
      .select(LIST_COLUMNS.join(","))
      .eq("fingerprint", fingerprintUrl(url))
      .maybeSingle();
    this.fail(error);
    return data ? rowToSignal(data as unknown as Record<string, unknown>, profileId) : null;
  }

  async getSignalsByIds(ids: string[], profileId?: string): Promise<TrendSignal[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.client.from("trend_signals").select(LIST_COLUMNS.join(",")).in("id", ids);
    this.fail(error);
    return (data as unknown as Record<string, unknown>[]).map((r) => rowToSignal(r, profileId));
  }

  async querySignals(filters: TrendFilters): Promise<TrendPage> {
    const limit = clampLimit(filters.limit);
    const offset = Math.max(filters.offset ?? 0, 0);
    const P = filters.profileId;
    let q = this.client.from("trend_signals").select(LIST_COLUMNS.join(","), { count: "exact" });

    if (filters.networks?.length) q = q.in("network", filters.networks);
    if (filters.stages?.length) q = q.in("stage", filters.stages);
    if (filters.formatHints?.length) q = q.in("format_hint", filters.formatHints);
    if (filters.formats?.length) q = q.in("format_type", filters.formats);
    if (filters.languages?.length) q = q.in("language", filters.languages);
    if (filters.minJev !== undefined) q = q.gte("jev_score", filters.minJev);
    if (filters.maxJev !== undefined) q = q.lte("jev_score", filters.maxJev);
    if (filters.minOutlier !== undefined) q = q.gte("outlier_score", filters.minOutlier);
    if (P && usesAiFilters(filters)) q = q.eq("analysis_profile_id", P);

    // Las condiciones OR se combinan en un solo árbol lógico de PostgREST: or=(and(or(…),or(…))).
    const orGroups: string[] = [];
    if (filters.statuses?.length) {
      if (P) {
        const parts: string[] = [];
        for (const s of filters.statuses) {
          if (s === "pending") parts.push(`analysis_status.eq.pending`, `analysis_profile_id.is.null`, `analysis_profile_id.neq.${P}`);
          else parts.push(`and(analysis_status.eq.${s},analysis_profile_id.eq.${P})`);
        }
        orGroups.push(parts.join(","));
      } else {
        q = q.in("analysis_status", filters.statuses);
      }
    }
    if (filters.windowDays) {
      const since = sinceIso(filters.windowDays);
      orGroups.push(`published_at.gte."${since}",and(published_at.is.null,discovered_at.gte."${since}")`);
    }
    if (orGroups.length === 1) q = q.or(orGroups[0]!);
    else if (orGroups.length > 1) q = q.or(`and(${orGroups.map((g) => `or(${g})`).join(",")})`);

    if (filters.search?.trim()) {
      q = q.textSearch("search_vector", filters.search.trim(), { type: "websearch", config: "simple" });
    }

    const { data, count, error } = await q
      .order(SORT_COLUMNS[filters.sort ?? "priority"], { ascending: false, nullsFirst: false })
      .order("discovered_at", { ascending: false })
      .range(offset, offset + limit - 1);
    this.fail(error);
    return { items: (data as unknown as Record<string, unknown>[]).map((r) => rowToSignal(r, P)), total: count ?? 0 };
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
    this.fail(error);
  }

  async purgeExpiredYouTube(days = YOUTUBE_RETENTION_DAYS): Promise<number> {
    const { count, error } = await this.client
      .from("trend_signals")
      .delete({ count: "exact" })
      .eq("network", "youtube")
      .lt("last_seen_at", sinceIso(days));
    this.fail(error);
    return count ?? 0;
  }

  async saveRadar(run: NewRadarRun, topics: NewRadarTopic[]): Promise<RadarResult> {
    const { data: runRow, error } = await this.client.from("radar_runs").insert(run).select("*").single();
    this.fail(error);
    const runId = String((runRow as Record<string, unknown>).id);
    if (topics.length) {
      const { error: topicError } = await this.client.from("radar_topics").insert(topics.map((t) => ({ ...t, run_id: runId })));
      this.fail(topicError);
    }
    return (await this.getRadar(runId))!;
  }

  async getRadar(runId?: string, profileId?: string): Promise<RadarResult | null> {
    let base = this.client.from("radar_runs").select("*");
    if (runId) base = base.eq("id", runId);
    else if (profileId) base = base.eq("profile_id", profileId);
    const { data: runs, error } = await base.order("created_at", { ascending: false }).limit(1);
    this.fail(error);
    const runRow = (runs as Record<string, unknown>[] | null)?.[0];
    if (!runRow) return null;
    const run = rowToRadarRun(runRow);
    const { data: topicRows, error: topicError } = await this.client.from("radar_topics").select("*").eq("run_id", run.id).order("rank");
    this.fail(topicError);
    const topics = (topicRows as Record<string, unknown>[]).map(rowToRadarTopic);
    const reps = await this.getSignalsByIds(topics.map((t) => t.representative_id).filter((id): id is string => Boolean(id)), run.profile_id ?? undefined);
    return { run, topics: attachRepresentatives(topics, reps) };
  }

  async listProfiles(): Promise<BrandProfile[]> {
    const { data, error } = await this.client.from("brand_profiles").select("*").order("is_default", { ascending: false }).order("name");
    this.fail(error);
    return (data as Record<string, unknown>[]).map(rowToProfile);
  }

  async getProfile(id: string): Promise<BrandProfile | null> {
    const { data, error } = await this.client.from("brand_profiles").select("*").eq("id", id).maybeSingle();
    this.fail(error);
    return data ? rowToProfile(data as Record<string, unknown>) : null;
  }

  async getDefaultProfile(): Promise<BrandProfile | null> {
    const { data, error } = await this.client.from("brand_profiles").select("*").eq("is_default", true).maybeSingle();
    this.fail(error);
    return data ? rowToProfile(data as Record<string, unknown>) : null;
  }

  async createProfile(input: BrandProfileInput, isDefault = false): Promise<BrandProfile> {
    const taken = new Set((await this.listProfiles()).map((p) => p.slug));
    const { data, error } = await this.client
      .from("brand_profiles")
      .insert({ ...input, slug: uniqueSlug(slugify(input.name), taken), is_default: isDefault })
      .select("*")
      .single();
    this.fail(error);
    return rowToProfile(data as Record<string, unknown>);
  }

  async updateProfile(id: string, patch: Partial<BrandProfileInput>): Promise<BrandProfile> {
    const { data, error } = await this.client
      .from("brand_profiles")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    this.fail(error);
    return rowToProfile(data as Record<string, unknown>);
  }

  async deleteProfile(id: string): Promise<void> {
    const { error } = await this.client.from("brand_profiles").delete().eq("id", id).eq("is_default", false);
    this.fail(error);
  }

  async listUnassignedAnalyses(): Promise<{ id: string; analysis: TrendAnalysis }[]> {
    const { data, error } = await this.client.from("trend_signals").select("id, analysis").is("analysis_profile_id", null).not("analysis", "is", null);
    this.fail(error);
    return (data as Record<string, unknown>[]).flatMap((r) => {
      const analysis = parseAnalysis(r.analysis);
      return analysis ? [{ id: String(r.id), analysis }] : [];
    });
  }

  async assignRadarsWithoutProfile(profileId: string): Promise<void> {
    const { error } = await this.client.from("radar_runs").update({ profile_id: profileId }).is("profile_id", null);
    this.fail(error);
  }

  async listViews(profileId: string): Promise<SavedView[]> {
    const { data, error } = await this.client.from("saved_views").select("*").eq("profile_id", profileId).order("created_at");
    this.fail(error);
    return (data as Record<string, unknown>[]).map(rowToView);
  }

  async createView(profileId: string, name: string, filters: TrendFilters): Promise<SavedView> {
    const { data, error } = await this.client.from("saved_views").insert({ profile_id: profileId, name, filters }).select("*").single();
    this.fail(error);
    return rowToView(data as Record<string, unknown>);
  }

  async deleteView(id: string): Promise<void> {
    const { error } = await this.client.from("saved_views").delete().eq("id", id);
    this.fail(error);
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
  analysis_profile_id TEXT,
  raw TEXT NOT NULL DEFAULT '{}',
  discovered_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ts_network_published ON trend_signals (network, published_at DESC);
CREATE INDEX IF NOT EXISTS ts_stage_priority ON trend_signals (stage, priority_score DESC);
CREATE INDEX IF NOT EXISTS ts_format ON trend_signals (format_type);
CREATE INDEX IF NOT EXISTS ts_format_hint ON trend_signals (format_hint);
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

CREATE TABLE IF NOT EXISTS radar_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  profile_id TEXT,
  networks TEXT NOT NULL,
  seeds TEXT NOT NULL,
  signals_found INTEGER NOT NULL DEFAULT 0,
  sources TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '[]',
  took_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rr_created ON radar_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS radar_topics (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES radar_runs(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  label TEXT NOT NULL,
  thesis TEXT NOT NULL DEFAULT '',
  this_week INTEGER NOT NULL,
  last_week INTEGER NOT NULL,
  growth_index REAL NOT NULL,
  volume_index REAL NOT NULL,
  score REAL NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('emerging','peaking','saturated')),
  stage_score INTEGER NOT NULL,
  stage_evidence TEXT NOT NULL DEFAULT '{}',
  jev_score INTEGER,
  networks TEXT NOT NULL DEFAULT '[]',
  representative_id TEXT,
  member_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS rt_run_rank ON radar_topics (run_id, rank);

CREATE TABLE IF NOT EXISTS brand_profiles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  audience TEXT NOT NULL,
  topic_scope TEXT NOT NULL,
  personal_label TEXT NOT NULL,
  brand_label TEXT NOT NULL,
  dna TEXT NOT NULL,
  seeds TEXT NOT NULL DEFAULT '[]',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS bp_single_default ON brand_profiles (is_default) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES brand_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sv_profile ON saved_views (profile_id, created_at);
`;

/** Columnas de identidad de versiones anteriores: se eliminan al abrir una base existente (privacidad). */
const LEGACY_IDENTITY_COLUMNS = ["author_name", "author_handle", "author_url", "thumbnail_url"];

const INGEST_COLUMNS = [
  "fingerprint", "network", "source", "url", "query", "title", "excerpt",
  "language", "format_hint",
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
      const columnsOf = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));

      // Privacidad: bases creadas con versiones anteriores pierden las columnas de identidad y los IDs en `raw`.
      const signalColumns = columnsOf("trend_signals");
      for (const col of LEGACY_IDENTITY_COLUMNS) if (signalColumns.has(col)) db.exec(`ALTER TABLE trend_signals DROP COLUMN ${col}`);
      db.exec(
        "UPDATE trend_signals SET raw = json_remove(raw, '$.submitted_by', '$.channel_id') " +
          "WHERE json_extract(raw, '$.submitted_by') IS NOT NULL OR json_extract(raw, '$.channel_id') IS NOT NULL",
      );
      // Perfiles: columnas añadidas después (bases de versiones anteriores).
      if (!signalColumns.has("analysis_profile_id")) db.exec("ALTER TABLE trend_signals ADD COLUMN analysis_profile_id TEXT");
      if (!columnsOf("radar_runs").has("profile_id")) db.exec("ALTER TABLE radar_runs ADD COLUMN profile_id TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS ts_profile_jev ON trend_signals (analysis_profile_id, jev_score DESC)");
      db.exec("CREATE INDEX IF NOT EXISTS rr_profile_created ON radar_runs (profile_id, created_at DESC)");

      // Textos guardados por versiones con una limpieza más débil (correos, teléfonos, enlaces, menciones).
      const suspicious = db
        .prepare("SELECT id, title, excerpt FROM trend_signals WHERE excerpt LIKE '%@%' OR excerpt LIKE '%http%' OR excerpt LIKE '%www.%' OR title LIKE '%@%' OR title IN ('Instagram','LinkedIn','TikTok')")
        .all() as { id: string; title: string; excerpt: string }[];
      const fix = db.prepare("UPDATE trend_signals SET title = ?, excerpt = ? WHERE id = ?");
      for (const row of suspicious) {
        const excerpt = scrubText(row.excerpt);
        const title = scrubIndexedTitle(row.title) || excerpt.slice(0, 120);
        if (title !== row.title || excerpt !== row.excerpt) fix.run(title, excerpt, row.id);
      }
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
         analysis_status = 'analyzed', analysis_error = NULL, analysis_profile_id = ? WHERE id = ?`,
    ).run(
      JSON.stringify(analysis),
      analysis.forensic.format_type.label,
      analysis.jev.jev_latam_score,
      computePriority(current, analysis.jev.jev_latam_score),
      analysis.profile?.id ?? null,
      id,
    );
    return (await this.getSignal(id))!;
  }

  async markAnalysisFailed(id: string, message: string, profileId?: string): Promise<void> {
    const db = await this.db();
    if (profileId) {
      db.prepare("UPDATE trend_signals SET analysis_status = 'failed', analysis_error = ?, analysis_profile_id = ? WHERE id = ?").run(message.slice(0, 1000), profileId, id);
    } else {
      db.prepare("UPDATE trend_signals SET analysis_status = 'failed', analysis_error = ? WHERE id = ?").run(message.slice(0, 1000), id);
    }
  }

  async getSignal(id: string, profileId?: string): Promise<TrendSignal | null> {
    const db = await this.db();
    const row = db.prepare("SELECT * FROM trend_signals WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToSignal(row, profileId) : null;
  }

  async getSignalByUrl(url: string, profileId?: string): Promise<TrendSignal | null> {
    const db = await this.db();
    const row = db.prepare("SELECT * FROM trend_signals WHERE fingerprint = ?").get(fingerprintUrl(url)) as Record<string, unknown> | undefined;
    return row ? rowToSignal(row, profileId) : null;
  }

  async getSignalsByIds(ids: string[], profileId?: string): Promise<TrendSignal[]> {
    if (ids.length === 0) return [];
    const db = await this.db();
    const rows = db.prepare(`SELECT * FROM trend_signals WHERE id IN (${ids.map(() => "?").join(", ")})`).all(...ids) as Record<string, unknown>[];
    return rows.map((r) => rowToSignal(r, profileId));
  }

  async querySignals(filters: TrendFilters): Promise<TrendPage> {
    const db = await this.db();
    const P = filters.profileId;
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    const inClause = (column: string, values?: readonly string[]) => {
      if (!values?.length) return;
      where.push(`${column} IN (${values.map(() => "?").join(", ")})`);
      params.push(...values);
    };

    inClause("network", filters.networks);
    inClause("stage", filters.stages);
    inClause("format_hint", filters.formatHints);
    inClause("format_type", filters.formats);
    inClause("language", filters.languages);
    if (filters.statuses?.length) {
      if (P) {
        const parts: string[] = [];
        for (const s of filters.statuses) {
          if (s === "pending") {
            parts.push("(analysis_status = 'pending' OR analysis_profile_id IS NULL OR analysis_profile_id <> ?)");
            params.push(P);
          } else {
            parts.push("(analysis_status = ? AND analysis_profile_id = ?)");
            params.push(s, P);
          }
        }
        where.push(`(${parts.join(" OR ")})`);
      } else {
        inClause("analysis_status", filters.statuses);
      }
    }
    if (filters.minJev !== undefined) { where.push("jev_score >= ?"); params.push(filters.minJev); }
    if (filters.maxJev !== undefined) { where.push("jev_score <= ?"); params.push(filters.maxJev); }
    if (filters.minOutlier !== undefined) { where.push("outlier_score >= ?"); params.push(filters.minOutlier); }
    if (P && usesAiFilters(filters)) { where.push("analysis_profile_id = ?"); params.push(P); }
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
    return { items: rows.map((r) => rowToSignal(r, P)), total };
  }

  async logDiscoveryRun(run: DiscoveryRunLog): Promise<void> {
    const db = await this.db();
    db.prepare(
      `INSERT INTO discovery_runs (id, query, networks, window_days, sources, signals_found, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), run.query, JSON.stringify(run.networks), run.windowDays, JSON.stringify(run.sources), run.signalsFound, run.startedAt, new Date().toISOString());
  }

  async purgeExpiredYouTube(days = YOUTUBE_RETENTION_DAYS): Promise<number> {
    const db = await this.db();
    const res = db.prepare("DELETE FROM trend_signals WHERE network = 'youtube' AND last_seen_at < ?").run(sinceIso(days));
    return Number(res.changes);
  }

  async saveRadar(run: NewRadarRun, topics: NewRadarTopic[]): Promise<RadarResult> {
    const db = await this.db();
    const runId = randomUUID();
    db.exec("BEGIN");
    try {
      db.prepare(
        "INSERT INTO radar_runs (id, created_at, profile_id, networks, seeds, signals_found, sources, notes, took_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(runId, new Date().toISOString(), run.profile_id, JSON.stringify(run.networks), JSON.stringify(run.seeds), run.signals_found, JSON.stringify(run.sources), JSON.stringify(run.notes), run.took_ms);
      const insert = db.prepare(
        `INSERT INTO radar_topics (id, run_id, rank, label, thesis, this_week, last_week, growth_index, volume_index, score, stage, stage_score, stage_evidence, jev_score, networks, representative_id, member_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const t of topics) {
        insert.run(
          randomUUID(), runId, t.rank, t.label, t.thesis, t.this_week, t.last_week, t.growth_index, t.volume_index, t.score, t.stage, t.stage_score,
          JSON.stringify(t.stage_evidence), t.jev_score, JSON.stringify(t.networks), t.representative_id, JSON.stringify(t.member_ids),
        );
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return (await this.getRadar(runId))!;
  }

  async getRadar(runId?: string, profileId?: string): Promise<RadarResult | null> {
    const db = await this.db();
    const runRow = (runId
      ? db.prepare("SELECT * FROM radar_runs WHERE id = ?").get(runId)
      : profileId
        ? db.prepare("SELECT * FROM radar_runs WHERE profile_id = ? ORDER BY created_at DESC LIMIT 1").get(profileId)
        : db.prepare("SELECT * FROM radar_runs ORDER BY created_at DESC LIMIT 1").get()) as Record<string, unknown> | undefined;
    if (!runRow) return null;
    const run = rowToRadarRun(runRow);
    const topicRows = db.prepare("SELECT * FROM radar_topics WHERE run_id = ? ORDER BY rank").all(run.id) as Record<string, unknown>[];
    const topics = topicRows.map(rowToRadarTopic);
    const reps = await this.getSignalsByIds(topics.map((t) => t.representative_id).filter((id): id is string => Boolean(id)), run.profile_id ?? undefined);
    return { run, topics: attachRepresentatives(topics, reps) };
  }

  async listProfiles(): Promise<BrandProfile[]> {
    const db = await this.db();
    return (db.prepare("SELECT * FROM brand_profiles ORDER BY is_default DESC, name").all() as Record<string, unknown>[]).map(rowToProfile);
  }

  async getProfile(id: string): Promise<BrandProfile | null> {
    const db = await this.db();
    const row = db.prepare("SELECT * FROM brand_profiles WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToProfile(row) : null;
  }

  async getDefaultProfile(): Promise<BrandProfile | null> {
    const db = await this.db();
    const row = db.prepare("SELECT * FROM brand_profiles WHERE is_default = 1").get() as Record<string, unknown> | undefined;
    return row ? rowToProfile(row) : null;
  }

  async createProfile(input: BrandProfileInput, isDefault = false): Promise<BrandProfile> {
    const db = await this.db();
    const taken = new Set((await this.listProfiles()).map((p) => p.slug));
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO brand_profiles (id, slug, name, audience, topic_scope, personal_label, brand_label, dna, seeds, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, uniqueSlug(slugify(input.name), taken), input.name, input.audience, input.topic_scope, input.personal_label, input.brand_label, input.dna, JSON.stringify(input.seeds), isDefault ? 1 : 0, now, now);
    return (await this.getProfile(id))!;
  }

  async updateProfile(id: string, patch: Partial<BrandProfileInput>): Promise<BrandProfile> {
    const db = await this.db();
    const fields = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (fields.length) {
      const sets = fields.map(([k]) => `${k} = ?`).join(", ");
      const values = fields.map(([k, v]) => (k === "seeds" ? JSON.stringify(v) : (v as string)));
      db.prepare(`UPDATE brand_profiles SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, new Date().toISOString(), id);
    }
    const updated = await this.getProfile(id);
    if (!updated) throw new Error(`Perfil ${id} no encontrado`);
    return updated;
  }

  async deleteProfile(id: string): Promise<void> {
    const db = await this.db();
    db.prepare("DELETE FROM brand_profiles WHERE id = ? AND is_default = 0").run(id);
  }

  async listUnassignedAnalyses(): Promise<{ id: string; analysis: TrendAnalysis }[]> {
    const db = await this.db();
    const rows = db.prepare("SELECT id, analysis FROM trend_signals WHERE analysis_profile_id IS NULL AND analysis IS NOT NULL").all() as Record<string, unknown>[];
    return rows.flatMap((r) => {
      const analysis = parseAnalysis(r.analysis);
      return analysis ? [{ id: String(r.id), analysis }] : [];
    });
  }

  async assignRadarsWithoutProfile(profileId: string): Promise<void> {
    const db = await this.db();
    db.prepare("UPDATE radar_runs SET profile_id = ? WHERE profile_id IS NULL").run(profileId);
  }

  async listViews(profileId: string): Promise<SavedView[]> {
    const db = await this.db();
    return (db.prepare("SELECT * FROM saved_views WHERE profile_id = ? ORDER BY created_at").all(profileId) as Record<string, unknown>[]).map(rowToView);
  }

  async createView(profileId: string, name: string, filters: TrendFilters): Promise<SavedView> {
    const db = await this.db();
    const id = randomUUID();
    db.prepare("INSERT INTO saved_views (id, profile_id, name, filters, created_at) VALUES (?, ?, ?, ?, ?)").run(id, profileId, name, JSON.stringify(filters), new Date().toISOString());
    return rowToView(db.prepare("SELECT * FROM saved_views WHERE id = ?").get(id) as Record<string, unknown>);
  }

  async deleteView(id: string): Promise<void> {
    const db = await this.db();
    db.prepare("DELETE FROM saved_views WHERE id = ?").run(id);
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

/**
 * En hosting sin disco persistente (Vercel) solo /tmp admite escritura: la app arranca igual,
 * pero los datos se pierden entre despliegues. Para publicar se usa Supabase (docs/DEPLOY.md).
 */
function defaultSqlitePath(): string {
  const configured = optionalEnv("SQLITE_PATH");
  if (configured) return resolve(/*turbopackIgnore: true*/ process.cwd(), configured);
  if (process.env.VERCEL) return "/tmp/trends.db";
  return resolve(/*turbopackIgnore: true*/ process.cwd(), ".data/trends.db");
}

export function getTrendRepository(): TrendRepository {
  if (repository) return repository;
  const url = optionalEnv("SUPABASE_URL");
  const key = optionalEnv("SUPABASE_SERVICE_ROLE_KEY");
  repository =
    url && key
      ? new SupabaseTrendRepository(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }))
      : new SqliteTrendRepository(defaultSqlitePath());
  return repository;
}

/** Solo para tests / scripts: fuerza un repositorio SQLite en una ruta concreta. */
export function createSqliteRepository(path: string): TrendRepository {
  return new SqliteTrendRepository(path);
}
