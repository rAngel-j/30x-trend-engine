/**
 * PUT    /api/profiles/:id — edita un perfil (campos parciales).
 * DELETE /api/profiles/:id — borra un perfil (no el por defecto). Contrato: docs/API_CONTRACTS.md §3.
 */
import { NextResponse } from "next/server";
import { apiError, assertWebhookAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { getTrendRepository } from "@/lib/db/supabase";
import { NotFoundError } from "@/lib/errors";
import { ProfileInputSchema } from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params) {
  try {
    assertWebhookAuth(req);
    const { id } = await params;
    const patch = await parseJsonBody(req, ProfileInputSchema.partial());
    const repo = getTrendRepository();
    if (!(await repo.getProfile(id))) throw new NotFoundError(`No existe el perfil ${id}.`);
    return NextResponse.json({ item: await repo.updateProfile(id, patch) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    assertWebhookAuth(req);
    const { id } = await params;
    const repo = getTrendRepository();
    const profile = await repo.getProfile(id);
    if (!profile) throw new NotFoundError(`No existe el perfil ${id}.`);
    if (profile.is_default) return apiError("INVALID_INPUT", "El perfil por defecto no se puede borrar.", 409);
    await repo.deleteProfile(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
