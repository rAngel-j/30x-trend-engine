/**
 * Matriz JEV (pregunta C, parte 1): encaje de una pieza con la audiencia del perfil de marca
 * (en 30X: ejecutivos, líderes y equipos de LatAm aprendiendo IA). Gemini puntúa y argumenta cada criterio;
 * la ponderación final es determinista (docs/30X_BRAND_DNA.md §2). La llamada la hace batch-analyzer.ts.
 */
import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import type { JevResult } from "@/types/trends";

export const JEV_WEIGHTS = { business_impact: 0.4, practical_applicability: 0.35, executive_clarity: 0.25 } as const;

const score = (description: string): Schema => ({ type: Type.INTEGER, minimum: 0, maximum: 100, description });

export const JEV_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    business_impact: score("Impacto en negocio / resultados para la audiencia del perfil (0-100)."),
    practical_applicability: score("Aplicabilidad práctica para esa audiencia con sus recursos reales, sin un equipo técnico grande (0-100)."),
    executive_clarity: score("Claridad: esa audiencia lo entiende en 30 s sin jerga (0-100)."),
    rationale: { type: Type.STRING, description: "Justificación breve de los 3 puntajes (3-5 frases)." },
    red_flags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Banderas rojas detectadas según el ADN (vacío si no hay).",
    },
  },
  required: ["business_impact", "practical_applicability", "executive_clarity", "rationale", "red_flags"],
  propertyOrdering: ["business_impact", "practical_applicability", "executive_clarity", "rationale", "red_flags"],
};

const points = z.number().int().min(0).max(100);
export const JevValidator = z.object({
  business_impact: points,
  practical_applicability: points,
  executive_clarity: points,
  rationale: z.string().trim().min(1),
  red_flags: z.array(z.string().trim().min(1)).max(10),
});

export function weightJev(b: Pick<JevResult["breakdown"], keyof typeof JEV_WEIGHTS>): number {
  return Math.round(
    b.business_impact * JEV_WEIGHTS.business_impact +
      b.practical_applicability * JEV_WEIGHTS.practical_applicability +
      b.executive_clarity * JEV_WEIGHTS.executive_clarity,
  );
}
