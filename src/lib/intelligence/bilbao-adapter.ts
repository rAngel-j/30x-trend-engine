/**
 * Adaptador al ADN de 30X (pregunta C, parte 2):
 * Reel para @andresbilbao (IG/TikTok) + Carrusel táctico para @30x (IG/LinkedIn).
 * Las reglas de estilo se leen de docs/30X_BRAND_DNA.md en cada llamada (editable sin desplegar).
 */
import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import { describeSignal, generateStructured, GROUNDING_RULES, loadBrandDna } from "./gemini-client";
import type { BrandAdaptations, ForensicAutopsy, JevResult, StagedSignal } from "@/types/trends";

const str = (description: string): Schema => ({ type: Type.STRING, description });

export const ADAPTATION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    andres_bilbao_reel: {
      type: Type.OBJECT,
      description: "Guion de Reel para @andresbilbao siguiendo el ADN §3.",
      properties: {
        hook: str("Gancho de ≤ 12 palabras para los primeros 3 segundos."),
        beats: {
          type: Type.ARRAY,
          minItems: "4",
          maxItems: "10",
          description: "Guion segundo a segundo: Gancho → Tensión → Insight → Acción → CTA.",
          items: {
            type: Type.OBJECT,
            properties: {
              second: { type: Type.INTEGER, minimum: 0, maximum: 90, description: "Segundo en que empieza el bloque." },
              line: str("Lo que dice Andrés, textual."),
              on_screen_text: str("Texto en pantalla, máximo 6 palabras."),
            },
            required: ["second", "line", "on_screen_text"],
            propertyOrdering: ["second", "line", "on_screen_text"],
          },
        },
        cta: str("Llamado a la acción final."),
        duration_seconds: { type: Type.INTEGER, minimum: 15, maximum: 90 },
      },
      required: ["hook", "beats", "cta", "duration_seconds"],
      propertyOrdering: ["hook", "beats", "cta", "duration_seconds"],
    },
    x30_carousel: {
      type: Type.OBJECT,
      description: "Carrusel táctico para @30x siguiendo el ADN §4.",
      properties: {
        title: str("Promesa concreta de la slide 1."),
        slides: {
          type: Type.ARRAY,
          minItems: "6",
          maxItems: "9",
          items: {
            type: Type.OBJECT,
            properties: {
              headline: str("Titular ≤ 8 palabras."),
              body: str("Cuerpo ≤ 30 palabras."),
            },
            required: ["headline", "body"],
            propertyOrdering: ["headline", "body"],
          },
        },
        caption: str("Caption para LinkedIn/Instagram, 3-5 líneas, termina en pregunta, máx. 3 hashtags."),
        cta: str("CTA de la última slide."),
      },
      required: ["title", "slides", "caption", "cta"],
      propertyOrdering: ["title", "slides", "caption", "cta"],
    },
    contrarian_angle: {
      type: Type.STRING,
      nullable: true,
      description: "Ángulo contrarian defendible. OBLIGATORIO si la etapa es 'saturated'; null en otro caso si no aporta.",
    },
    publish_window: str("Cuándo publicar y por qué, según la etapa (p. ej. 'en las próximas 48 h: aún no hay piezas en español')."),
  },
  required: ["andres_bilbao_reel", "x30_carousel", "contrarian_angle", "publish_window"],
  propertyOrdering: ["andres_bilbao_reel", "x30_carousel", "contrarian_angle", "publish_window"],
};

const text = z.string().trim().min(1);

export const AdaptationValidator = z.object({
  andres_bilbao_reel: z.object({
    hook: text,
    beats: z.array(z.object({ second: z.number().int().min(0).max(90), line: text, on_screen_text: text })).min(4).max(10),
    cta: text,
    duration_seconds: z.number().int().min(15).max(90),
  }),
  x30_carousel: z.object({
    title: text,
    slides: z.array(z.object({ headline: text, body: text })).min(6).max(9),
    caption: text,
    cta: text,
  }),
  contrarian_angle: z.string().trim().min(1).nullable(),
  publish_window: text,
});

function saturatedValidator(stage: StagedSignal["stage"]): z.ZodType<BrandAdaptations> {
  return stage === "saturated"
    ? AdaptationValidator.refine((a) => a.contrarian_angle !== null, {
        message: "contrarian_angle es obligatorio para tendencias saturadas",
        path: ["contrarian_angle"],
      })
    : AdaptationValidator;
}

export async function adaptToBrandDna(
  signal: StagedSignal,
  forensic: ForensicAutopsy,
  jev: JevResult,
  content?: string,
): Promise<BrandAdaptations> {
  const dna = await loadBrandDna();
  const autopsy = JSON.stringify({ forensic, jev_latam_score: jev.jev_latam_score, jev_rationale: jev.breakdown.rationale }, null, 2);

  return generateStructured({
    task: "bilbao-adapter",
    system: `Eres el guionista principal de 30X. Adaptas la MECÁNICA de piezas que funcionaron (gancho, formato, tesis) al ADN de @andresbilbao y @30x.
Nunca copias el texto original: reescribes desde cero para ejecutivos y equipos de Latinoamérica.
${GROUNDING_RULES}

ADN DE MARCA (cumplimiento obligatorio):
${dna}`,
    prompt: `Etapa de la tendencia: ${signal.stage}. ${signal.stage === "saturated" ? "Es OBLIGATORIO entregar un contrarian_angle." : ""}

AUTOPSIA YA REALIZADA:
${autopsy}

FICHA DE LA PIEZA REFERENTE:
${describeSignal(signal, content)}

Genera el Reel para @andresbilbao, el carrusel para @30x, el ángulo contrarian y la ventana de publicación.`,
    schema: ADAPTATION_SCHEMA,
    validator: saturatedValidator(signal.stage),
    temperature: 0.8,
  });
}
