/**
 * Proxy de Next 16 (antes "middleware"): si DEMO_ACCESS_CODE está definido, la app exige un código de acceso
 * para que una URL pública no gaste la cuota diaria de las APIs. Sin esa variable, no hace nada.
 * docs/ARCHITECTURE.md §7b-septies.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, accessToken, demoAccessCode, safeEqual } from "@/lib/access";

export function proxy(req: NextRequest) {
  const code = demoAccessCode();
  if (!code) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (pathname === "/acceso" || pathname === "/api/access") return NextResponse.next();

  if (safeEqual(req.cookies.get(ACCESS_COOKIE)?.value ?? "", accessToken(code))) return NextResponse.next();

  // Webhooks externos al Sensor de Comunidad (Slack Workflow, Make…) entran con su propio secreto.
  const secret = process.env.INGEST_WEBHOOK_SECRET?.trim();
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (secret && bearer && safeEqual(bearer, secret)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Esta demo requiere código de acceso." } }, { status: 401 });
  }
  const login = req.nextUrl.clone();
  login.pathname = "/acceso";
  login.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
