/**
 * Cliente único de Gemini. Todas las llamadas usan Structured Outputs (responseSchema)
 * y se validan con Zod; si la respuesta no cumple, se reintenta una vez.
 */
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { GoogleGenAI, type Schema } from "@google/genai";
import type { z } from "zod";
import { GEMINI_MODEL, requireEnv } from "@/lib/env";
import { AiOutputError } from "@/lib/errors";
import type { StagedSignal } from "@/types/trends";

let client: GoogleGenAI | null = null;

function gemini(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY", "El motor de IA (Autopsia 5D, JEV, ADN)") });
  return client;
}

export interface StructuredRequest<T> {
  task: string;
  system: string;
  prompt: string;
  schema: Schema;
  validator: z.ZodType<T>;
  temperature?: number;
}

export async function generateStructured<T>({ task, system, prompt, schema, validator, temperature = 0.4 }: StructuredRequest<T>): Promise<T> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await gemini().models.generateContent({
      model: GEMINI_MODEL(),
      contents: attempt === 0 ? prompt : `${prompt}\n\nTu respuesta anterior no cumplió el esquema (${lastError}). Responde de nuevo cumpliéndolo exactamente.`,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature,
      },
    });
    const text = res.text;
    if (!text) {
      lastError = `respuesta vacía (finishReason: ${res.candidates?.[0]?.finishReason ?? "desconocido"})`;
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      lastError = "JSON inválido";
      continue;
    }
    const parsed = validator.safeParse(json);
    if (parsed.success) return parsed.data;
    lastError = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  throw new AiOutputError(task, lastError);
}

// ── Contexto compartido para los prompts ───────────────────────────

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "n/d" : n.toLocaleString("es-CO"));

/** Ficha factual de la señal: métricas deterministas + texto. El modelo debe apoyarse solo en esto. */
export function describeSignal(signal: StagedSignal, content?: string): string {
  const m = signal.metrics;
  const lines = [
    `FECHA DE HOY: ${new Date().toISOString().slice(0, 10)}`,
    `RED: ${signal.network} · FORMATO DETECTADO: ${signal.format_hint} · IDIOMA: ${signal.language ?? "n/d"}`,
    `URL: ${signal.url}`,
    `PUBLICADO: ${signal.published_at ?? "desconocido"}`,
    `AUTOR: ${signal.author_name ?? "n/d"} (${signal.author_handle ?? "sin handle"}) · seguidores: ${fmt(m.author_followers)} · promedio de vistas del autor: ${fmt(m.author_avg_views)}`,
    `MÉTRICAS: vistas ${fmt(m.views)} · likes ${fmt(m.likes)} · comentarios ${fmt(m.comments)} · compartidos ${fmt(m.shares)} · duración ${m.duration_seconds ?? "n/d"} s`,
    `OUTLIER SCORE: ${signal.outlier_score ?? "n/d"} (vistas / promedio del autor) · VELOCIDAD: ${fmt(signal.velocity_per_hour)} vistas/h · PESO DEL AUTOR: ${signal.author_weight ?? "n/d"} (0 = mérito del contenido, 1 = mérito del autor)`,
    `ETAPA DE LA TENDENCIA: ${signal.stage} (confianza ${signal.stage_score}/100) — ${signal.stage_evidence.rule}`,
    `CONSULTA QUE LA DETECTÓ: ${signal.query}`,
    "",
    `TÍTULO: ${signal.title}`,
    `EXTRACTO: ${signal.excerpt}`,
  ];
  if (content && content.trim() && content.trim() !== signal.excerpt.trim()) {
    lines.push("", "CONTENIDO COMPLETO (lectura pública):", content.slice(0, 10_000));
  }
  return lines.join("\n");
}

// ── ADN de marca (docs/30X_BRAND_DNA.md como configuración viva) ────

let dnaCache: { mtimeMs: number; text: string } | null = null;

export async function loadBrandDna(): Promise<string> {
  const path = resolve(process.cwd(), "docs", "30X_BRAND_DNA.md");
  const { mtimeMs } = await stat(path);
  if (dnaCache?.mtimeMs !== mtimeMs) dnaCache = { mtimeMs, text: await readFile(path, "utf8") };
  return dnaCache.text;
}

export const GROUNDING_RULES = `Reglas de rigor:
- Basa cada afirmación en la ficha y el contenido entregados. Si un dato no está, dilo explícitamente ("la fuente no lo indica"); nunca inventes cifras, fechas, nombres ni citas.
- Escribe en español neutro latinoamericano, concreto y sin relleno.`;
