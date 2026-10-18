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
