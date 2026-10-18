/**
 * Llamadas del navegador a las API Routes. Sin dependencias de servidor:
 * este módulo solo importa tipos y constantes puras.
 */
import type { FormatType, Network, RadarResult, SourceReport, TrendFilters, TrendSignal } from "@/types/trends";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly payload: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { code: string; message: string } };
  if (!res.ok) {
    throw new ApiError(body.error?.code ?? "INTERNAL", body.error?.message ?? `Error HTTP ${res.status}`, res.status, body);
  }
  return body as T;
}

// ── Filtros ⇄ querystring ──────────────────────────────────────────

const LIST_KEYS = ["networks", "stages", "formats", "languages", "statuses"] as const;
const NUMBER_KEYS = ["windowDays", "minJev", "maxJev", "minOutlier", "limit", "offset"] as const;

export function filtersToQuery(filters: TrendFilters): string {
  const params = new URLSearchParams();
  for (const key of LIST_KEYS) {
    const value = filters[key];
    if (value?.length) params.set(key, value.join(","));
  }
  for (const key of NUMBER_KEYS) {
    const value = filters[key];
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.sort) params.set("sort", filters.sort);
  return params.toString();
}

export function queryToFilters(params: URLSearchParams): TrendFilters {
  const filters: Record<string, unknown> = {};
  for (const key of LIST_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value.split(",").filter(Boolean);
  }
  for (const key of NUMBER_KEYS) {
    const value = Number(params.get(key));
    if (params.has(key) && Number.isFinite(value)) filters[key] = value;
  }
  const search = params.get("search");
  if (search) filters.search = search;
  const sort = params.get("sort");
  if (sort) filters.sort = sort;
  return filters as TrendFilters;
}

// ── Endpoints ──────────────────────────────────────────────────────

export interface TrendPageResponse {
  items: TrendSignal[];
  total: number;
  repository: "supabase" | "sqlite";
}

export const listTrends = (filters: TrendFilters, signal?: AbortSignal) =>
  request<TrendPageResponse>(`/api/discover?${filtersToQuery(filters)}`, { signal });

export interface DiscoverResponse {
  items: TrendSignal[];
  total: number;
  sources: SourceReport[];
  queries: string[];
  notes?: string[];
  analysis: { requested: number; analyzed: number; failed: number; skipped_reason: string | null };
  repository: string;
  took_ms: number;
}

export const discover = (body: { query: string; networks: Network[]; windowDays: number; analyzeTop?: number }) =>
  request<DiscoverResponse>("/api/discover", { method: "POST", body: JSON.stringify(body) });

export interface AnalyzeUrlResponse {
  item: TrendSignal;
  providers: string[];
  warnings: string[];
  cached: boolean;
}

export const analyzeUrl = (body: { url: string; text?: string; force?: boolean } | { id: string; force?: boolean }) =>
  request<AnalyzeUrlResponse>("/api/analyze-url", { method: "POST", body: JSON.stringify(body) });

export type ExportTarget = "slack" | "notion" | "make";

export interface ExportOverrides {
  slackWebhookUrl?: string;
  makeWebhookUrl?: string;
  notionApiKey?: string;
  notionDatabaseId?: string;
}

export interface ExportResult {
  target: ExportTarget;
  status: "ok" | "disabled" | "error";
  message?: string;
  url?: string;
}

export const exportTrend = (id: string, targets: ExportTarget[], overrides: ExportOverrides) =>
  request<{ results: ExportResult[] }>("/api/export-30x", { method: "POST", body: JSON.stringify({ id, targets, overrides }) });

export interface ServerStatus {
  repository: "supabase" | "sqlite";
  sources: { youtube_api: boolean; tavily: boolean; google_cse: boolean; jina_key: boolean; meta_oembed: boolean };
  ai: { gemini: boolean; model: string; jev_threshold: number };
  exports: { slack: boolean; notion: boolean; make: boolean };
  webhook_secret: boolean;
}

export const getStatus = () => request<ServerStatus>("/api/status");

export const getBrandDna = () => request<{ content: string; updated_at: string; editable: boolean }>("/api/brand-dna");

export const saveBrandDna = (content: string) =>
  request<{ updated_at: string }>("/api/brand-dna", { method: "PUT", body: JSON.stringify({ content }) });

// ── Configuración local (solo este navegador) ──────────────────────

const OVERRIDES_KEY = "30x.exportOverrides";

export function loadOverrides(): ExportOverrides {
  try {
    const raw = window.localStorage.getItem(OVERRIDES_KEY);
    return raw ? (JSON.parse(raw) as ExportOverrides) : {};
  } catch {
    return {};
  }
}

export function storeOverrides(overrides: ExportOverrides): void {
  try {
    const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => typeof v === "string" && v.trim()));
    window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(clean));
  } catch {
    /* almacenamiento bloqueado: la exportación usa las variables del servidor */
  }
}

export type { FormatType };

// ── Radar semanal ──────────────────────────────────────────────────

export const getLatestRadar = () => request<RadarResult>("/api/radar");

export const runRadarNow = (body: { networks: Network[]; maxTopics?: number }) =>
  request<RadarResult>("/api/radar", { method: "POST", body: JSON.stringify(body) });
