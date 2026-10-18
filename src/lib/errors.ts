/** Errores normalizados (docs/API_CONTRACTS.md §4). */

export class MissingCredentialError extends Error {
  constructor(public readonly variable: string, feature: string) {
    super(`Falta ${variable}: ${feature} está desactivado. Configúralo en .env.local.`);
    this.name = "MissingCredentialError";
  }
}

export class SourceError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "SourceError";
  }
}

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}

export class AiOutputError extends Error {
  constructor(task: string, detail: string) {
    super(`Gemini (${task}) devolvió una respuesta fuera de esquema: ${detail}`);
    this.name = "AiOutputError";
  }
}

export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Los SDKs (p. ej. @google/genai) a veces devuelven el cuerpo JSON del proveedor como mensaje.
  if (raw.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string; status?: string } };
      if (parsed.error?.message) return parsed.error.status ? `${parsed.error.message} (${parsed.error.status})` : parsed.error.message;
    } catch {
      /* no era JSON: se devuelve tal cual */
    }
  }
  return raw;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "Falta o es inválido el secreto del webhook (Authorization: Bearer …).") {
    super(message);
    this.name = "UnauthorizedError";
  }
}
