/**
 * Autopsia forense de las 5 variables (pregunta B: "¿por qué funcionó?").
 * Gancho · Formato · Tema · Momento · Autor vs. contenido.
 */
import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import { describeSignal, generateStructured, GROUNDING_RULES } from "./gemini-client";
import { FORMAT_TYPES, type ForensicAutopsy, type StagedSignal } from "@/types/trends";

const str = (description: string): Schema => ({ type: Type.STRING, description });

export const FORENSIC_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    hook_analysis: {
      type: Type.OBJECT,
      description: "Variable 1 — El Gancho: qué dijo o mostró en los primeros 3 segundos / primera línea.",
      properties: {
        hook_text: str("El gancho literal o descrito tal como aparece (primera línea o primeros 3 s)."),
        mechanism: str("Mecanismo psicológico: p. ej. dato contraintuitivo, promesa concreta, pregunta provocadora, curiosidad, prueba social, enemigo común."),
        why_it_works: str("Por qué ese gancho detiene el scroll de esta audiencia, en 1-2 frases."),
      },
      required: ["hook_text", "mechanism", "why_it_works"],
      propertyOrdering: ["hook_text", "mechanism", "why_it_works"],
    },
    format_type: {
      type: Type.OBJECT,
      description: "Variable 2 — El Formato.",
      properties: {
        label: { type: Type.STRING, enum: [...FORMAT_TYPES], description: "Categoría de formato más cercana." },
        description: str("Descripción concreta de la ejecución: estructura, ritmo, recursos visuales o de texto."),
      },
      required: ["label", "description"],
      propertyOrdering: ["label", "description"],
    },
    topic_angle: {
      type: Type.OBJECT,
      description: "Variable 3 — El Tema.",
      properties: {
        thesis: str("La tesis central en una frase."),
        pain_point: str("El dolor o deseo de la audiencia que activa."),
      },
      required: ["thesis", "pain_point"],
      propertyOrdering: ["thesis", "pain_point"],
    },
    timing_reason: {
      type: Type.OBJECT,
      description: "Variable 4 — El Momento.",
      properties: {
        catalyst: str("Coyuntura, lanzamiento, noticia o dolor operativo actual que lo empuja. Si no hay evidencia, dilo."),
        why_this_week: str("Por qué funciona ahora y no hace 3 meses, considerando la fecha de publicación y la etapa."),
      },
      required: ["catalyst", "why_this_week"],
      propertyOrdering: ["catalyst", "why_this_week"],
    },
    author_vs_content: {
      type: Type.OBJECT,
      description: "Variable 5 — Quién la publicó: peso del autor frente al mérito de la pieza.",
      properties: {
        verdict: { type: Type.STRING, enum: ["author_driven", "content_driven", "balanced"] },
        explanation: str("Justificación usando Outlier Score, peso del autor y seguidores cuando existan."),
      },
      required: ["verdict", "explanation"],
      propertyOrdering: ["verdict", "explanation"],
    },
  },
  required: ["hook_analysis", "format_type", "topic_angle", "timing_reason", "author_vs_content"],
  propertyOrdering: ["hook_analysis", "format_type", "topic_angle", "timing_reason", "author_vs_content"],
};

const text = z.string().trim().min(1);

export const ForensicValidator = z.object({
  hook_analysis: z.object({ hook_text: text, mechanism: text, why_it_works: text }),
  format_type: z.object({ label: z.enum(FORMAT_TYPES), description: text }),
  topic_angle: z.object({ thesis: text, pain_point: text }),
  timing_reason: z.object({ catalyst: text, why_this_week: text }),
  author_vs_content: z.object({ verdict: z.enum(["author_driven", "content_driven", "balanced"]), explanation: text }),
});

export const FORENSIC_SYSTEM = `Eres el analista forense de contenido de 30X, la escuela de IA para líderes de Latinoamérica.
Tu trabajo es explicar con rigor por qué una pieza de contenido funcionó, desglosando exactamente 5 variables.
${GROUNDING_RULES}
- Para "author_vs_content" usa los datos cuantitativos: Outlier Score alto y peso del autor bajo ⇒ el mérito es del contenido; Outlier ≈ 1 y peso alto ⇒ lo explica la audiencia del autor. Sin datos cuantitativos, razona con seguidores y engagement disponibles y declara la incertidumbre.`;

/** Con datos cuantitativos, el veredicto de autor se fija de forma determinista (auditable). */
export function verdictFromWeight(weight: number | null): ForensicAutopsy["author_vs_content"]["verdict"] | null {
  if (weight === null) return null;
  if (weight >= 0.66) return "author_driven";
  if (weight <= 0.33) return "content_driven";
  return "balanced";
}

export async function runForensic5D(signal: StagedSignal, content?: string): Promise<ForensicAutopsy> {
  const result = await generateStructured({
    task: "forensic-5d",
    system: FORENSIC_SYSTEM,
    prompt: `Realiza la autopsia de las 5 variables de esta pieza.\n\n${describeSignal(signal, content)}`,
    schema: FORENSIC_SCHEMA,
    validator: ForensicValidator,
    temperature: 0.3,
  });
  const verdict = verdictFromWeight(signal.author_weight);
  return verdict ? { ...result, author_vs_content: { ...result.author_vs_content, verdict } } : result;
}
