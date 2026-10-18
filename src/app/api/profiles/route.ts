/**
 * GET  /api/profiles — perfiles de marca (el primero es el por defecto).
 * POST /api/profiles — crea un perfil. Contrato: docs/API_CONTRACTS.md §3.
 */
import { NextResponse } from "next/server";
import { assertWebhookAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { getTrendRepository } from "@/lib/db/supabase";
import { ensureDefaultProfile, ProfileInputSchema } from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const repo = getTrendRepository();
    const def = await ensureDefaultProfile(repo);
    return NextResponse.json({ items: await repo.listProfiles(), default_id: def.id });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    assertWebhookAuth(req);
    const input = await parseJsonBody(req, ProfileInputSchema);
    const repo = getTrendRepository();
    await ensureDefaultProfile(repo);
    return NextResponse.json({ item: await repo.createProfile(input) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
