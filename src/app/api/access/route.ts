/**
 * POST   /api/access — valida el código de la demo y deja una cookie httpOnly.
 * DELETE /api/access — cierra la sesión. Contrato: docs/API_CONTRACTS.md §3.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, errorResponse, parseJsonBody } from "@/lib/api";
import { ACCESS_COOKIE, ACCESS_MAX_AGE, accessToken, demoAccessCode, safeEqual } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AccessBody = z.object({ code: z.string().trim().min(1).max(200) });

export async function POST(req: Request) {
  try {
    const code = demoAccessCode();
    if (!code) return new NextResponse(null, { status: 204 });
    const body = await parseJsonBody(req, AccessBody);
    if (!safeEqual(accessToken(body.code), accessToken(code))) {
      await new Promise((r) => setTimeout(r, 600)); // frena intentos por fuerza bruta
      return apiError("UNAUTHORIZED", "Código incorrecto.", 401);
    }
    const res = new NextResponse(null, { status: 204 });
    res.cookies.set(ACCESS_COOKIE, accessToken(code), {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(req.url).protocol === "https:",
      maxAge: ACCESS_MAX_AGE,
      path: "/",
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}

export function DELETE() {
  const res = new NextResponse(null, { status: 204 });
  res.cookies.delete(ACCESS_COOKIE);
  return res;
}
