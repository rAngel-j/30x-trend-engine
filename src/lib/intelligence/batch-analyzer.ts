/**
 * Cerebro en lote (docs/ARCHITECTURE.md §5.1): analiza N piezas con 2 solicitudes a Gemini en vez de 3·N.
 *   1) Autopsia 5D + Matriz JEV de todas las piezas.
 *   2) Guiones ADN de las que superan el umbral JEV.
 * Reutiliza los esquemas y reglas de forensic-5d, jev-scorer y bilbao-adapter, así que el resultado
 * tiene exactamente la misma forma que el análisis pieza por pieza.
 */
import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import { GEMINI_MODEL, JEV_ADAPT_THRESHOLD } from "@/lib/env";
import { errorMessage } from "@/lib/errors";
import { ADAPTATION_SCHEMA, AdaptationValidator } from "./bilbao-adapter";
import { FORENSIC_SCHEMA, forensicSystem, ForensicValidator, verdictFromWeight } from "./forensic-5d";
import { describeSignal, generateStructured, GROUNDING_RULES } from "./gemini-client";
import { JEV_SCHEMA, JevValidator, weightJev } from "./jev-scorer";
import type { AnalysisProfileRef, BrandAdaptations, BrandProfile, ForensicAutopsy, JevResult, StagedSignal, TrendAnalysis, TrendStage } from "@/types/trends";

/** Más piezas por lote empeoran la calidad y pueden cortar la respuesta. */
export const MAX_BATCH = 12;
/** Texto por pieza dentro de un lote (el lote completo debe caber cómodo en el contexto). */
const CONTENT_PER_ITEM = 2_500;

export interface BatchItem {
  signal: StagedSignal;
  content?: string;
  /** Etapa que manda para los guiones (en el radar, la del tema; por defecto, la de la pieza). */
  stage?: TrendStage;
}

const stageOf = (item: BatchItem): TrendStage => item.stage ?? item.signal.stage;

export type BatchOutcome = { ok: true; analysis: TrendAnalysis } | { ok: false; error: string };

const indexed = (inner: Schema, key: string, extra: Record<string, Schema> = {}): Schema => ({
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { index: { type: Type.INTEGER, description: "Número de la pieza tal como aparece en el prompt." }, ...extra, [key]: inner },
        required: ["index", ...Object.keys(extra), key],
        propertyOrdering: ["index", ...Object.keys(extra), key],
      },
    },
  },
  required: ["items"],
});

const AUTOPSY_SCHEMA = indexed(FORENSIC_SCHEMA, "forensic", { jev: JEV_SCHEMA });
const AutopsyValidator = z.object({ items: z.array(z.object({ index: z.number().int(), jev: JevValidator, forensic: ForensicValidator })) });

const SCRIPTS_SCHEMA = indexed(ADAPTATION_SCHEMA, "adaptations");
const ScriptsValidator = z.object({ items: z.array(z.object({ index: z.number().int(), adaptations: AdaptationValidator })) });

function block(i: number, item: BatchItem): string {
  const content = item.content ? item.content.slice(0, CONTENT_PER_ITEM) : undefined;
  return `══ PIEZA [${i}] ══\n${describeSignal(item.signal, content)}`;
}

export const profileRef = (p: BrandProfile): AnalysisProfileRef => ({ id: p.id, name: p.name, personal_label: p.personal_label, brand_label: p.brand_label });

export async function analyzeBatch(items: BatchItem[], profile: BrandProfile): Promise<BatchOutcome[]> {
  if (items.length === 0) return [];
  if (items.length > MAX_BATCH) {
    const head = await analyzeBatch(items.slice(0, MAX_BATCH), profile);
    return [...head, ...(await analyzeBatch(items.slice(MAX_BATCH), profile))];
  }

  const dna = profile.dna;
  const outcomes: BatchOutcome[] = items.map(() => ({ ok: false, error: "El modelo no devolvió análisis para esta pieza." }));

  // ── 1) Autopsia 5D + JEV de todas las piezas ──
  let autopsies: { forensic: ForensicAutopsy; jev: JevResult }[] = [];
  try {
    const res = await generateStructured({
      task: "batch-autopsy",
      system: `${forensicSystem(profile)}

Además eres el editor jefe de ${profile.name}: puntúas cada pieza con la Matriz JEV para su audiencia (${profile.audience}). Sé exigente: un 90+ significa que esa audiencia puede actuar sobre esto esta semana con sus recursos actuales.
Analiza CADA pieza por separado y devuelve un elemento por pieza con su número exacto.
${GROUNDING_RULES}

ADN DE MARCA Y MATRIZ JEV:
${dna}`,
      prompt: `Haz la autopsia de las 5 variables y puntúa la Matriz JEV de estas ${items.length} piezas.\n\n${items.map((it, i) => block(i, it)).join("\n\n")}`,
      schema: AUTOPSY_SCHEMA,
      validator: AutopsyValidator,
      temperature: 0.3,
    });
    for (const r of res.items) {
      const item = items[r.index];
      if (!item || autopsies[r.index]) continue;
      const verdict = verdictFromWeight(item.signal.author_weight);
      const forensic = verdict ? { ...r.forensic, author_vs_content: { ...r.forensic.author_vs_content, verdict } } : r.forensic;
      autopsies[r.index] = { forensic, jev: { jev_latam_score: weightJev(r.jev), breakdown: r.jev } };
    }
  } catch (err) {
    const message = errorMessage(err);
    return items.map(() => ({ ok: false, error: message }));
  }

  // ── 2) Guiones de las piezas que superan el umbral JEV ──
  const threshold = JEV_ADAPT_THRESHOLD();
  const eligible = items.map((_, i) => i).filter((i) => autopsies[i] && autopsies[i]!.jev.jev_latam_score >= threshold);
  const scripts = new Map<number, BrandAdaptations>();
  let scriptsError: string | null = null;
  if (eligible.length) {
    try {
      const res = await generateStructured({
        task: "batch-scripts",
        system: `Eres el guionista principal de ${profile.name}. Adaptas la MECÁNICA de piezas que funcionaron (gancho, formato, tesis) a dos voces:
- personal_reel: la voz personal ${profile.personal_label} (Reel).
- brand_carousel: la voz de marca ${profile.brand_label} (carrusel).
Nunca copias el texto original: reescribes desde cero para ${profile.audience}. Un elemento por pieza, con su número exacto.
Si la ETAPA QUE MANDA de una pieza es "saturated", su contrarian_angle es OBLIGATORIO.
${GROUNDING_RULES}

ADN DE MARCA (cumplimiento obligatorio):
${dna}`,
        prompt: `Genera el Reel para ${profile.personal_label}, el carrusel para ${profile.brand_label}, el ángulo contrarian y la ventana de publicación de cada pieza.\n\n${eligible
          .map((i) => `${block(i, items[i]!)}\nETAPA QUE MANDA: ${stageOf(items[i]!)}\nAUTOPSIA YA REALIZADA:\n${JSON.stringify({ forensic: autopsies[i]!.forensic, jev: autopsies[i]!.jev.jev_latam_score })}`)
          .join("\n\n")}`,
        schema: SCRIPTS_SCHEMA,
        validator: ScriptsValidator,
        temperature: 0.8,
      });
      for (const r of res.items) {
        const item = items[r.index];
        if (!item || !eligible.includes(r.index)) continue;
        // Regla de marca: tendencia saturada sin ángulo contrarian no se publica.
        if (stageOf(item) === "saturated" && !r.adaptations.contrarian_angle) continue;
        scripts.set(r.index, r.adaptations);
      }
    } catch (err) {
      scriptsError = errorMessage(err);
    }
  }

  const analyzedAt = new Date().toISOString();
  items.forEach((_, i) => {
    const a = autopsies[i];
    if (!a) return;
    // Si los guiones fallan, la autopsia (ya pagada) se guarda igual y se marca para regenerar los guiones.
    const scriptsMissing = eligible.includes(i) && !scripts.has(i) && scriptsError ? scriptsError : null;
    outcomes[i] = {
      ok: true,
      analysis: { forensic: a.forensic, jev: a.jev, adaptations: scripts.get(i) ?? null, scripts_error: scriptsMissing, profile: profileRef(profile), model: GEMINI_MODEL(), analyzed_at: analyzedAt },
    };
  });
  return outcomes;
}
