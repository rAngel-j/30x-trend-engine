/**
 * Crecimiento de un tema esta semana frente a la anterior (determinista y auditable).
 * Fórmulas: docs/ARCHITECTURE.md §7b-quater.
 */
import type { TrendSignal } from "@/types/trends";

const DAY = 86_400_000;

export interface TopicGrowth {
  this_week: number;
  last_week: number;
  /** 50 = estable; cada vez que se duplica suma 30 (acotado a 0-100). */
  growth_index: number;
  /** 10 puntos por pieza de esta semana (máx. 100). */
  volume_index: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeTopicGrowth(members: Pick<TrendSignal, "published_at">[], now = Date.now()): TopicGrowth {
  let thisWeek = 0;
  let lastWeek = 0;
  for (const m of members) {
    if (!m.published_at) continue; // sin fecha no cuenta para el crecimiento
    const age = now - new Date(m.published_at).getTime();
    if (age < 0) continue;
    if (age <= 7 * DAY) thisWeek++;
    else if (age <= 14 * DAY) lastWeek++;
  }
  return {
    this_week: thisWeek,
    last_week: lastWeek,
    growth_index: round1(clamp(50 + 30 * Math.log2((thisWeek + 1) / (lastWeek + 1)), 0, 100)),
    volume_index: round1(Math.min(100, 10 * thisWeek)),
  };
}

/** Puntaje final del tema. Sin JEV todavía, se asume 50 (neutro) para preseleccionar. */
export function topicScore(growth: Pick<TopicGrowth, "growth_index" | "volume_index">, jev: number | null): number {
  return round1(0.5 * growth.growth_index + 0.2 * growth.volume_index + 0.3 * (jev ?? 50));
}

/** Pieza que mejor representa el tema: la de mejor rendimiento relativo, preferentemente de esta semana. */
export function pickRepresentative(members: TrendSignal[], now = Date.now()): TrendSignal | null {
  if (members.length === 0) return null;
  const recent = members.filter((m) => m.published_at && now - new Date(m.published_at).getTime() <= 7 * DAY);
  const pool = recent.length ? recent : members;
  const strength = (s: TrendSignal) => [s.outlier_score ?? 0, s.metrics.views ?? s.metrics.likes ?? 0, s.analysis_status === "analyzed" ? 1 : 0];
  return [...pool].sort((a, b) => {
    const [ao, ae, aa] = strength(a);
    const [bo, be, ba] = strength(b);
    return bo! - ao! || be! - ae! || ba! - aa!;
  })[0]!;
}
