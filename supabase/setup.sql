-- Lunes AI — esquema completo para Supabase.
-- Pega este archivo entero en Supabase → SQL Editor → Run. Es idempotente: se puede ejecutar más de una vez.
-- Generado a partir de supabase/migrations/001-004 (si cambias una migración, regenera este archivo).

-- ═══ 001_trend_signals.sql ═══
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

-- ═══ 002_privacy.sql ═══
-- ════════════════════════════════════════════════════════════════════
-- 30X Trend Intelligence Engine — 002_privacy
-- Restricción del reto: "solo contenido público y nada de datos personales".
-- El motor analiza piezas, no personas (docs/ARCHITECTURE.md §7b-ter).
-- ════════════════════════════════════════════════════════════════════

alter table public.trend_signals
  drop column if exists author_name,
  drop column if exists author_handle,
  drop column if exists author_url,
  drop column if exists thumbnail_url;

-- Identificadores de cuenta y de quien envió un enlace al Sensor.
update public.trend_signals
   set raw = raw - 'submitted_by' - 'channel_id'
 where raw ?| array['submitted_by', 'channel_id'];

comment on column public.trend_signals.metrics is 'Métricas de la pieza y cifras agregadas de la cuenta (seguidores, promedio). Sin identidad.';

-- ═══ 003_radar.sql ═══
-- ════════════════════════════════════════════════════════════════════
-- 30X Trend Intelligence Engine — 003_radar
-- Radar semanal: los 10 temas que más crecen (docs/ARCHITECTURE.md §7b-quater).
-- Espejo local: SQLITE_SCHEMA en src/lib/db/supabase.ts.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.radar_runs (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  networks       jsonb not null,
  seeds          jsonb not null,
  signals_found  integer not null default 0,
  sources        jsonb not null default '[]'::jsonb,
  notes          jsonb not null default '[]'::jsonb,
  took_ms        integer not null default 0
);

create index if not exists radar_runs_created_idx on public.radar_runs (created_at desc);

create table if not exists public.radar_topics (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references public.radar_runs(id) on delete cascade,
  rank               smallint not null,
  label              text not null,
  thesis             text not null default '',
  this_week          integer not null check (this_week >= 0),
  last_week          integer not null check (last_week >= 0),
  growth_index       numeric(5,1) not null check (growth_index between 0 and 100),
  volume_index       numeric(5,1) not null check (volume_index between 0 and 100),
  score              numeric(5,1) not null,
  stage              text not null check (stage in ('emerging','peaking','saturated')),
  stage_score        smallint not null,
  stage_evidence     jsonb not null default '{}'::jsonb,
  jev_score          smallint check (jev_score between 0 and 100),
  networks           jsonb not null default '[]'::jsonb,
  representative_id  uuid references public.trend_signals(id) on delete set null,
  member_ids         jsonb not null default '[]'::jsonb
);

create index if not exists radar_topics_run_rank_idx on public.radar_topics (run_id, rank);
create index if not exists radar_topics_stage_idx    on public.radar_topics (stage);

comment on table public.radar_topics is 'Temas del Radar semanal: crecimiento esta semana vs. la anterior, etapa, JEV y pieza representativa.';

alter table public.radar_runs   enable row level security;
alter table public.radar_topics enable row level security;

-- ═══ 004_profiles.sql ═══
-- ════════════════════════════════════════════════════════════════════
-- 30X Trend Intelligence Engine — 004_profiles
-- Perfiles de marca (hecho para 30X, útil para cualquier marca) y vistas guardadas.
-- docs/ARCHITECTURE.md §7b-quinquies y §7b-sexies. Espejo local: SQLITE_SCHEMA.
-- El perfil 30X por defecto lo crea la app al arrancar a partir de docs/30X_BRAND_DNA.md.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.brand_profiles (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  name            text not null check (char_length(name) between 2 and 60),
  audience        text not null,
  topic_scope     text not null,
  personal_label  text not null,
  brand_label     text not null,
  dna             text not null check (char_length(dna) between 200 and 40000),
  seeds           jsonb not null default '[]'::jsonb,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Un solo perfil por defecto.
create unique index if not exists brand_profiles_single_default on public.brand_profiles (is_default) where is_default;

-- Cada análisis pertenece a un perfil: el JEV de una pieza para 30X no vale para otra marca.
alter table public.trend_signals add column if not exists analysis_profile_id uuid references public.brand_profiles(id) on delete set null;
create index if not exists trend_signals_profile_jev_idx on public.trend_signals (analysis_profile_id, jev_score desc nulls last);
create index if not exists trend_signals_format_hint_idx on public.trend_signals (format_hint);

alter table public.radar_runs add column if not exists profile_id uuid references public.brand_profiles(id) on delete cascade;
create index if not exists radar_runs_profile_created_idx on public.radar_runs (profile_id, created_at desc);

create table if not exists public.saved_views (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.brand_profiles(id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 60),
  filters     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists saved_views_profile_idx on public.saved_views (profile_id, created_at);

alter table public.brand_profiles enable row level security;
alter table public.saved_views    enable row level security;
