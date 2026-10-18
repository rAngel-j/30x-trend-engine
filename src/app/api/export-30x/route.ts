/**
 * POST /api/export-30x — Plug & Play: envía una tendencia a Slack, Notion y/o Make en 1 clic.
 * Contrato: docs/API_CONTRACTS.md §3.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, parseJsonBody } from "@/lib/api";
import { getTrendRepository } from "@/lib/db/supabase";
import { NotFoundError } from "@/lib/errors";
import { EXPORT_TARGETS, exportSignal } from "@/lib/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ExportBody = z.object({
  id: z.string().trim().min(1).max(64),
  targets: z.array(z.enum(EXPORT_TARGETS)).min(1).default(["slack", "notion", "make"]),
  overrides: z
    .object({
      slackWebhookUrl: z.string().trim().url().optional(),
      makeWebhookUrl: z.string().trim().url().optional(),
      notionApiKey: z.string().trim().min(10).max(200).optional(),
      notionDatabaseId: z.string().trim().optional(),
    })
    .default({}),
});

export async function POST(req: Request) {
  try {
    const body = await parseJsonBody(req, ExportBody);
    const signal = await getTrendRepository().getSignal(body.id);
    if (!signal) throw new NotFoundError(`No existe la señal ${body.id}.`);
    const results = await exportSignal(signal, body.targets, body.overrides);
    return NextResponse.json({ results });
  } catch (err) {
    return errorResponse(err);
  }
}
