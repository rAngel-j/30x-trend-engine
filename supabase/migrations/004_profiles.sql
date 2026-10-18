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
