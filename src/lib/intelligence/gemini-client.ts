/**
 * Cliente único de Gemini. Todas las llamadas usan Structured Outputs (responseSchema)
 * y se validan con Zod; si la respuesta no cumple, se reintenta una vez.
 */
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { GoogleGenAI, type Schema } from "@google/genai";
import type { z } from "zod";
import { GEMINI_MODEL, requireEnv } from "@/lib/env";
import { AiOutputError, errorMessage, SourceError } from "@/lib/errors";
import type { StagedSignal } from "@/types/trends";

let client: GoogleGenAI | null = null;

function gemini(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY", "El motor de IA (Autopsia 5D, JEV, ADN)") });
  return client;
}

const MAX_RETRIES = 3;
/** Esperas más largas que esto significan cuota diaria agotada: no tiene sentido reintentar. */
const MAX_RETRY_WAIT_MS = 60_000;

/** Lee "retry in 19h24m59s", "retry in 37s" o retryDelay "37s" → milisegundos. */
export function parseRetryDelay(message: string): number | null {
  const m = message.match(/retry(?:Delay)?["\s:]*(?:in\s*)?"?((?:\d+h)?(?:\d+m(?!s))?(?:\d+(?:\.\d+)?s)?)/i);
  const text = m?.[1];
  if (!text) return null;
  const h = Number(text.match(/(\d+)h/)?.[1] ?? 0);
  const min = Number(text.match(/(\d+)m(?!s)/)?.[1] ?? 0);
  const sec = Number(text.match(/(\d+(?:\.\d+)?)s/)?.[1] ?? 0);
  const ms = ((h * 60 + min) * 60 + sec) * 1000;
  return ms > 0 ? ms : null;
}

function humanWait(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/**
 * Reintentos ante problemas temporales de Gemini:
 * - 429 por límite POR MINUTO: espera lo que indique el proveedor y reintenta.
 * - 503 "alta demanda": backoff creciente (5 s, 10 s, 20 s).
 * - Cuota DIARIA agotada (espera de horas): no reintenta y lo explica con el tiempo de renovación.
 */
async function withRateLimitRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number }).status;
      const rateLimited = status === 429 || /RESOURCE_EXHAUSTED|rate limit|quota/i.test(message);
      const overloaded = status === 503 || /UNAVAILABLE|high demand|overloaded/i.test(message);
      const hinted = parseRetryDelay(message);
      const daily = rateLimited && hinted !== null && hinted > MAX_RETRY_WAIT_MS;

      if (daily) {
        throw new SourceError(
          "Gemini",
          `Se agotó la cuota diaria gratuita de ${GEMINI_MODEL()}. Se renueva en ${humanWait(hinted!)}. Para seguir hoy: activa facturación en Google AI Studio o usa otro modelo en GEMINI_MODEL.`,
          429,
        );
      }
      if ((!rateLimited && !overloaded) || attempt >= MAX_RETRIES) {
        throw new SourceError("Gemini", errorMessage(err), typeof status === "number" ? status : undefined);
      }
      const waitMs = rateLimited && hinted !== null ? hinted + 500 : 5_000 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
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
    const res = await withRateLimitRetry(() => gemini().models.generateContent({
      model: GEMINI_MODEL(),
      contents: attempt === 0 ? prompt : `${prompt}\n\nTu respuesta anterior no cumplió el esquema (${lastError}). Responde de nuevo cumpliéndolo exactamente.`,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature,
      },
    }));
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
    `CUENTA QUE PUBLICÓ (solo cifras, sin identidad): seguidores ${fmt(m.author_followers)} · promedio de vistas por pieza ${fmt(m.author_avg_views)}`,
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
- Escribe en español neutro latinoamericano, concreto y sin relleno.
- Privacidad: no menciones nombres, handles ni datos de personas. Habla de "la cuenta", "el autor" o "la marca"; si citas el gancho, quita cualquier nombre propio de persona.`;
