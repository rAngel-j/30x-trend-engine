import { MissingCredentialError } from "./errors";

/** Lee una variable de entorno; cadenas vacías cuentan como ausentes. */
export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function requireEnv(name: string, feature: string): string {
  const value = optionalEnv(name);
  if (!value) throw new MissingCredentialError(name, feature);
  return value;
}

export function numberEnv(name: string, fallback: number): number {
  const parsed = Number(optionalEnv(name));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** gemini-2.5-flash ya no está disponible para cuentas nuevas (404); 3.8-flash es el Flash estable vigente. */
export const GEMINI_MODEL = () => optionalEnv("GEMINI_MODEL") ?? "gemini-3.8-flash";
export const JEV_ADAPT_THRESHOLD = () => numberEnv("JEV_ADAPT_THRESHOLD", 55);
