/**
 * Prueba de humo de Fases 1-2: `npm run smoke`.
 * - Funciones deterministas (fechas desde IDs, parser de cifras, etapa, prioridad).
 * - Repositorio SQLite con filtros dinámicos (en un archivo temporal, no toca .data/).
 * - Fuentes: sin credenciales verifica que se desactivan sin romper. Con credenciales, las llamadas que gastan
 *   cuota (YouTube, Tavily, Gemini) solo corren con SMOKE_LIVE=1, para que `npm run check` nunca consuma cuota.
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
import { parseRetryDelay } from "@/lib/intelligence/gemini-client";
import { weightJev } from "@/lib/intelligence/jev-scorer";
import { computeTopicGrowth, representativeStrength, topicScore } from "@/lib/intelligence/topic-growth";
import { scrubHandles, scrubIndexedTitle } from "@/lib/privacy";
import { loadRadarSeeds, runRadar } from "@/lib/radar";
import { classifyCohort, computePriority, detectLanguage } from "@/lib/intelligence/trend-stage";
import { collectSignals, readPublicUrl } from "@/lib/sources";
import { extractEngagement, parseCompactNumber } from "@/lib/sources/social-serp";
import { computeOutlierMetrics, parseIsoDuration } from "@/lib/sources/youtube-outliers";
import { canonicalizeUrl, linkedinIdToDate, tiktokIdToDate } from "@/lib/url";
import type { RawSignal } from "@/types/trends";

const ok = (label: string) => console.log(`  ✔ ${label}`);
const LIVE = process.env.SMOKE_LIVE === "1";
const sourcesConfigured = () => Boolean(optionalEnv("YOUTUBE_API_KEY") || optionalEnv("TAVILY_API_KEY") || optionalEnv("GOOGLE_CSE_API_KEY"));

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
  // Reloj fijo: con Date.now() en dos momentos distintos la velocidad variaría según la carga de la máquina.
  const t0 = Date.now();
  const m = computeOutlierMetrics({ views: 500_000, channelViews: 10_000_000, channelVideos: 1000, publishedAt: new Date(t0 - 10 * 3_600_000).toISOString(), now: t0 });
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

  // Reintentos de Gemini: espera por minuto vs. cuota diaria agotada.
  assert.equal(parseRetryDelay("Please retry in 37.5s."), 37_500);
  assert.equal(parseRetryDelay("Please retry in 19h24m59.1s. (RESOURCE_EXHAUSTED)"), 69_899_100);
  assert.equal(parseRetryDelay("sin pista"), null);
  ok("Gemini: distingue límite por minuto (reintenta) de cuota diaria (avisa sin reintentar)");

  // Radar: crecimiento semanal determinista.
  const day = 86_400_000;
  const growthMembers = [
    ...Array.from({ length: 8 }, (_, i) => ({ published_at: new Date(t0 - (i + 1) * 0.5 * day).toISOString() })),
    ...Array.from({ length: 2 }, (_, i) => ({ published_at: new Date(t0 - (9 + i) * day).toISOString() })),
    { published_at: null },
  ];
  const g = computeTopicGrowth(growthMembers, t0);
  assert.deepEqual([g.this_week, g.last_week, g.growth_index, g.volume_index], [8, 2, 97.5, 80]);
  assert.equal(computeTopicGrowth([{ published_at: new Date(t0 - day).toISOString() }, { published_at: new Date(t0 - 10 * day).toISOString() }], t0).growth_index, 50);
  assert.equal(topicScore(g, 84), 90); // 0.5·97.5 + 0.2·80 + 0.3·84 = 89.95
  const tiny = { outlier_score: 4.08, metrics: { views: 653 } } as never;
  const solid = { outlier_score: 2, metrics: { views: 50_000 } } as never;
  assert.ok(representativeStrength(solid) > representativeStrength(tiny));
  ok("representante: 50.000 vistas ×2 le gana a 653 vistas ×4 (alcance + rendimiento relativo)");
  ok(`crecimiento por tema: 8 esta semana vs 2 la anterior → ${g.growth_index}/100; puntaje con JEV 84 → ${topicScore(g, 84)}`);

  // Privacidad: sin nombres ni handles en títulos indexados.
  assert.equal(scrubIndexedTitle("Ana Pérez en LinkedIn: Cómo usamos agentes de IA | 12 comments"), "Cómo usamos agentes de IA");
  assert.equal(scrubIndexedTitle("Juan (@juan.ia) • Instagram reel"), "");
  assert.equal(scrubHandles("Gracias @maria_ventas por la idea"), "Gracias @cuenta por la idea");
  ok("privacidad: se quitan nombres de autor y menciones de títulos y textos");

  const seeds = await loadRadarSeeds();
  assert.ok(seeds.length >= 2 && seeds.some((x) => /AI/.test(x)) && seeds.some((x) => /IA/.test(x)));
  ok(`semillas del radar desde el ADN: ${seeds.length} (español + inglés)`);

  // Cohortes sintéticas SOLO para verificar las reglas de etapa (no se persisten en la base real).
  const base = (i: number, title: string, hoursAgo: number, outlier: number | null): RawSignal => ({
    network: "youtube", source: "youtube_api", url: `https://www.youtube.com/watch?v=test${String(i).padStart(7, "0")}`,
    title, excerpt: "",
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

    // Retención de 30 días (políticas de la YouTube API): se envejece una señal y se purga.
    const { DatabaseSync } = await import("node:sqlite");
    await repo.close();
    const raw = new DatabaseSync(join(dir, "trends.db"));
    raw.prepare("UPDATE trend_signals SET last_seen_at = ? WHERE id = ?").run(new Date(Date.now() - 31 * 86_400_000).toISOString(), stored[1]!.id);
    raw.close();
    const purged = await repo.purgeExpiredYouTube();
    assert.equal(purged, 1);
    assert.equal((await repo.querySignals({})).total, 5);
    ok("retención: borra datos de YouTube no refrescados en 30 días");

    // Radar: guardar y leer una corrida con su pieza representativa.
    const remaining = (await repo.querySignals({})).items;
    const saved = await repo.saveRadar(
      { networks: ["youtube"], seeds: ["s1"], signals_found: remaining.length, sources: [], notes: [], took_ms: 1 },
      [{
        rank: 1, label: "Tema de prueba", thesis: "Tesis", this_week: 3, last_week: 1, growth_index: 80, volume_index: 30, score: 70,
        stage: "emerging", stage_score: 70, stage_evidence: remaining[0]!.stage_evidence, jev_score: 91, networks: ["youtube"],
        representative_id: remaining[0]!.id, member_ids: remaining.map((r) => r.id),
      }],
    );
    const latest = await repo.getRadar();
    assert.equal(latest?.run.id, saved.run.id);
    assert.equal(latest?.topics[0]?.representative?.id, remaining[0]!.id);
    ok("radar: corrida y temas guardados con su pieza representativa");
  } finally {
    await repo.close();
    rmSync(dir, { recursive: true, force: true });
  }

  const legacyDir = mkdtempSync(join(tmpdir(), "30x-legacy-"));
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const legacyPath = join(legacyDir, "trends.db");
    const old = new DatabaseSync(legacyPath);
    old.exec(`CREATE TABLE trend_signals (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, network TEXT NOT NULL, source TEXT NOT NULL,
      url TEXT NOT NULL, query TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', excerpt TEXT NOT NULL DEFAULT '',
      author_name TEXT, author_handle TEXT, author_url TEXT, thumbnail_url TEXT, language TEXT, format_hint TEXT NOT NULL DEFAULT 'unknown',
      published_at TEXT, metrics TEXT NOT NULL DEFAULT '{}', outlier_score REAL, velocity_per_hour REAL, author_weight REAL,
      stage TEXT NOT NULL, stage_score INTEGER NOT NULL, stage_evidence TEXT NOT NULL DEFAULT '{}', format_type TEXT, jev_score INTEGER,
      priority_score REAL NOT NULL DEFAULT 0, analysis TEXT, analysis_status TEXT NOT NULL DEFAULT 'pending', analysis_error TEXT,
      raw TEXT NOT NULL DEFAULT '{}', discovered_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)`);
    old.prepare("INSERT INTO trend_signals (id, fingerprint, network, source, url, query, author_name, author_handle, stage, stage_score, raw, discovered_at, last_seen_at) VALUES ('x','fp','linkedin','tavily','https://linkedin.com/posts/a','q','Ana Pérez','ana','peaking',50,?, '2026-01-01','2026-01-01')")
      .run(JSON.stringify({ submitted_by: "maria", channel_id: "UC123", provider: "tavily" }));
    old.close();
    const migrated = createSqliteRepository(legacyPath);
    const row = await migrated.getSignal("x");
    await migrated.close();
    const check = new DatabaseSync(legacyPath);
    const cols = (check.prepare("PRAGMA table_info(trend_signals)").all() as { name: string }[]).map((c) => c.name);
    check.close();
    assert.ok(!cols.some((c) => ["author_name", "author_handle", "author_url", "thumbnail_url"].includes(c)));
    assert.deepEqual(row?.raw, { provider: "tavily" });
    ok("privacidad: una base antigua pierde las columnas de identidad y los IDs al abrirse");
  } finally {
    rmSync(legacyDir, { recursive: true, force: true });
  }

  console.log("\n3) Fuentes reales");
  if (sourcesConfigured() && !LIVE) {
    console.log("  · omitido para no gastar cuota (ejecuta con SMOKE_LIVE=1 para llamar a YouTube/Tavily)");
  } else {
  const discovery = await collectSignals({ query: "AI agents for sales teams", networks: ["youtube", "linkedin", "instagram", "tiktok"], windowDays: 7, maxPerSource: 10 });
  for (const r of discovery.sources) console.log(`  · ${r.source}: ${r.status} (${r.count})${r.message ? ` — ${r.message}` : ""}`);
  if (discovery.signals.length) {
    const s = discovery.signals[0]!;
    console.log(`  ✔ ${discovery.signals.length} señales · etapa ${s.stage} (${s.stage_evidence.rule})`);
    console.log(`    top: [${s.network}] ${s.title.slice(0, 70)} · outlier ${s.outlier_score ?? "n/d"}`);
  } else {
    console.log("  · sin credenciales de fuentes: se desactivaron sin romper la búsqueda ✔");
  }
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

  // Cumplimiento: en redes cerradas nunca se descarga la página. Sin índice ni texto → error que pide el texto.
  const linkedinPost = "https://www.linkedin.com/posts/alguien_ia-activity-7250000000000000000-abcd";
  if (!optionalEnv("TAVILY_API_KEY") && !optionalEnv("GOOGLE_CSE_API_KEY")) {
    await assert.rejects(readPublicUrl(linkedinPost), /pega el texto/);
  }
  const withText = await readPublicUrl(linkedinPost, { text: "Así automatizamos la prospección con agentes de IA en un equipo de 4 personas." });
  assert.ok(withText.providers.includes("community_text") && !withText.providers.includes("jina"));
  assert.equal(withText.signal.published_at?.slice(0, 4), "2024");
  ok("LinkedIn: sin descargar la página; usa índice, oEmbed o el texto aportado por la persona");

  if (!optionalEnv("GEMINI_API_KEY")) {
    const tmpRepo = createSqliteRepository(join(tmpdir(), `30x-radar-${Date.now()}.db`));
    await assert.rejects(runRadar(tmpRepo, { networks: ["youtube"], maxTopics: 10 }), /GEMINI_API_KEY/);
    await tmpRepo.close();
    ok("radar: sin GEMINI_API_KEY responde con error claro (agrupar temas requiere IA)");
  }

  console.log("\n5) Motor JEV en Gemini");
  if (!optionalEnv("GEMINI_API_KEY")) {
    await assert.rejects(enrichSignal(classifyCohort(english)[0]!), /GEMINI_API_KEY/);
    console.log("  · GEMINI_API_KEY no configurada: el motor responde con error claro ✔");
  } else if (!LIVE) {
    console.log("  · omitido para no gastar cuota de Gemini (ejecuta con SMOKE_LIVE=1)");
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
