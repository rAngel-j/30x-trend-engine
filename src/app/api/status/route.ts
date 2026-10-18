/**
 * GET /api/status — qué fuentes, IA y destinos están configurados en el servidor.
 * Solo booleanos: nunca expone valores de claves. Contrato: docs/API_CONTRACTS.md §3.
 */
import { NextResponse } from "next/server";
import { getTrendRepository } from "@/lib/db/supabase";
import { GEMINI_MODEL, JEV_ADAPT_THRESHOLD, optionalEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const has = (...names: string[]) => names.every((n) => Boolean(optionalEnv(n)));

export function GET() {
  return NextResponse.json({
    repository: getTrendRepository().kind,
    sources: {
      youtube_api: has("YOUTUBE_API_KEY"),
      tavily: has("TAVILY_API_KEY"),
      google_cse: has("GOOGLE_CSE_API_KEY", "GOOGLE_CSE_ID"),
      jina_key: has("JINA_API_KEY"),
      meta_oembed: has("META_OEMBED_TOKEN"),
    },
    ai: { gemini: has("GEMINI_API_KEY"), model: GEMINI_MODEL(), jev_threshold: JEV_ADAPT_THRESHOLD() },
    exports: {
      slack: has("SLACK_WEBHOOK_URL"),
      notion: has("NOTION_API_KEY", "NOTION_DATABASE_ID"),
      make: has("MAKE_WEBHOOK_URL"),
    },
    webhook_secret: has("INGEST_WEBHOOK_SECRET"),
  });
}
