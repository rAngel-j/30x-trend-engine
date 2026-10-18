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
