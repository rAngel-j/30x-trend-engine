/** DELETE /api/views/:id — borra una vista guardada. */
import { NextResponse } from "next/server";
import { assertWebhookAuth, errorResponse } from "@/lib/api";
import { getTrendRepository } from "@/lib/db/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertWebhookAuth(req);
    const { id } = await params;
    await getTrendRepository().deleteView(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
