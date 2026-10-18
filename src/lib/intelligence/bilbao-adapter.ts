/**
 * Adaptación al ADN del perfil de marca (pregunta C, parte 2):
 * Reel en la voz personal del perfil (p. ej. @andresbilbao) + carrusel en la voz de marca (p. ej. @30x).
 * Las reglas de estilo vienen del campo `dna` del perfil (docs/ARCHITECTURE.md §7b-quinquies).
 * El análisis en lote (batch-analyzer.ts) usa este esquema y su validador.
 */
import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import type { BrandAdaptations } from "@/types/trends";

const str = (description: string): Schema => ({ type: Type.STRING, description });

export const ADAPTATION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    personal_reel: {
      type: Type.OBJECT,
      description: "Guion de Reel en la VOZ PERSONAL del perfil, siguiendo su ADN.",
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
              line: str("Lo que dice la voz personal, textual."),
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
    brand_carousel: {
      type: Type.OBJECT,
      description: "Carrusel táctico en la VOZ DE MARCA del perfil, siguiendo su ADN.",
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
  required: ["personal_reel", "brand_carousel", "contrarian_angle", "publish_window"],
  propertyOrdering: ["personal_reel", "brand_carousel", "contrarian_angle", "publish_window"],
};

const text = z.string().trim().min(1);

export const AdaptationValidator = z.object({
  personal_reel: z.object({
    hook: text,
    beats: z.array(z.object({ second: z.number().int().min(0).max(90), line: text, on_screen_text: text })).min(4).max(10),
    cta: text,
    duration_seconds: z.number().int().min(15).max(90),
  }),
  brand_carousel: z.object({
    title: text,
    slides: z.array(z.object({ headline: text, body: text })).min(6).max(9),
    caption: text,
    cta: text,
  }),
  contrarian_angle: z.string().trim().min(1).nullable(),
  publish_window: text,
});

type LegacyAdaptations = Omit<BrandAdaptations, "personal_reel" | "brand_carousel"> & {
  andres_bilbao_reel?: BrandAdaptations["personal_reel"];
  x30_carousel?: BrandAdaptations["brand_carousel"];
  personal_reel?: BrandAdaptations["personal_reel"];
  brand_carousel?: BrandAdaptations["brand_carousel"];
};

/** Lee guiones guardados por versiones anteriores (andres_bilbao_reel / x30_carousel) con los nombres actuales. */
export function normalizeAdaptations(value: unknown): BrandAdaptations | null {
  if (!value || typeof value !== "object") return null;
  const a = value as LegacyAdaptations;
  const personal = a.personal_reel ?? a.andres_bilbao_reel;
  const brand = a.brand_carousel ?? a.x30_carousel;
  if (!personal || !brand) return null;
  return { personal_reel: personal, brand_carousel: brand, contrarian_angle: a.contrarian_angle ?? null, publish_window: a.publish_window ?? "" };
}
