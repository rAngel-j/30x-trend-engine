/**
 * POST /api/discover — descubre tendencias en vivo, las persiste y analiza el Top N.
 * GET  /api/discover — lectura filtrada (ControlBar) sin nueva ingesta.
 * Contrato: docs/API_CONTRACTS.md §3.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, errorResponse, parseJsonBody, parseWith, searchParamsToObject } from "@/lib/api";
import { getTrendRepository } from "@/lib/db/supabase";
import { optionalEnv } from "@/lib/env";
import { expandQuery } from "@/lib/intelligence/query-expander";
import { analyzeTopPending, enforceRetention } from "@/lib/pipeline";
import { collectSignals } from "@/lib/sources";
import {
  ANALYSIS_STATUSES,
  FORMAT_TYPES,
  LANGUAGES,
  NETWORKS,
  SORT_KEYS,
  TREND_STAGES,
  type TrendFilters,
} from "@/types/trends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DiscoverBody = z.object({
  query: z.string().trim().min(2).max(200),
  networks: z.array(z.enum(["youtube", "linkedin", "instagram", "tiktok"])).min(1).default(["youtube", "linkedin", "instagram", "tiktok"]),
  windowDays: z.number().int().min(1).max(90).default(7),
  youtubeFormat: z.enum(["any", "short", "long"]).default("any"),
  maxPerSource: z.number().int().min(1).max(50).default(20),
  bilingual: z.boolean().default(true),
  analyzeTop: z.number().int().min(0).max(10).default(5),
});

export async function POST(req: Request) {
  const started = Date.now();
  try {
    const body = await parseJsonBody(req, DiscoverBody);
    const repo = getTrendRepository();
    await enforceRetention(repo);

    const serpReady = Boolean(optionalEnv("TAVILY_API_KEY") || (optionalEnv("GOOGLE_CSE_API_KEY") && optionalEnv("GOOGLE_CSE_ID")));
    const youtubeReady = body.networks.includes("youtube") && Boolean(optionalEnv("YOUTUBE_API_KEY"));
    const socialRequested = body.networks.some((n) => n !== "youtube");
    const anySource = youtubeReady || (socialRequested && serpReady);
    const expansion = body.bilingual && anySource ? await expandQuery(body.query) : { variants: [body.query], note: null };
    const { signals, sources } = await collectSignals({
      query: body.query,
      queryVariants: expansion.variants.slice(1),
      networks: body.networks,
      windowDays: body.windowDays,
      youtubeFormat: body.youtubeFormat,
      maxPerSource: body.maxPerSource,
    });

    if (sources.length > 0 && sources.every((s) => s.status === "disabled")) {
      return apiError("NO_SOURCES", "Ninguna fuente tiene credenciales configuradas. Revisa .env.local.", 503, { sources });
    }

    const stored = await repo.upsertSignals(signals);
    await repo.logDiscoveryRun({
      query: body.query,
      networks: body.networks,
      windowDays: body.windowDays,
      sources,
      signalsFound: stored.length,
      startedAt: new Date(started).toISOString(),
    });

    const { updated, summary } = await analyzeTopPending(repo, stored, body.analyzeTop);
    const items = stored.map((s) => updated.get(s.id) ?? s).sort((a, b) => b.priority_score - a.priority_score);

    return NextResponse.json({
      items,
      total: items.length,
      sources,
      queries: expansion.variants,
      ...(expansion.note ? { notes: [expansion.note] } : {}),
      analysis: summary,
      repository: repo.kind,
      took_ms: Date.now() - started,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

const LIST_KEYS = ["networks", "stages", "formats", "languages", "statuses"] as const;
const num = z.coerce.number();

const FilterQuery = z.object({
  networks: z.array(z.enum(NETWORKS)).optional(),
  stages: z.array(z.enum(TREND_STAGES)).optional(),
  formats: z.array(z.enum(FORMAT_TYPES)).optional(),
  languages: z.array(z.enum(LANGUAGES)).optional(),
  statuses: z.array(z.enum(ANALYSIS_STATUSES)).optional(),
  windowDays: num.int().min(1).max(365).optional(),
  minJev: num.min(0).max(100).optional(),
  maxJev: num.min(0).max(100).optional(),
  minOutlier: num.min(0).optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(SORT_KEYS).optional(),
  limit: num.int().min(1).max(100).optional(),
  offset: num.int().min(0).optional(),
});

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const filters: TrendFilters = parseWith(FilterQuery, searchParamsToObject(params, LIST_KEYS));
    const repo = getTrendRepository();
    const page = await repo.querySignals(filters);
    return NextResponse.json({ ...page, repository: repo.kind });
  } catch (err) {
    return errorResponse(err);
  }
}
