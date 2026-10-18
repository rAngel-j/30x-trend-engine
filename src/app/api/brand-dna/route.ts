/**
 * GET | PUT /api/brand-dna — lee y edita docs/30X_BRAND_DNA.md (configuración viva del adaptador).
 * Contrato: docs/API_CONTRACTS.md §3.
 */
import { constants } from "node:fs";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, assertWebhookAuth, errorResponse, parseJsonBody } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DNA_PATH = resolve(process.cwd(), "docs", "30X_BRAND_DNA.md");
const DnaBody = z.object({ content: z.string().min(200).max(40_000) });

export async function GET() {
  try {
    const [content, info, editable] = await Promise.all([
      readFile(DNA_PATH, "utf8"),
      stat(DNA_PATH),
      access(DNA_PATH, constants.W_OK).then(() => true, () => false),
    ]);
    return NextResponse.json({ content, updated_at: info.mtime.toISOString(), editable });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: Request) {
  try {
    assertWebhookAuth(req);
    const { content } = await parseJsonBody(req, DnaBody);
    try {
      await writeFile(DNA_PATH, content.replace(/\r\n/g, "\n"), "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
        return apiError("READ_ONLY", "El servidor no permite escribir archivos. Edita docs/30X_BRAND_DNA.md en el repositorio y vuelve a desplegar.", 409);
      }
      throw err;
    }
    const info = await stat(DNA_PATH);
    return NextResponse.json({ updated_at: info.mtime.toISOString() });
  } catch (err) {
    return errorResponse(err);
  }
}
