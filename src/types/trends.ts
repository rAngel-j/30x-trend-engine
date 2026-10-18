/**
 * Contratos estrictos del 30X Trend Intelligence Engine.
 * Documentados en docs/API_CONTRACTS.md — cualquier cambio aquí se refleja allí.
 */

// ── Dimensiones de filtro ──────────────────────────────────────────

export const NETWORKS = ["youtube", "linkedin", "instagram", "tiktok", "web"] as const;
export type Network = (typeof NETWORKS)[number];

export const SOURCES = ["youtube_api", "tavily", "google_cse", "community"] as const;
export type SourceId = (typeof SOURCES)[number];

export const TREND_STAGES = ["emerging", "peaking", "saturated"] as const;
export type TrendStage = (typeof TREND_STAGES)[number];

export const LANGUAGES = ["es", "en", "pt", "other"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Pista de formato derivada de la fuente (antes de la autopsia de IA). */
export const FORMAT_HINTS = ["short_vertical", "long_video", "reel", "image_post", "text_post", "article", "unknown"] as const;
export type FormatHint = (typeof FORMAT_HINTS)[number];

/** Formato clasificado por la autopsia forense (variable 2). Filtrable en la UI. */
export const FORMAT_TYPES = [
  "carrusel_comparativo",
  "carrusel_paso_a_paso",
  "reel_pantalla_dividida_demo",
  "talking_head_subtitulos",
  "screen_recording_tutorial",
  "post_texto_estructurado",
  "video_largo_explicativo",
  "entrevista_o_podcast",
  "meme_o_humor",
  "otro",
] as const;
export type FormatType = (typeof FORMAT_TYPES)[number];

export const ANALYSIS_STATUSES = ["pending", "analyzed", "failed"] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

// ── Ingesta ────────────────────────────────────────────────────────

export interface SignalMetrics {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  /** Suscriptores / seguidores del autor (si la fuente lo expone). */
  author_followers: number | null;
  /** Promedio histórico de vistas por pieza del autor (YouTube). */
  author_avg_views: number | null;
  duration_seconds: number | null;
}

/** Señal normalizada que produce cualquier conector de src/lib/sources. */
export interface RawSignal {
  network: Network;
  source: SourceId;
  url: string;
  title: string;
  excerpt: string;
  author_name: string | null;
  author_handle: string | null;
  author_url: string | null;
  thumbnail_url: string | null;
  published_at: string | null; // ISO-8601
  language: Language | null;
  format_hint: FormatHint;
  metrics: SignalMetrics;
  /** views / promedio del autor. null si la fuente no permite calcularlo. */
  outlier_score: number | null;
  /** Vistas por hora desde la publicación. */
  velocity_per_hour: number | null;
  /** 0 = éxito explicado por el contenido · 1 = explicado por la audiencia del autor. */
  author_weight: number | null;
  /** Consulta de descubrimiento que la originó (o "community" para el sensor). */
  query: string;
  raw: Record<string, unknown>;
}

export interface StageEvidence {
  cohort_size: number;
  es_share: number;
  fresh_share: number;
  median_outlier: number | null;
  rule: string;
}

export interface StagedSignal extends RawSignal {
  stage: TrendStage;
  stage_score: number;
  stage_evidence: StageEvidence;
}

export interface SourceReport {
  source: SourceId;
  status: "ok" | "disabled" | "error";
  count: number;
  message?: string;
  quota_units?: number;
}

export interface DiscoveryRequest {
  query: string;
  networks: Network[];
  /** Ventana de búsqueda en días (1-90). */
  windowDays: number;
  /** Idioma de relevancia para YouTube (ISO 639-1). Por defecto ninguno: se busca global para detectar "emerging". */
  relevanceLanguage?: string;
  /** YouTube: "short" (≤ 4 min), "long" o "any". */
  youtubeFormat?: "any" | "short" | "long";
  maxPerSource?: number;
  /** Variantes extra de la consulta (p. ej. traducción al inglés). Se fusionan en una sola cohorte. */
  queryVariants?: string[];
}

export interface DiscoveryResult {
  signals: StagedSignal[];
  sources: SourceReport[];
}

// ── Inteligencia ───────────────────────────────────────────────────

export interface ForensicAutopsy {
  hook_analysis: {
    hook_text: string;
    mechanism: string;
    why_it_works: string;
  };
  format_type: {
    label: FormatType;
    description: string;
  };
  topic_angle: {
    thesis: string;
    pain_point: string;
  };
  timing_reason: {
    catalyst: string;
    why_this_week: string;
  };
  author_vs_content: {
    verdict: "author_driven" | "content_driven" | "balanced";
    explanation: string;
  };
}

export interface JevBreakdown {
  business_impact: number;
  practical_applicability: number;
  executive_clarity: number;
  rationale: string;
  red_flags: string[];
}

export interface JevResult {
  jev_latam_score: number;
  breakdown: JevBreakdown;
}

export interface BrandAdaptations {
  andres_bilbao_reel: {
    hook: string;
    beats: { second: number; line: string; on_screen_text: string }[];
    cta: string;
    duration_seconds: number;
  };
  x30_carousel: {
    title: string;
    slides: { headline: string; body: string }[];
    caption: string;
    cta: string;
  };
  contrarian_angle: string | null;
  publish_window: string;
}

export interface TrendAnalysis {
  forensic: ForensicAutopsy;
  jev: JevResult;
  adaptations: BrandAdaptations | null;
  model: string;
  analyzed_at: string;
}

// ── Persistencia y filtros ─────────────────────────────────────────

export interface TrendSignal extends StagedSignal {
  id: string;
  fingerprint: string;
  discovered_at: string;
  last_seen_at: string;
  format_type: FormatType | null;
  jev_score: number | null;
  priority_score: number;
  analysis_status: AnalysisStatus;
  analysis_error: string | null;
  analysis: TrendAnalysis | null;
}

export const SORT_KEYS = ["priority", "jev", "outlier", "recent", "velocity"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface TrendFilters {
  networks?: Network[];
  stages?: TrendStage[];
  formats?: FormatType[];
  languages?: Language[];
  statuses?: AnalysisStatus[];
  /** Solo señales publicadas en los últimos N días. */
  windowDays?: number;
  minJev?: number;
  maxJev?: number;
  minOutlier?: number;
  /** Texto libre sobre título, extracto y consulta. */
  search?: string;
  sort?: SortKey;
  limit?: number;
  offset?: number;
}

export interface TrendPage {
  items: TrendSignal[];
  total: number;
}
