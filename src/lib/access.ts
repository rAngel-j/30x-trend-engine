/**
 * Código de acceso para demos públicas (docs/ARCHITECTURE.md §7b-septies).
 * La cookie guarda un hash del código, nunca el código. Lo usan src/proxy.ts y /api/access.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE = "30x_access";
export const ACCESS_MAX_AGE = 7 * 24 * 3600;

export const demoAccessCode = () => process.env.DEMO_ACCESS_CODE?.trim() || null;

export function accessToken(code: string): string {
  return createHash("sha256").update(`30x-demo:${code}`).digest("hex");
}

/** Comparación de tiempo constante (no revela cuántos caracteres coinciden). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
