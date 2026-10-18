/**
 * Orquestador del cerebro (docs/ARCHITECTURE.md §5.1). Todo pasa por el análisis en lote:
 * una pieza cuesta 2 solicitudes a Gemini (autopsia + JEV, y guiones si JEV ≥ umbral).
 * El perfil de marca define audiencia, voces y ADN (§7b-quinquies).
 */
import { analyzeBatch } from "./batch-analyzer";
import type { BrandProfile, StagedSignal, TrendAnalysis } from "@/types/trends";

export { analyzeBatch, profileRef, type BatchItem, type BatchOutcome } from "./batch-analyzer";
export { classifyCohort, computePriority, detectLanguage } from "./trend-stage";

export async function enrichSignal(signal: StagedSignal, profile: BrandProfile, content?: string): Promise<TrendAnalysis> {
  const [outcome] = await analyzeBatch([{ signal, content }], profile);
  if (!outcome?.ok) throw new Error(outcome?.error ?? "El análisis no devolvió resultado.");
  return outcome.analysis;
}
