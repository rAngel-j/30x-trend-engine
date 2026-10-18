/**
 * Detección temprana determinista (pregunta A del reto):
 * idioma por señal + etapa de la tendencia sobre la cohorte de una consulta.
 * Reglas documentadas en docs/ARCHITECTURE.md §4.3 y §4.4.
 */
import type { Language, RawSignal, StagedSignal, StageEvidence, TrendStage } from "@/types/trends";

// ── Idioma ─────────────────────────────────────────────────────────

const STOPWORDS: Record<Exclude<Language, "other">, Set<string>> = {
  es: new Set("el la los las de del que y en un una por para con no es se lo como más pero sus le ya o este esta son está cuando muy sin sobre también hasta hay donde desde todo nos tu tus te mi qué cómo porque ser hacer equipo empresa".split(" ")),
  en: new Set("the of and to in is that it for on with as was are be this by you at from or have an they which not but can your what all we will how their more if about so do our when".split(" ")),
  pt: new Set("o a os as de do da dos das que e em um uma para com não é se na no por mais mas como ao sua seu você isso está são também foi muito já quando nos pelo pela empresa equipe".split(" ")),
};

/** Heurística de stopwords. Devuelve null si el texto es demasiado corto para decidir. */
export function detectLanguage(text: string): Language | null {
  const words = text.toLowerCase().normalize("NFC").match(/\p{L}+/gu);
  if (!words || words.length < 4) return null;
  const counts = { es: 0, en: 0, pt: 0 };
  for (const w of words) {
    for (const lang of ["es", "en", "pt"] as const) if (STOPWORDS[lang].has(w)) counts[lang]++;
  }
  // Rasgos ortográficos que desempatan es/pt.
  if (/[ñ¿¡]/.test(text)) counts.es += 2;
  if (/[ãõç]|ção\b/.test(text)) counts.pt += 2;
  const [best, score] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] as [keyof typeof counts, number];
  if (score === 0) return "other";
  return score / words.length >= 0.04 ? best : "other";
}

/** Normaliza códigos como "es-419" o "en-US" que declara YouTube. */
export function normalizeLanguageCode(code: string | null | undefined): Language | null {
  const base = code?.toLowerCase().split(/[-_]/)[0];
  if (!base) return null;
  return base === "es" || base === "en" || base === "pt" ? base : "other";
}

// ── Etapa ──────────────────────────────────────────────────────────

const FRESH_HOURS = 72;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

export function evaluateStage(signals: RawSignal[], now = Date.now()): { stage: TrendStage; score: number; evidence: StageEvidence } {
  const withLanguage = signals.filter((s) => s.language && s.language !== "other");
  const esShare = withLanguage.length ? withLanguage.filter((s) => s.language === "es").length / withLanguage.length : 0;
  const dated = signals.filter((s) => s.published_at);
  const freshShare = dated.length
    ? dated.filter((s) => now - new Date(s.published_at!).getTime() <= FRESH_HOURS * 3_600_000).length / dated.length
    : 0;
  const medianOutlier = median(signals.map((s) => s.outlier_score).filter((v): v is number => v !== null));
  const total = signals.length;

  const evidence = (rule: string): StageEvidence => ({
    cohort_size: total,
    es_share: round(esShare),
    fresh_share: round(freshShare),
    median_outlier: medianOutlier === null ? null : round(medianOutlier),
    rule,
  });

  if (esShare >= 0.4 && (total >= 15 || freshShare < 0.25)) {
    // Más presencia en español y más volumen ⇒ más saturado.
    const score = Math.min(100, Math.round(50 + esShare * 40 + Math.min(total, 30) / 3));
    return { stage: "saturated", score, evidence: evidence(`es_share ${round(esShare)} ≥ 0.40 con ${total} piezas / fresh_share ${round(freshShare)}`) };
  }
  if (esShare < 0.15 && (freshShare >= 0.4 || (medianOutlier ?? 0) >= 3)) {
    const score = Math.min(100, Math.round(50 + (0.15 - esShare) * 150 + freshShare * 20 + Math.min(medianOutlier ?? 0, 10)));
    return { stage: "emerging", score, evidence: evidence(`es_share ${round(esShare)} < 0.15 con aceleración (fresh ${round(freshShare)}, outlier mediano ${medianOutlier ?? "n/d"})`) };
  }
  // Confianza de "peaking": mejor cuando hay frescura y el español aún es minoría.
  const score = Math.max(30, Math.min(100, Math.round(55 + freshShare * 30 - Math.abs(esShare - 0.25) * 40)));
  return { stage: "peaking", score, evidence: evidence(`tracción con hueco en español (es_share ${round(esShare)}, fresh ${round(freshShare)})`) };
}

/**
 * Asigna idioma (si falta) y etapa a toda la cohorte de una consulta.
 * La etapa describe el TEMA, por eso es la misma para todas las piezas de la cohorte.
 */
export function classifyCohort(signals: RawSignal[], now = Date.now()): StagedSignal[] {
  const withLanguage = signals.map((s) => ({ ...s, language: s.language ?? detectLanguage(`${s.title} ${s.excerpt}`) }));
  const { stage, score, evidence } = evaluateStage(withLanguage, now);
  return withLanguage.map((s) => ({ ...s, stage, stage_score: score, stage_evidence: evidence }));
}

// ── Prioridad (orden del Top 10) ───────────────────────────────────

const STAGE_WEIGHT: Record<TrendStage, number> = { emerging: 80, peaking: 100, saturated: 30 };

export function computePriority(signal: Pick<StagedSignal, "outlier_score" | "stage">, jevScore: number | null): number {
  const jev = jevScore ?? 50;
  const outlier = signal.outlier_score === null ? 50 : (Math.min(signal.outlier_score, 20) / 20) * 100;
  return round(0.5 * jev + 0.3 * outlier + 0.2 * STAGE_WEIGHT[signal.stage]);
}
