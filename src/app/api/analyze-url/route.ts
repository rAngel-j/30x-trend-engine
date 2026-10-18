/**
 * POST /api/analyze-url — Sensor de Comunidad 30X.
 * Recibe cualquier URL pública (UI o webhook externo), la deconstruye y devuelve la autopsia completa.
 * También acepta `{ id }` para analizar una señal ya guardada (botón "Analizar con IA" del ranking):
 * en ese caso leer la URL es opcional y solo aporta más contexto.
 * Contrato: docs/API_CONTRACTS.md §3.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertWebhookAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { getTrendRepository, type TrendRepository } from "@/lib/db/supabase";
import { errorMessage, NotFoundError } from "@/lib/errors";
import { classifyCohort } from "@/lib/intelligence/trend-stage";
import { aiEnabled, analyzeStoredSignal, enforceRetention } from "@/lib/pipeline";
import { resolveProfile } from "@/lib/profiles";
import { readPublicUrl } from "@/lib/sources";
import { MAX_COMMUNITY_TEXT } from "@/lib/sources/public-reader";
import type { BrandProfile, StagedSignal, TrendSignal } from "@/types/trends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Gemini con "alta demanda" reintenta con esperas: 120 s se quedaba corto en Vercel (504).

const AnalyzeBody = z
  .object({
    url: z.string().trim().min(8).max(2048).optional(),
    id: z.string().trim().min(1).max(64).optional(),
    /** Texto que la persona vio públicamente (vía legal para redes cerradas). */
    text: z.string().trim().max(MAX_COMMUNITY_TEXT).optional(),
    force: z.boolean().default(false),
    /** Perfil de marca con el que se analiza (por defecto, el principal). */
    profileId: z.string().trim().min(1).max(64).optional(),
  })
  .refine((b) => Boolean(b.url) !== Boolean(b.id), { message: "Envía `url` o `id` (uno de los dos)." });

const NO_AI = "Falta GEMINI_API_KEY: la señal se guardó como pending, sin autopsia ni guiones.";

async function analyzeIfPossible(repo: TrendRepository, signal: TrendSignal, profile: BrandProfile, content: string | undefined, warnings: string[]) {
  if (!aiEnabled()) {
    warnings.push(NO_AI);
    return (await repo.getSignal(signal.id, profile.id)) ?? signal;
  }
  return analyzeStoredSignal(repo, signal, profile, content);
}

export async function POST(req: Request) {
  try {
    assertWebhookAuth(req);
    const body = await parseJsonBody(req, AnalyzeBody);
    const repo = getTrendRepository();
    await enforceRetention(repo);
    const profile = await resolveProfile(repo, body.profileId);

    // ── Re-análisis de una señal guardada ──
    if (body.id) {
      const stored = await repo.getSignal(body.id, profile.id);
      if (!stored) throw new NotFoundError(`No existe la señal ${body.id}.`);
      if (stored.analysis_status === "analyzed" && !body.force) {
        return NextResponse.json({ item: stored, providers: [], warnings: [], cached: true });
      }
      const warnings: string[] = [];
      let content: string | undefined;
      let providers: string[] = [];
      try {
        const reading = await readPublicUrl(stored.url);
        content = reading.content;
        providers = reading.providers;
        warnings.push(...reading.warnings);
      } catch (err) {
        warnings.push(`Se analiza con el extracto indexado: ${errorMessage(err)}`);
      }
      const item = await analyzeIfPossible(repo, stored, profile, content, warnings);
      return NextResponse.json({ item, providers, warnings, cached: false });
    }

    // ── URL nueva desde la comunidad ──
    const reading = await readPublicUrl(body.url!, { text: body.text });
    const existing = await repo.getSignalByUrl(reading.signal.url, profile.id);

    if (existing?.analysis_status === "analyzed" && !body.force) {
      return NextResponse.json({ item: existing, providers: reading.providers, warnings: reading.warnings, cached: true });
    }

    // Una pieza aislada no forma cohorte: si ya la conocíamos por /discover, se conserva su etapa real.
    const [single] = classifyCohort([reading.signal]);
    const staged: StagedSignal = existing
      ? { ...single!, stage: existing.stage, stage_score: existing.stage_score, stage_evidence: existing.stage_evidence, query: existing.query }
      : { ...single!, stage_evidence: { ...single!.stage_evidence, rule: `provisional (pieza individual): ${single!.stage_evidence.rule}` } };
    // Privacidad: no se registra quién envía el enlace, solo cuándo llegó por primera vez.
    const previous = (existing?.raw ?? {}) as { submitted_at?: string };
    staged.raw = { ...staged.raw, submitted_at: previous.submitted_at ?? new Date().toISOString() };

    const [stored] = await repo.upsertSignals([staged]);
    const warnings = [...reading.warnings];
    const item = await analyzeIfPossible(repo, stored!, profile, reading.content, warnings);
    return NextResponse.json({ item, providers: reading.providers, warnings, cached: false });
  } catch (err) {
    return errorResponse(err);
  }
}
