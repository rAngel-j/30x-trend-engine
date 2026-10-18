/**
 * Orquestador del cerebro: forense ∥ JEV → adaptación solo si JEV ≥ umbral (docs/ARCHITECTURE.md §5).
 */
import { GEMINI_MODEL, JEV_ADAPT_THRESHOLD } from "@/lib/env";
import { adaptToBrandDna } from "./bilbao-adapter";
import { runForensic5D } from "./forensic-5d";
import { scoreJev } from "./jev-scorer";
import type { StagedSignal, TrendAnalysis } from "@/types/trends";

export { classifyCohort, computePriority, detectLanguage } from "./trend-stage";

export async function enrichSignal(signal: StagedSignal, content?: string): Promise<TrendAnalysis> {
  const [forensic, jev] = await Promise.all([runForensic5D(signal, content), scoreJev(signal, content)]);
  const adaptations = jev.jev_latam_score >= JEV_ADAPT_THRESHOLD() ? await adaptToBrandDna(signal, forensic, jev, content) : null;
  return { forensic, jev, adaptations, model: GEMINI_MODEL(), analyzed_at: new Date().toISOString() };
}
