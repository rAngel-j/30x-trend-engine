/**
 * Pasos de orquestación compartidos por las API Routes: analizar señales ya persistidas.
 */
import type { TrendRepository } from "@/lib/db/supabase";
import { optionalEnv } from "@/lib/env";
import { errorMessage } from "@/lib/errors";
import { mapWithConcurrency } from "@/lib/http";
import { enrichSignal } from "@/lib/intelligence/analyze";
import type { TrendSignal } from "@/types/trends";

const AI_CONCURRENCY = 3;

/** Aplica la retención de 30 días de YouTube. Nunca bloquea la petición si falla. */
export async function enforceRetention(repo: TrendRepository): Promise<void> {
  try {
    await repo.purgeExpiredYouTube();
  } catch (err) {
    console.warn("[retención] no se pudo purgar YouTube:", errorMessage(err));
  }
}

export const aiEnabled = () => Boolean(optionalEnv("GEMINI_API_KEY"));

/** Analiza una señal persistida; si falla, la marca como `failed` y devuelve el estado actualizado. */
export async function analyzeStoredSignal(repo: TrendRepository, signal: TrendSignal, content?: string): Promise<TrendSignal> {
  try {
    const analysis = await enrichSignal(signal, content);
    return await repo.saveAnalysis(signal.id, analysis);
  } catch (err) {
    const message = errorMessage(err);
    await repo.markAnalysisFailed(signal.id, message);
    return { ...signal, analysis_status: "failed", analysis_error: message };
  }
}

export interface AnalysisSummary {
  requested: number;
  analyzed: number;
  failed: number;
  skipped_reason: string | null;
}

/** Analiza las `top` señales pendientes con mayor prioridad. Devuelve las señales actualizadas por id. */
export async function analyzeTopPending(
  repo: TrendRepository,
  signals: TrendSignal[],
  top: number,
): Promise<{ updated: Map<string, TrendSignal>; summary: AnalysisSummary }> {
  const updated = new Map<string, TrendSignal>();
  if (top <= 0) return { updated, summary: { requested: 0, analyzed: 0, failed: 0, skipped_reason: null } };
  if (!aiEnabled()) {
    return { updated, summary: { requested: top, analyzed: 0, failed: 0, skipped_reason: "Falta GEMINI_API_KEY: las señales quedan como pending." } };
  }

  const candidates = signals
    .filter((s) => s.analysis_status !== "analyzed")
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, top);

  const results = await mapWithConcurrency(candidates, AI_CONCURRENCY, (s) => analyzeStoredSignal(repo, s));
  for (const r of results) updated.set(r.id, r);
  const analyzed = results.filter((r) => r.analysis_status === "analyzed").length;
  return {
    updated,
    summary: {
      requested: top,
      analyzed,
      failed: results.length - analyzed,
      skipped_reason: candidates.length === 0 ? "Todas las señales ya estaban analizadas." : null,
    },
  };
}
