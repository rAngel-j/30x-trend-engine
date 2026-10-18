/**
 * Notion: crea una página en la base de contenidos de 30X.
 * Plug & play: lee el esquema de la base y solo llena las propiedades que existen con un tipo compatible.
 */
import { SourceError } from "@/lib/errors";
import { fetchJson } from "@/lib/http";
import type { TrendSignal } from "@/types/trends";
import { fiveVariables, NETWORK_LABEL, STAGE_LABEL, truncate } from "./format";

const API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const MAX_TEXT = 2000;
const MAX_BLOCKS = 100;

interface NotionProperty {
  type: string;
}

const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Alias aceptados por campo (sin acentos, minúsculas). */
const ALIASES = {
  network: ["red", "network", "plataforma", "canal"],
  stage: ["etapa", "stage", "etapa de tendencia"],
  format: ["formato", "format"],
  jev: ["jev", "jev score", "score jev", "score"],
  outlier: ["outlier", "outlier score"],
  url: ["url", "link", "enlace", "fuente"],
  published: ["publicado", "published", "fecha", "fecha de publicacion"],
} as const;

const richText = (content: string) => [{ type: "text", text: { content: truncate(content, MAX_TEXT) } }];

function choiceValue(type: string, value: string): unknown {
  if (type === "select") return { select: { name: truncate(value.replace(/,/g, " "), 100) } };
  if (type === "multi_select") return { multi_select: [{ name: truncate(value.replace(/,/g, " "), 100) }] };
  if (type === "rich_text") return { rich_text: richText(value) };
  return undefined;
}

export function buildNotionProperties(signal: TrendSignal, schema: Record<string, NotionProperty>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const titleKey = Object.entries(schema).find(([, p]) => p.type === "title")?.[0];
  if (titleKey) props[titleKey] = { title: richText(signal.title) };

  const find = (aliases: readonly string[]) => Object.entries(schema).find(([name]) => aliases.includes(normalize(name)));
  const assign = (aliases: readonly string[], build: (type: string) => unknown) => {
    const match = find(aliases);
    if (!match) return;
    const value = build(match[1].type);
    if (value !== undefined) props[match[0]] = value;
  };

  assign(ALIASES.network, (t) => choiceValue(t, NETWORK_LABEL[signal.network]));
  assign(ALIASES.stage, (t) => choiceValue(t, STAGE_LABEL[signal.stage]));
  if (signal.format_type) assign(ALIASES.format, (t) => choiceValue(t, signal.format_type!.replaceAll("_", " ")));
  if (signal.jev_score !== null) assign(ALIASES.jev, (t) => (t === "number" ? { number: signal.jev_score } : undefined));
  if (signal.outlier_score !== null) assign(ALIASES.outlier, (t) => (t === "number" ? { number: signal.outlier_score } : undefined));
  assign(ALIASES.url, (t) => (t === "url" ? { url: signal.url } : t === "rich_text" ? { rich_text: richText(signal.url) } : undefined));
  if (signal.published_at) assign(ALIASES.published, (t) => (t === "date" ? { date: { start: signal.published_at } } : undefined));
  return props;
}

const heading = (text: string) => ({ object: "block", type: "heading_2", heading_2: { rich_text: richText(text) } });
const paragraph = (text: string) => ({ object: "block", type: "paragraph", paragraph: { rich_text: richText(text) } });
const bullet = (text: string) => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richText(text) } });
const numbered = (text: string) => ({ object: "block", type: "numbered_list_item", numbered_list_item: { rich_text: richText(text) } });

export function buildNotionBlocks(signal: TrendSignal): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [
    paragraph(`${NETWORK_LABEL[signal.network]} · ${STAGE_LABEL[signal.stage]} · JEV ${signal.jev_score ?? "—"} · Outlier ${signal.outlier_score ?? "n/d"} · ${signal.url}`),
    paragraph(`Etapa: ${signal.stage_evidence.rule}`),
  ];
  const vars = fiveVariables(signal);
  if (vars) {
    blocks.push(heading("¿Por qué funcionó? — Autopsia 5D"));
    for (const [k, v] of vars) blocks.push(bullet(`${k}: ${v}`));
  }
  const jev = signal.analysis?.jev;
  if (jev) {
    blocks.push(heading(`Matriz JEV: ${jev.jev_latam_score}/100`));
    blocks.push(
      bullet(`Impacto en negocio: ${jev.breakdown.business_impact}`),
      bullet(`Aplicabilidad práctica: ${jev.breakdown.practical_applicability}`),
      bullet(`Claridad ejecutiva: ${jev.breakdown.executive_clarity}`),
      paragraph(jev.breakdown.rationale),
    );
    if (jev.breakdown.red_flags.length) blocks.push(paragraph(`Banderas rojas: ${jev.breakdown.red_flags.join(" · ")}`));
  }
  const ad = signal.analysis?.adaptations;
  if (ad) {
    blocks.push(heading(`Reel @andresbilbao (${ad.andres_bilbao_reel.duration_seconds} s)`), paragraph(`Gancho: ${ad.andres_bilbao_reel.hook}`));
    for (const b of ad.andres_bilbao_reel.beats) blocks.push(numbered(`[${b.second}s] ${b.line} — En pantalla: ${b.on_screen_text}`));
    blocks.push(paragraph(`CTA: ${ad.andres_bilbao_reel.cta}`));
    blocks.push(heading(`Carrusel @30x: ${ad.x30_carousel.title}`));
    for (const s of ad.x30_carousel.slides) blocks.push(numbered(`${s.headline} — ${s.body}`));
    blocks.push(paragraph(`Caption: ${ad.x30_carousel.caption}`), paragraph(`CTA: ${ad.x30_carousel.cta}`));
    if (ad.contrarian_angle) blocks.push(heading("Ángulo contrarian"), paragraph(ad.contrarian_angle));
    blocks.push(paragraph(`Ventana de publicación: ${ad.publish_window}`));
  }
  return blocks.slice(0, MAX_BLOCKS);
}

export async function sendToNotion(signal: TrendSignal, apiKey: string, databaseId: string): Promise<{ url: string }> {
  const headers = { Authorization: `Bearer ${apiKey}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" };
  const db = await fetchJson<{ properties?: Record<string, NotionProperty> }>("Notion", `${API}/databases/${encodeURIComponent(databaseId)}`, { headers });
  if (!db.properties) throw new SourceError("Notion", "la base de datos no expone propiedades (¿la integración tiene acceso?)");
  const page = await fetchJson<{ url?: string }>("Notion", `${API}/pages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: buildNotionProperties(signal, db.properties),
      children: buildNotionBlocks(signal),
    }),
  });
  return { url: page.url ?? "" };
}
