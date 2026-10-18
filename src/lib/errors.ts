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
  return err instanceof Error ? err.message : String(err);
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
