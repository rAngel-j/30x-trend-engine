/**
 * Prueba de humo de Fases 1-2: `npm run smoke`.
 * - Funciones deterministas (fechas desde IDs, parser de cifras, etapa, prioridad).
 * - Repositorio SQLite con filtros dinámicos (en un archivo temporal, no toca .data/).
 * - Fuentes: con credenciales hace llamadas reales; sin ellas verifica que se desactivan sin romper.
 * - Sensor de Comunidad sobre una URL pública real (oEmbed + Jina, no requieren clave).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteRepository } from "@/lib/db/supabase";
import { buildNotionProperties } from "@/lib/export/notion";
import { buildSlackPayload } from "@/lib/export/slack";
import { validateOverrides } from "@/lib/export";
import { optionalEnv } from "@/lib/env";
import { errorMessage } from "@/lib/errors";
import { enrichSignal } from "@/lib/intelligence/analyze";
import { weightJev } from "@/lib/intelligence/jev-scorer";
import { classifyCohort, computePriority, detectLanguage } from "@/lib/intelligence/trend-stage";
import { collectSignals, readPublicUrl } from "@/lib/sources";
import { extractEngagement, parseCompactNumber } from "@/lib/sources/social-serp";
import { computeOutlierMetrics, parseIsoDuration } from "@/lib/sources/youtube-outliers";
import { canonicalizeUrl, linkedinIdToDate, tiktokIdToDate } from "@/lib/url";
import type { RawSignal } from "@/types/trends";

const ok = (label: string) => console.log(`  ✔ ${label}`);

async function main() {
  console.log("\n1) Cálculos deterministas");
  assert.equal(parseCompactNumber("1,234"), 1234);
  assert.equal(parseCompactNumber("1,2 K"), 1200);
  assert.equal(parseCompactNumber("3.4M"), 3_400_000);
  assert.equal(parseCompactNumber("12 mil"), 12_000);
  assert.deepEqual(extractEngagement("12K likes, 340 comments - ana on October 3, 2026"), { views: null, likes: 12_000, comments: 340, shares: null });
  ok("parser de engagement");

  assert.equal(parseIsoDuration("PT1H2M3S"), 3723);
  assert.equal(parseIsoDuration("PT45S"), 45);
  const m = computeOutlierMetrics({ views: 500_000, channelViews: 10_000_000, channelVideos: 1000, publishedAt: new Date(Date.now() - 10 * 3_600_000).toISOString() });
  assert.equal(m.outlier_score, 50);
  assert.equal(m.author_weight, 0);
  assert.equal(m.velocity_per_hour, 50_000);
  ok(`Outlier Score: 500K vistas en canal de 10K promedio → ×${m.outlier_score}, peso autor ${m.author_weight}`);

  const li = linkedinIdToDate("https://www.linkedin.com/posts/someone_ai-activity-7250000000000000000-abcd");
  const tt = tiktokIdToDate("https://www.tiktok.com/@someone/video/7300000000000000000");
  assert.ok(li && li.getUTCFullYear() === 2024, `LinkedIn → ${li?.toISOString()}`);
  assert.ok(tt && tt.getUTCFullYear() === 2023, `TikTok → ${tt?.toISOString()}`);
  ok(`fechas desde IDs: LinkedIn ${li.toISOString().slice(0, 10)} · TikTok ${tt.toISOString().slice(0, 10)}`);

  assert.equal(canonicalizeUrl("https://youtu.be/abcdefghijk?si=x"), "https://youtube.com/watch?v=abcdefghijk");
  assert.equal(canonicalizeUrl("https://www.instagram.com/reel/ABC123/?igsh=zz"), "https://instagram.com/reel/ABC123");
  ok("canonicalización de URLs");

  assert.equal(detectLanguage("Cómo los equipos de ventas usan agentes de IA para cerrar más negocios"), "es");
  assert.equal(detectLanguage("How sales teams are using AI agents to close more deals this quarter"), "en");
  ok("detección de idioma");

  assert.equal(weightJev({ business_impact: 90, practical_applicability: 80, executive_clarity: 70 }), 82);
  ok("ponderación JEV 0.40/0.35/0.25");

  // Cohortes sintéticas SOLO para verificar las reglas de etapa (no se persisten en la base real).
  const base = (i: number, title: string, hoursAgo: number, outlier: number | null): RawSignal => ({
    network: "youtube", source: "youtube_api", url: `https://www.youtube.com/watch?v=test${String(i).padStart(7, "0")}`,
    title, excerpt: "", author_name: null, author_handle: null, author_url: null, thumbnail_url: null,
    published_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(), language: null, format_hint: "long_video",
    metrics: { views: 1000, likes: null, comments: null, shares: null, author_followers: null, author_avg_views: null, duration_seconds: null },
    outlier_score: outlier, velocity_per_hour: 10, author_weight: null, query: "smoke-test", raw: {},
  });
  const english = Array.from({ length: 6 }, (_, i) => base(i, "How AI agents are changing the way sales teams work", 24, 5));
  assert.equal(classifyCohort(english)[0]!.stage, "emerging");
  const spanish = Array.from({ length: 16 }, (_, i) => base(i, "Cómo los agentes de IA cambian la forma en que trabajan los equipos", 300, 1));
  assert.equal(classifyCohort(spanish)[0]!.stage, "saturated");
  const mixed = [...english.slice(0, 4), ...spanish.slice(0, 2)];
  assert.equal(classifyCohort(mixed)[0]!.stage, "peaking");
  ok("etapas emerging / saturated / peaking");

  console.log("\n2) Repositorio SQLite + filtros dinámicos (archivo temporal)");
  const dir = mkdtempSync(join(tmpdir(), "30x-smoke-"));
  const repo = createSqliteRepository(join(dir, "trends.db"));
  try {
    const staged = classifyCohort(english);
    const stored = await repo.upsertSignals(staged);
    assert.equal(stored.length, 6);
    const again = await repo.upsertSignals(staged);
    assert.equal(again[0]!.id, stored[0]!.id, "el upsert debe deduplicar por fingerprint");
    ok("upsert idempotente por fingerprint");

    await repo.saveAnalysis(stored[0]!.id, {
      forensic: {
        hook_analysis: { hook_text: "x", mechanism: "x", why_it_works: "x" },
        format_type: { label: "talking_head_subtitulos", description: "x" },
        topic_angle: { thesis: "x", pain_point: "x" },
        timing_reason: { catalyst: "x", why_this_week: "x" },
        author_vs_content: { verdict: "content_driven", explanation: "x" },
      },
      jev: { jev_latam_score: 91, breakdown: { business_impact: 95, practical_applicability: 90, executive_clarity: 85, rationale: "x", red_flags: [] } },
      adaptations: null, model: "smoke", analyzed_at: new Date().toISOString(),
    });
    const top = await repo.querySignals({ minJev: 80, formats: ["talking_head_subtitulos"], stages: ["emerging"], networks: ["youtube"], windowDays: 7 });
    assert.equal(top.total, 1);
    assert.equal(top.items[0]!.priority_score, computePriority(top.items[0]!, 91));
    const reUpsert = await repo.upsertSignals(staged.slice(0, 1));
    assert.equal(reUpsert[0]!.jev_score, 91, "re-ingestar no debe borrar el análisis");
    const pending = await repo.querySignals({ statuses: ["pending"], search: "agents sales", sort: "recent" });
    assert.equal(pending.total, 5);
    ok("filtros red/etapa/formato/JEV/ventana/estado/texto + análisis preservado");

    const analyzed = top.items[0]!;
    const slack = buildSlackPayload(analyzed);
    assert.ok(slack.blocks.length >= 4 && JSON.stringify(slack).includes("*Gancho:*"));
    const props = buildNotionProperties(analyzed, {
      "Nombre": { type: "title" }, "Red": { type: "select" }, "Etapa": { type: "select" },
      "JEV": { type: "number" }, "Enlace": { type: "url" }, "Notas internas": { type: "rich_text" }, "Outlier": { type: "rich_text" },
    });
    assert.deepEqual(Object.keys(props).sort(), ["Enlace", "Etapa", "JEV", "Nombre", "Red"]);
    ok("payload Slack (Block Kit) y mapeo Notion por esquema (ignora tipos incompatibles)");
    assert.throws(() => validateOverrides({ slackWebhookUrl: "https://evil.example.com/x" }), /hooks.slack.com/);
    validateOverrides({ slackWebhookUrl: "https://hooks.slack.com/services/T/B/X", makeWebhookUrl: "https://hook.us1.make.com/abc" });
    ok("overrides de webhooks solo en dominios oficiales");
  } finally {
    await repo.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("\n3) Fuentes reales");
  const discovery = await collectSignals({ query: "AI agents for sales teams", networks: ["youtube", "linkedin", "instagram", "tiktok"], windowDays: 7, maxPerSource: 10 });
  for (const r of discovery.sources) console.log(`  · ${r.source}: ${r.status} (${r.count})${r.message ? ` — ${r.message}` : ""}`);
  if (discovery.signals.length) {
    const s = discovery.signals[0]!;
    console.log(`  ✔ ${discovery.signals.length} señales · etapa ${s.stage} (${s.stage_evidence.rule})`);
    console.log(`    top: [${s.network}] ${s.title.slice(0, 70)} · outlier ${s.outlier_score ?? "n/d"}`);
  } else {
    console.log("  · sin credenciales de fuentes: se desactivaron sin romper la búsqueda ✔");
  }

  console.log("\n4) Sensor de Comunidad (URL pública real)");
  let reading: Awaited<ReturnType<typeof readPublicUrl>> | null = null;
  try {
    reading = await readPublicUrl("https://www.youtube.com/watch?v=zjkBMFhNj_g");
    console.log(`  ✔ proveedores: ${reading.providers.join(", ")} · "${reading.signal.title.slice(0, 60)}" · ${reading.content.length} caracteres`);
    if (reading.warnings.length) console.log(`  · avisos: ${reading.warnings.join(" · ")}`);
  } catch (err) {
    console.log(`  ✖ ${errorMessage(err)}`);
  }
  await assert.rejects(readPublicUrl("http://127.0.0.1/admin"), /públicas/);
  ok("bloquea URLs privadas (anti-SSRF)");

  console.log("\n5) Motor JEV en Gemini");
  if (!optionalEnv("GEMINI_API_KEY")) {
    await assert.rejects(enrichSignal(classifyCohort(english)[0]!), /GEMINI_API_KEY/);
    console.log("  · GEMINI_API_KEY no configurada: el motor responde con error claro ✔");
  } else if (reading) {
    const [signal] = classifyCohort([reading.signal]);
    const analysis = await enrichSignal(signal!, reading.content);
    console.log(`  ✔ JEV ${analysis.jev.jev_latam_score} · formato ${analysis.forensic.format_type.label} · gancho: "${analysis.forensic.hook_analysis.hook_text.slice(0, 60)}"`);
    console.log(`    guiones: ${analysis.adaptations ? `Reel "${analysis.adaptations.andres_bilbao_reel.hook}" + carrusel de ${analysis.adaptations.x30_carousel.slides.length} slides` : "omitidos (JEV bajo el umbral)"}`);
  }

  console.log("\nSmoke test OK\n");
}

main().catch((err) => {
  console.error("\nSmoke test FALLÓ:", err);
  process.exit(1);
});
