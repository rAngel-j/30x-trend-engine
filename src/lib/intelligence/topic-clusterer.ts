/**
 * Agrupa las piezas de la semana en temas concretos con una sola llamada a Gemini (Structured Outputs).
 * El modelo solo decide qué piezas hablan de lo mismo; las métricas de cada tema se calculan en código.
 */
import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import { generateStructured, GROUNDING_RULES } from "./gemini-client";
import type { BrandProfile, TrendSignal } from "@/types/trends";

const MAX_PIECES = 160;

export interface TopicCluster {
  label: string;
  thesis: string;
  members: TrendSignal[];
}

const SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    topics: {
      type: Type.ARRAY,
      minItems: "1",
      maxItems: "24",
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING, description: "Nombre del tema en español, concreto, de 3 a 7 palabras. Nunca una categoría genérica." },
          thesis: { type: Type.STRING, description: "La tesis o el dolor que comparten las piezas, en una frase." },
          members: { type: Type.ARRAY, items: { type: Type.INTEGER }, description: "Números de las piezas que pertenecen al tema." },
        },
        required: ["label", "thesis", "members"],
        propertyOrdering: ["label", "thesis", "members"],
      },
    },
  },
  required: ["topics"],
};

const Validator = z.object({
  topics: z.array(z.object({ label: z.string().trim().min(2).max(80), thesis: z.string().trim().min(2).max(300), members: z.array(z.number().int()) })),
});

function pieceLine(i: number, s: TrendSignal): string {
  const date = s.published_at?.slice(0, 10) ?? "sin fecha";
  const excerpt = s.excerpt.replace(/\s+/g, " ").slice(0, 180);
  return `[${i}] (${s.network}, ${s.language ?? "?"}, ${date}) ${s.title.slice(0, 140)} — ${excerpt}`;
}

export async function clusterTopics(signals: TrendSignal[], profile: Pick<BrandProfile, "name" | "audience" | "topic_scope">): Promise<TopicCluster[]> {
  const pieces = signals.slice(0, MAX_PIECES);
  if (pieces.length < 2) return [];

  const { topics } = await generateStructured({
    task: "topic-clusterer",
    system: `Eres el editor de tendencias de ${profile.name}, que le habla a: ${profile.audience}.
Agrupas piezas de redes en TEMAS concretos: dos piezas comparten tema si defienden la misma tesis o atacan el mismo dolor, aunque estén en idiomas distintos.
- Un tema es específico (p. ej. "Agentes de IA que prospectan en ventas B2B"), nunca una categoría genérica.
- Cada pieza va como máximo en un tema. Deja fuera las piezas que no tratan sobre: ${profile.topic_scope}.
- Un tema necesita al menos 2 piezas.
${GROUNDING_RULES}`,
    prompt: `Agrupa estas ${pieces.length} piezas en temas:\n\n${pieces.map((s, i) => pieceLine(i, s)).join("\n")}`,
    schema: SCHEMA,
    validator: Validator,
    temperature: 0.2,
  });

  // Validación determinista: índices válidos, sin repetir piezas entre temas, mínimo 2 piezas.
  const used = new Set<number>();
  const clusters: TopicCluster[] = [];
  for (const t of topics) {
    const indexes = [...new Set(t.members)].filter((i) => i >= 0 && i < pieces.length && !used.has(i));
    if (indexes.length < 2) continue;
    indexes.forEach((i) => used.add(i));
    clusters.push({ label: t.label, thesis: t.thesis, members: indexes.map((i) => pieces[i]!) });
  }
  return clusters;
}
