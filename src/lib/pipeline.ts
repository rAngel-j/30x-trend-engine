/**
 * Pasos de orquestación compartidos por las API Routes: analizar señales ya persistidas
 * con el perfil de marca activo (docs/ARCHITECTURE.md §5.1 y §7b-quinquies).
 */
import type { TrendRepository } from "@/lib/db/supabase";
import { optionalEnv } from "@/lib/env";
import { errorMessage } from "@/lib/errors";
import { analyzeBatch, enrichSignal } from "@/lib/intelligence/analyze";
import type { BrandProfile, TrendSignal } from "@/types/trends";

/** Aplica la retención de 30 días de YouTube. Nunca bloquea la petición si falla. */
export async function enforceRetention(repo: TrendRepository): Promise<void> {
  try {
    await repo.purgeExpiredYouTube();
  } catch (err) {
    console.warn("[retención] no se pudo purgar YouTube:", errorMessage(err));
  }
}

export const aiEnabled = () => Boolean(optionalEnv("GEMINI_API_KEY"));

/** ¿La pieza ya tiene un análisis válido para este perfil? */
export const analyzedFor = (signal: TrendSignal, profile: BrandProfile) =>
  signal.analysis_status === "analyzed" && signal.analysis_profile_id === profile.id;

/** Analiza una señal persistida; si falla, la marca como `failed` y devuelve el estado actualizado. */
export async function analyzeStoredSignal(repo: TrendRepository, signal: TrendSignal, profile: BrandProfile, content?: string): Promise<TrendSignal> {
  try {
    const analysis = await enrichSignal(signal, profile, content);
    return await repo.saveAnalysis(signal.id, analysis);
  } catch (err) {
    const message = errorMessage(err);
    await repo.markAnalysisFailed(signal.id, message, profile.id);
    return { ...signal, analysis: null, jev_score: null, format_type: null, analysis_status: "failed", analysis_error: message, analysis_profile_id: profile.id };
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
  profile: BrandProfile,
  stages: Map<string, TrendSignal["stage"]> = new Map(),
): Promise<TrendSignal[]> {
  if (signals.length === 0) return [];
  const outcomes = await analyzeBatch(signals.map((signal) => ({ signal, stage: stages.get(signal.id) })), profile);
  const results: TrendSignal[] = [];
  for (const [i, signal] of signals.entries()) {
    const outcome = outcomes[i];
    if (outcome?.ok) {
      results.push(await repo.saveAnalysis(signal.id, outcome.analysis));
    } else {
      const message = outcome?.error ?? "Sin resultado";
      await repo.markAnalysisFailed(signal.id, message, profile.id);
      results.push({ ...signal, analysis: null, jev_score: null, format_type: null, analysis_status: "failed", analysis_error: message, analysis_profile_id: profile.id });
    }
  }
  return results;
}

/** Analiza las `top` señales sin análisis para este perfil, por prioridad. Devuelve las señales actualizadas por id. */
export async function analyzeTopPending(
  repo: TrendRepository,
  signals: TrendSignal[],
  top: number,
  profile: BrandProfile,
): Promise<{ updated: Map<string, TrendSignal>; summary: AnalysisSummary }> {
  const updated = new Map<string, TrendSignal>();
  if (top <= 0) return { updated, summary: { requested: 0, analyzed: 0, failed: 0, skipped_reason: null } };
  if (!aiEnabled()) {
    return { updated, summary: { requested: top, analyzed: 0, failed: 0, skipped_reason: "Falta GEMINI_API_KEY: las señales quedan como pending." } };
  }

  const candidates = signals
    .filter((s) => !analyzedFor(s, profile))
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, top);

  const results = await analyzeStoredBatch(repo, candidates, profile);
  for (const r of results) updated.set(r.id, r);
  const analyzed = results.filter((r) => r.analysis_status === "analyzed").length;
  return {
    updated,
    summary: {
      requested: top,
      analyzed,
      failed: results.length - analyzed,
      skipped_reason: candidates.length === 0 ? "Todas las señales ya estaban analizadas para este perfil." : null,
    },
  };
}
