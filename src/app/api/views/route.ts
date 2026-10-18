/**
 * GET  /api/views?profile=<id> — vistas guardadas (combinaciones de filtros) del perfil.
 * POST /api/views — guarda una vista. Contrato: docs/API_CONTRACTS.md §3.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertWebhookAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { getTrendRepository } from "@/lib/db/supabase";
import { resolveProfile } from "@/lib/profiles";
import type { TrendFilters } from "@/types/trends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ViewBody = z.object({
  profileId: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(2).max(60),
  // Los filtros se validan al aplicarse (GET /api/discover); aquí solo se acota el tamaño.
  filters: z.record(z.string(), z.unknown()).refine((f) => JSON.stringify(f).length <= 4_000, "Filtros demasiado grandes"),
});

export async function GET(req: Request) {
  try {
    const repo = getTrendRepository();
    const profile = await resolveProfile(repo, new URL(req.url).searchParams.get("profile"));
    return NextResponse.json({ items: await repo.listViews(profile.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    assertWebhookAuth(req);
    const body = await parseJsonBody(req, ViewBody);
    const repo = getTrendRepository();
    const profile = await resolveProfile(repo, body.profileId);
    const { profileId: _ignored, limit: _l, offset: _o, ...filters } = body.filters as TrendFilters;
    return NextResponse.json({ item: await repo.createView(profile.id, body.name, filters) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
