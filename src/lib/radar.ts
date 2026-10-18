/**
 * Radar semanal: los temas que más crecen esta semana para un perfil de marca, por qué y cómo adaptarlos.
 * Responde el entregable del reto. Flujo y fórmulas: docs/ARCHITECTURE.md §7b-quater; perfiles: §7b-quinquies.
 */
import type { NewRadarTopic, TrendRepository } from "@/lib/db/supabase";
import { requireEnv } from "@/lib/env";
import { InvalidInputError } from "@/lib/errors";
import { mapWithConcurrency } from "@/lib/http";
import { clusterTopics } from "@/lib/intelligence/topic-clusterer";
import { computeTopicGrowth, pickRepresentative, topicScore } from "@/lib/intelligence/topic-growth";
import { evaluateStage } from "@/lib/intelligence/trend-stage";
import { analyzedFor, analyzeStoredBatch } from "@/lib/pipeline";
import { collectSignals, mergeReports } from "@/lib/sources";
import { canonicalizeUrl } from "@/lib/url";
import type { BrandProfile, Network, RadarResult, SourceReport, StagedSignal, TrendSignal } from "@/types/trends";

const NETWORK_NAMES: Record<Network, string> = { youtube: "YouTube", linkedin: "LinkedIn", instagram: "Instagram", tiktok: "TikTok", web: "Web" };

/** Una búsqueda de 14 días por semilla permite contar esta semana y la anterior sin pagar dos búsquedas. */
export const RADAR_WINDOW_DAYS = 14;
const PER_SOURCE = 15;
const SEED_CONCURRENCY = 3;
const EXTRA_CANDIDATES = 2;

export interface RadarOptions {
  networks: Exclude<Network, "web">[];
  maxTopics: number;
  profile: BrandProfile;
}

export async function runRadar(repo: TrendRepository, options: RadarOptions): Promise<RadarResult> {
  const started = Date.now();
  requireEnv("GEMINI_API_KEY", "El Radar semanal (agrupar piezas en temas)");
  const { profile } = options;
  const seeds = profile.seeds;
  if (seeds.length < 2) throw new InvalidInputError(`El perfil ${profile.name} necesita al menos 2 semillas para el radar.`);
  const notes: string[] = [];

  // 1. Ingesta: una búsqueda de 14 días por semilla.
  const runs = await mapWithConcurrency(seeds, SEED_CONCURRENCY, (seed) =>
    collectSignals({ query: seed, networks: options.networks, windowDays: RADAR_WINDOW_DAYS, maxPerSource: PER_SOURCE }),
  );
  const sources: SourceReport[] = mergeReports(runs.flatMap((r) => r.sources));

  const seen = new Set<string>();
  const unique: StagedSignal[] = runs.flatMap((r) => r.signals).filter((s) => {
    const key = canonicalizeUrl(s.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const stored = await repo.upsertSignals(unique);

  // 2. Temas: Gemini agrupa; el código mide.
  const recentFirst = [...stored].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  const clusters = stored.length >= 2 ? await clusterTopics(recentFirst, profile) : [];
  if (clusters.length === 0) notes.push("No hubo piezas suficientes para formar temas. Revisa las fuentes conectadas o amplía las semillas.");

  const now = Date.now();

  // Los buscadores tardan días en indexar LinkedIn, Instagram y TikTok: medir "esta semana" contra hoy haría
  // que todo pareciera decrecer. Cada red se ancla a la fecha más reciente que ya tiene indexada
  // y se mide la última semana CUBIERTA (docs/ARCHITECTURE.md §7b-quater).
  const anchors = new Map<Network, number>();
  for (const s of stored) {
    const t = s.published_at ? new Date(s.published_at).getTime() : NaN;
    if (Number.isFinite(t) && t <= now) anchors.set(s.network, Math.max(anchors.get(s.network) ?? 0, t));
  }
  const DAY = 86_400_000;
  for (const [network, anchor] of anchors) {
    if (now - anchor > DAY) {
      notes.push(`${NETWORK_NAMES[network]}: el índice de búsqueda llega hasta el ${new Date(anchor).toLocaleDateString("es-CO", { day: "numeric", month: "long" })}; "esta semana" se mide hasta esa fecha.`);
    }
  }
  const aligned = (s: TrendSignal): TrendSignal => {
    const anchor = anchors.get(s.network);
    if (!s.published_at || anchor === undefined) return s;
    return { ...s, published_at: new Date(new Date(s.published_at).getTime() + (now - anchor)).toISOString() };
  };

  const candidates = clusters
    .map((c) => {
      const members = c.members.map(aligned);
      const growth = computeTopicGrowth(members, now);
      const stage = evaluateStage(members, now);
      return { ...c, alignedMembers: members, growth, stage, preScore: topicScore(growth, null) };
    })
    // Un tema necesita al menos 2 piezas dentro de las dos semanas medidas para tener evidencia de tendencia.
    .filter((c) => c.growth.this_week + c.growth.last_week >= 2)
    .sort((a, b) => b.preScore - a.preScore)
    .slice(0, options.maxTopics + EXTRA_CANDIDATES);

  // 3. Por qué funciona y cómo adaptarlo: autopsia de la pieza más representativa de cada tema.
  // Un solo lote para todas las piezas representativas: 2 solicitudes a Gemini en total.
  // La pieza se elige con fechas alineadas, pero se guarda/analiza la pieza original.
  const withRep = candidates.map((c) => {
    const picked = pickRepresentative(c.alignedMembers, now);
    return { ...c, rep: picked ? c.members.find((m) => m.id === picked.id) ?? null : null };
  });
  // Se reutiliza el análisis guardado salvo que no cumpla la regla de su tema: un tema saturado
  // exige ángulo contrarian, y la pieza pudo analizarse antes con otra etapa.
  const needsAnalysis = (c: (typeof withRep)[number]) => {
    const rep = c.rep;
    if (!rep) return false;
    if (!analyzedFor(rep, profile)) return true;
    if (rep.analysis?.scripts_error) return true; // guiones que fallaron en una corrida anterior
    const scripts = rep.analysis?.adaptations;
    return c.stage.stage === "saturated" && Boolean(scripts) && !scripts!.contrarian_angle;
  };
  const pending = withRep.filter(needsAnalysis).map((c) => c.rep!);
  // Los guiones obedecen la etapa del TEMA: si está saturado, el ángulo contrarian es obligatorio.
  const topicStage = new Map(withRep.filter((c) => c.rep).map((c) => [c.rep!.id, c.stage.stage]));
  const fresh = new Map((await analyzeStoredBatch(repo, pending, profile, topicStage)).map((s) => [s.id, s]));
  const analyzed = withRep.map((c) => ({ ...c, rep: c.rep ? fresh.get(c.rep.id) ?? c.rep : null }));
  const failed = analyzed.filter((c) => c.rep?.analysis_status === "failed");
  if (failed.length) notes.push(`${failed.length} de ${analyzed.length} temas quedaron sin autopsia: ${failed[0]!.rep!.analysis_error}`);

  const topics: NewRadarTopic[] = analyzed
    .map((c) => {
      const jev = c.rep?.jev_score ?? null;
      return {
        rank: 0,
        label: c.label,
        thesis: c.thesis,
        ...c.growth,
        score: topicScore(c.growth, jev),
        stage: c.stage.stage,
        stage_score: c.stage.score,
        stage_evidence: c.stage.evidence,
        jev_score: jev,
        networks: [...new Set(c.members.map((m) => m.network))],
        representative_id: c.rep?.id ?? null,
        member_ids: c.members.map((m) => m.id),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxTopics)
    .map((t, i) => ({ ...t, rank: i + 1 }));

  return repo.saveRadar(
    { profile_id: profile.id, networks: options.networks, seeds, signals_found: stored.length, sources, notes: [...new Set(notes)], took_ms: Date.now() - started },
    topics,
  );
}
