/** Slack Incoming Webhook con Block Kit. */
import { SourceError } from "@/lib/errors";
import type { TrendSignal } from "@/types/trends";
import { fiveVariables, headline, truncate } from "./format";

export function buildSlackPayload(signal: TrendSignal) {
  const vars = fiveVariables(signal);
  const ad = signal.analysis?.adaptations;
  const blocks: Record<string, unknown>[] = [
    { type: "header", text: { type: "plain_text", text: truncate(`📡 ${signal.title}`, 150), emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: headline(signal) }] },
  ];

  if (vars) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: truncate(vars.map(([k, v]) => `*${k}:* ${v}`).join("\n"), 3000) },
    });
  } else {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "_Aún sin autopsia: la señal está pendiente de análisis._" } });
  }

  if (ad) {
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: truncate(`*🎬 Reel @andresbilbao*\n${ad.andres_bilbao_reel.hook}`, 2000) },
          { type: "mrkdwn", text: truncate(`*🗂️ Carrusel @30x*\n${ad.x30_carousel.title} (${ad.x30_carousel.slides.length} slides)`, 2000) },
        ],
      },
    );
    if (ad.contrarian_angle) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: truncate(`*↯ Ángulo contrarian:* ${ad.contrarian_angle}`, 3000) } });
    }
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: truncate(`⏱️ ${ad.publish_window}`, 300) }] });
  }

  blocks.push({
    type: "actions",
    elements: [{ type: "button", text: { type: "plain_text", text: "Ver pieza original" }, url: signal.url }],
  });

  return { text: `Tendencia 30X: ${signal.title} (${headline(signal)})`, blocks };
}

export async function sendToSlack(signal: TrendSignal, webhookUrl: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSlackPayload(signal)),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new SourceError("Slack", `HTTP ${res.status}: ${truncate(await res.text().catch(() => ""), 200)}`, res.status);
}
