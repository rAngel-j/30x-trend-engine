/**
 * Expansión bilingüe de la consulta: para detectar "emerging" hay que comparar
 * lo que pasa en inglés con lo que (aún no) pasa en español (docs/ARCHITECTURE.md §4.3).
 */
import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import { optionalEnv } from "@/lib/env";
import { errorMessage } from "@/lib/errors";
import { generateStructured } from "./gemini-client";

const SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    english: { type: Type.STRING, description: "La consulta como la buscaría un creador angloparlante (3-8 palabras, sin comillas)." },
    spanish: { type: Type.STRING, description: "La consulta como la buscaría un creador hispanohablante de LatAm (3-8 palabras, sin comillas)." },
  },
  required: ["english", "spanish"],
  propertyOrdering: ["english", "spanish"],
};

const Validator = z.object({ english: z.string().trim().min(2).max(120), spanish: z.string().trim().min(2).max(120) });

export interface ExpandedQuery {
  variants: string[];
  /** Motivo por el que no se expandió (sin clave o error), para mostrarlo en la UI. */
  note: string | null;
}

export async function expandQuery(query: string): Promise<ExpandedQuery> {
  if (!optionalEnv("GEMINI_API_KEY")) {
    return { variants: [query], note: "Búsqueda solo en el idioma de la consulta: falta GEMINI_API_KEY para traducirla." };
  }
  try {
    const { english, spanish } = await generateStructured({
      task: "query-expander",
      system: "Traduces consultas de búsqueda de tendencias sobre IA y negocios. Conserva nombres propios y de herramientas tal cual.",
      prompt: `Consulta original: "${query}"`,
      schema: SCHEMA,
      validator: Validator,
      temperature: 0,
    });
    // Una sola variante extra: la del otro idioma. Así la cuota se duplica como máximo, nunca se triplica.
    const same = (a: string, b: string) => a.toLowerCase().trim() === b.toLowerCase().trim();
    const other = same(english, query) ? spanish : english;
    return { variants: same(other, query) ? [query] : [query, other], note: null };
  } catch (err) {
    return { variants: [query], note: `No se pudo traducir la consulta: ${errorMessage(err)}` };
  }
}
