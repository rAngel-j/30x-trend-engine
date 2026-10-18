/**
 * Pasos de orquestación compartidos por las API Routes: analizar señales ya persistidas.
 */
import type { TrendRepository } from "@/lib/db/supabase";
import { optionalEnv } from "@/lib/env";
import { errorMessage } from "@/lib/errors";
import { analyzeBatch, enrichSignal } from "@/lib/intelligence/analyze";
import type { TrendSignal } from "@/types/trends";


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

/** Analiza varias señales guardadas en un solo lote (2 solicitudes) y persiste cada resultado. */
export async function analyzeStoredBatch(
  repo: TrendRepository,
  signals: TrendSignal[],
  stages: Map<string, TrendSignal["stage"]> = new Map(),
): Promise<TrendSignal[]> {
  if (signals.length === 0) return [];
  const outcomes = await analyzeBatch(signals.map((signal) => ({ signal, stage: stages.get(signal.id) })));
  const results: TrendSignal[] = [];
  for (const [i, signal] of signals.entries()) {
    const outcome = outcomes[i];
    if (outcome?.ok) {
      results.push(await repo.saveAnalysis(signal.id, outcome.analysis));
    } else {
      const message = outcome?.error ?? "Sin resultado";
      await repo.markAnalysisFailed(signal.id, message);
      results.push({ ...signal, analysis_status: "failed", analysis_error: message });
    }
  }
  return results;
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

  const results = await analyzeStoredBatch(repo, candidates);
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
