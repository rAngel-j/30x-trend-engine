/**
 * Utilidades compartidas por las API Routes: validación, errores uniformes y auth de webhooks.
 * Contrato de errores: docs/API_CONTRACTS.md §4.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { optionalEnv } from "./env";
import {
  AiOutputError,
  errorMessage,
  InvalidInputError,
  MissingCredentialError,
  NotFoundError,
  SourceError,
  UnauthorizedError,
} from "./errors";

export type ErrorCode =
  | "READ_ONLY"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "MISSING_CREDENTIAL"
  | "NO_SOURCES"
  | "SOURCE_ERROR"
  | "AI_OUTPUT_ERROR"
  | "INTERNAL";

export function apiError(code: ErrorCode, message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: { code, message }, ...extra }, { status });
}

export function errorResponse(err: unknown) {
  if (err instanceof InvalidInputError) return apiError("INVALID_INPUT", err.message, 400);
  if (err instanceof NotFoundError) return apiError("NOT_FOUND", err.message, 404);
  if (err instanceof UnauthorizedError) return apiError("UNAUTHORIZED", err.message, 401);
  if (err instanceof MissingCredentialError) return apiError("MISSING_CREDENTIAL", err.message, 503);
  if (err instanceof SourceError) return apiError("SOURCE_ERROR", err.message, 502);
  if (err instanceof AiOutputError) return apiError("AI_OUTPUT_ERROR", err.message, 502);
  console.error("[api] error no controlado:", err);
  return apiError("INTERNAL", "Error interno. Revisa los logs del servidor.", 500);
}

/** Lee y valida el body JSON; los errores de Zod se convierten en InvalidInputError legible. */
export async function parseJsonBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new InvalidInputError("El body debe ser JSON válido.");
  }
  return parseWith(schema, body);
}

export function parseWith<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const detail = parsed.error.issues
    .slice(0, 4)
    .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
    .join("; ");
  throw new InvalidInputError(`Entrada inválida — ${detail}`);
}

/** Convierte URLSearchParams en objeto, separando por coma las claves que son listas. */
export function searchParamsToObject(params: URLSearchParams, listKeys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (value === "") continue;
    out[key] = listKeys.includes(key) ? value.split(",").map((v) => v.trim()).filter(Boolean) : value;
  }
  return out;
}

function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Si INGEST_WEBHOOK_SECRET está definido, las llamadas externas (otro origen o sin Origin,
 * como Make/Slack/curl) deben traer `Authorization: Bearer <secreto>`. La UI propia pasa por mismo origen.
 */
export function assertWebhookAuth(req: Request): void {
  const secret = optionalEnv("INGEST_WEBHOOK_SECRET");
  if (!secret || isSameOrigin(req)) return;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedError();
}

export { errorMessage };
