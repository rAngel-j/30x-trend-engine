/**
 * Orquestador del cerebro (docs/ARCHITECTURE.md §5.1). Todo pasa por el análisis en lote:
 * una pieza cuesta 2 solicitudes a Gemini (autopsia + JEV, y guiones si JEV ≥ umbral).
 */
import { analyzeBatch } from "./batch-analyzer";
import type { StagedSignal, TrendAnalysis } from "@/types/trends";

export { analyzeBatch, type BatchItem, type BatchOutcome } from "./batch-analyzer";
export { classifyCohort, computePriority, detectLanguage } from "./trend-stage";

export async function enrichSignal(signal: StagedSignal, content?: string): Promise<TrendAnalysis> {
  const [outcome] = await analyzeBatch([{ signal, content }]);
  if (!outcome?.ok) throw new Error(outcome?.error ?? "El análisis no devolvió resultado.");
  return outcome.analysis;
}
