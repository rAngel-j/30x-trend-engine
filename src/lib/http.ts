import { SourceError } from "./errors";

interface FetchJsonOptions extends RequestInit {
  timeoutMs?: number;
}

/** fetch + timeout + error tipado. Nunca expone la URL completa (puede llevar API keys en query). */
export async function fetchJson<T>(provider: string, url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = 15_000, ...init } = options;
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? `timeout tras ${timeoutMs} ms` : String(err);
    throw new SourceError(provider, `no se pudo conectar (${reason})`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const message = extractApiMessage(body);
    throw new SourceError(provider, `HTTP ${res.status}: ${message.length > 240 ? `${message.slice(0, 240)}…` : message}`, res.status);
  }
  return (await res.json()) as T;
}

function extractApiMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string; detail?: string };
    if (typeof parsed.error === "string") return parsed.error;
    return parsed.error?.message ?? parsed.message ?? parsed.detail ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

/** Ejecuta tareas asíncronas con concurrencia máxima `limit`, preservando el orden. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}
