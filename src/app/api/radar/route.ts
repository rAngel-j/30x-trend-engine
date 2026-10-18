/**
 * POST /api/radar — ejecuta el Radar semanal: los temas de IA que más crecen esta semana.
 * GET  /api/radar — último radar guardado (o ?run=<id>).
 * Contrato: docs/API_CONTRACTS.md §3.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, errorResponse, parseJsonBody } from "@/lib/api";
import { getTrendRepository } from "@/lib/db/supabase";
import { optionalEnv } from "@/lib/env";
import { NotFoundError } from "@/lib/errors";
import { enforceRetention } from "@/lib/pipeline";
import { runRadar } from "@/lib/radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Ingesta de varias semillas + agrupación + autopsia de hasta 12 piezas: puede tardar 2-4 minutos.
export const maxDuration = 300;

const RadarBody = z.object({
  networks: z.array(z.enum(["youtube", "linkedin", "instagram", "tiktok"])).min(1).default(["linkedin", "youtube", "instagram", "tiktok"]),
  maxTopics: z.number().int().min(3).max(15).default(10),
});

export async function POST(req: Request) {
  try {
    const body = await parseJsonBody(req, RadarBody);
    const serpReady = Boolean(optionalEnv("TAVILY_API_KEY") || (optionalEnv("GOOGLE_CSE_API_KEY") && optionalEnv("GOOGLE_CSE_ID")));
    const youtubeReady = body.networks.includes("youtube") && Boolean(optionalEnv("YOUTUBE_API_KEY"));
    const socialRequested = body.networks.some((n) => n !== "youtube");
    if (!youtubeReady && !(socialRequested && serpReady)) {
      return apiError("NO_SOURCES", "Ninguna de las redes elegidas tiene una fuente conectada. Revisa .env.local (YOUTUBE_API_KEY o TAVILY_API_KEY).", 503);
    }

    const repo = getTrendRepository();
    await enforceRetention(repo);
    const result = await runRadar(repo, { networks: body.networks, maxTopics: body.maxTopics });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(req: Request) {
  try {
    const runId = new URL(req.url).searchParams.get("run") ?? undefined;
    const result = await getTrendRepository().getRadar(runId);
    if (!result) throw new NotFoundError(runId ? `No existe el radar ${runId}.` : "Todavía no se ha ejecutado ningún radar.");
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
