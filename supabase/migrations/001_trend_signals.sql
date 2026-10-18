-- ════════════════════════════════════════════════════════════════════
-- 30X Trend Intelligence Engine — 001_trend_signals
-- Esquema relacional + índices para los filtros dinámicos de la ControlBar.
-- Espejo local: src/lib/db/supabase.ts (SQLITE_SCHEMA). Mantener sincronizados.
-- ════════════════════════════════════════════════════════════════════

-- gen_random_uuid() es nativo desde PostgreSQL 13 (Supabase usa 15+): no hace falta pgcrypto.

-- ── Señales de tendencia ────────────────────────────────────────────
create table if not exists public.trend_signals (
  id                 uuid primary key default gen_random_uuid(),
  fingerprint        text not null unique,              -- sha256(url canónica)

  -- Origen
  network            text not null check (network in ('youtube','linkedin','instagram','tiktok','web')),
  source             text not null check (source in ('youtube_api','tavily','google_cse','community')),
  url                text not null,
  query              text not null,

  -- Contenido
  title              text not null default '',
  excerpt            text not null default '',
  author_name        text,
  author_handle      text,
  author_url         text,
  thumbnail_url      text,
  language           text check (language in ('es','en','pt','other')),
  format_hint        text not null default 'unknown'
                     check (format_hint in ('short_vertical','long_video','reel','image_post','text_post','article','unknown')),
  published_at       timestamptz,

  -- A. Detección temprana (métricas deterministas)
  metrics            jsonb not null default '{}'::jsonb,
  views              bigint generated always as (nullif(metrics->>'views','')::bigint) stored,
  outlier_score      numeric(12,2),
  velocity_per_hour  numeric(14,2),
  author_weight      numeric(4,3) check (author_weight between 0 and 1),
  stage              text not null check (stage in ('emerging','peaking','saturated')),
  stage_score        smallint not null check (stage_score between 0 and 100),
  stage_evidence     jsonb not null default '{}'::jsonb,

  -- B + C. Inteligencia (Gemini)
  format_type        text,                               -- variable 2 de la autopsia (filtrable)
  jev_score          smallint check (jev_score between 0 and 100),
  priority_score     numeric(6,2) not null default 0,
  analysis           jsonb,                              -- TrendAnalysis completo
  analysis_status    text not null default 'pending' check (analysis_status in ('pending','analyzed','failed')),
  analysis_error     text,

  raw                jsonb not null default '{}'::jsonb,
  discovered_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),

  -- Búsqueda de texto libre (config 'simple' para mezclar español e inglés)
  search_vector      tsvector generated always as (
                       setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
                       setweight(to_tsvector('simple', coalesce(query,'')), 'B') ||
                       setweight(to_tsvector('simple', coalesce(excerpt,'')), 'C')
                     ) stored
);

comment on table  public.trend_signals is 'Piezas públicas detectadas por el motor 30X con métricas, etapa, autopsia 5D, JEV y guiones.';
comment on column public.trend_signals.outlier_score is 'views / promedio histórico de vistas del autor. NULL cuando la fuente no lo permite (SERP).';
comment on column public.trend_signals.author_weight is '0 = éxito explicado por el contenido, 1 = explicado por la audiencia del autor.';
comment on column public.trend_signals.priority_score is '0.5·JEV + 0.3·outlier normalizado + 0.2·peso de etapa (ver docs/ARCHITECTURE.md §4.4).';

-- ── Índices: uno por cada eje de la ControlBar + órdenes del Top 10 ──
create index if not exists trend_signals_network_published_idx on public.trend_signals (network, published_at desc nulls last);
create index if not exists trend_signals_stage_idx             on public.trend_signals (stage, priority_score desc);
create index if not exists trend_signals_format_idx            on public.trend_signals (format_type) where format_type is not null;
create index if not exists trend_signals_jev_idx               on public.trend_signals (jev_score desc nulls last);
create index if not exists trend_signals_priority_idx          on public.trend_signals (priority_score desc);
create index if not exists trend_signals_outlier_idx           on public.trend_signals (outlier_score desc nulls last);
create index if not exists trend_signals_velocity_idx          on public.trend_signals (velocity_per_hour desc nulls last);
create index if not exists trend_signals_published_idx         on public.trend_signals (published_at desc nulls last);
create index if not exists trend_signals_status_idx            on public.trend_signals (analysis_status) where analysis_status <> 'analyzed';
create index if not exists trend_signals_language_idx          on public.trend_signals (language);
create index if not exists trend_signals_search_idx            on public.trend_signals using gin (search_vector);

-- ── Bitácora de corridas de descubrimiento (auditoría de fuentes y cuota) ──
create table if not exists public.discovery_runs (
  id             uuid primary key default gen_random_uuid(),
  query          text not null,
  networks       text[] not null,
  window_days    smallint not null,
  sources        jsonb not null default '[]'::jsonb,     -- SourceReport[]
  signals_found  integer not null default 0,
  started_at     timestamptz not null,
  finished_at    timestamptz not null default now()
);

create index if not exists discovery_runs_started_idx on public.discovery_runs (started_at desc);

-- ── Seguridad ──
-- El acceso es exclusivamente server-side con la service role key (las API Routes de Next.js).
-- RLS activado sin políticas públicas: el anon key no puede leer ni escribir.
alter table public.trend_signals  enable row level security;
alter table public.discovery_runs enable row level security;
