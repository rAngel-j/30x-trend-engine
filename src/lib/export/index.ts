/**
 * Plug & Play 30X: envía una señal a Slack, Notion y/o Make de forma independiente.
 * Un destino caído no bloquea a los demás (docs/ARCHITECTURE.md §6).
 */
import { optionalEnv } from "@/lib/env";
import { errorMessage, InvalidInputError, SourceError } from "@/lib/errors";
import type { TrendSignal } from "@/types/trends";
import { sendToNotion } from "./notion";
import { sendToSlack } from "./slack";

export const EXPORT_TARGETS = ["slack", "notion", "make"] as const;
export type ExportTarget = (typeof EXPORT_TARGETS)[number];

export interface ExportOverrides {
  slackWebhookUrl?: string;
  makeWebhookUrl?: string;
  notionApiKey?: string;
  notionDatabaseId?: string;
}

export interface ExportResult {
  target: ExportTarget;
  status: "ok" | "disabled" | "error";
  message?: string;
  url?: string;
}

const SLACK_HOST = /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\//;
const MAKE_HOST = /^https:\/\/hook\.([a-z0-9-]+\.)?(make\.com|integromat\.com)\//;

/** Solo dominios oficiales para URLs que llegan desde la UI (anti-SSRF). */
export function validateOverrides(o: ExportOverrides): void {
  if (o.slackWebhookUrl && !SLACK_HOST.test(o.slackWebhookUrl)) {
    throw new InvalidInputError("slackWebhookUrl debe ser un Incoming Webhook de hooks.slack.com.");
  }
  if (o.makeWebhookUrl && !MAKE_HOST.test(o.makeWebhookUrl)) {
    throw new InvalidInputError("makeWebhookUrl debe ser un webhook de hook.*.make.com.");
  }
  if (o.notionDatabaseId && !/^[0-9a-f-]{32,36}$/i.test(o.notionDatabaseId)) {
    throw new InvalidInputError("notionDatabaseId debe ser el ID de 32 caracteres de la base de Notion.");
  }
}

async function sendToMake(signal: TrendSignal, webhookUrl: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "trend.exported", sent_at: new Date().toISOString(), signal }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new SourceError("Make", `HTTP ${res.status}`, res.status);
}

async function exportOne(target: ExportTarget, signal: TrendSignal, o: ExportOverrides): Promise<ExportResult> {
  const disabled = (variable: string): ExportResult => ({ target, status: "disabled", message: `Falta ${variable}` });
  try {
    if (target === "slack") {
      const url = o.slackWebhookUrl ?? optionalEnv("SLACK_WEBHOOK_URL");
      if (!url) return disabled("SLACK_WEBHOOK_URL");
      await sendToSlack(signal, url);
      return { target, status: "ok" };
    }
    if (target === "notion") {
      const key = o.notionApiKey ?? optionalEnv("NOTION_API_KEY");
      const db = o.notionDatabaseId ?? optionalEnv("NOTION_DATABASE_ID");
      if (!key || !db) return disabled(!key ? "NOTION_API_KEY" : "NOTION_DATABASE_ID");
      const { url } = await sendToNotion(signal, key, db);
      return { target, status: "ok", ...(url ? { url } : {}) };
    }
    const url = o.makeWebhookUrl ?? optionalEnv("MAKE_WEBHOOK_URL");
    if (!url) return disabled("MAKE_WEBHOOK_URL");
    await sendToMake(signal, url);
    return { target, status: "ok" };
  } catch (err) {
    return { target, status: "error", message: errorMessage(err) };
  }
}

export async function exportSignal(signal: TrendSignal, targets: ExportTarget[], overrides: ExportOverrides = {}): Promise<ExportResult[]> {
  validateOverrides(overrides);
  return Promise.all([...new Set(targets)].map((t) => exportOne(t, signal, overrides)));
}
