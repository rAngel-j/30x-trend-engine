/**
 * Radar semanal: los temas de IA que más crecen esta semana, por qué y cómo adaptarlos.
 * Responde el entregable del reto. Flujo y fórmulas: docs/ARCHITECTURE.md §7b-quater.
 */
import type { NewRadarTopic, TrendRepository } from "@/lib/db/supabase";
import { requireEnv } from "@/lib/env";
import { errorMessage, InvalidInputError } from "@/lib/errors";
import { mapWithConcurrency } from "@/lib/http";
import { loadBrandDna } from "@/lib/intelligence/gemini-client";
import { clusterTopics } from "@/lib/intelligence/topic-clusterer";
import { computeTopicGrowth, pickRepresentative, topicScore } from "@/lib/intelligence/topic-growth";
import { evaluateStage } from "@/lib/intelligence/trend-stage";
import { analyzeStoredSignal } from "@/lib/pipeline";
import { collectSignals, mergeReports } from "@/lib/sources";
import { canonicalizeUrl } from "@/lib/url";
import type { Network, RadarResult, SourceReport, StagedSignal, TrendSignal } from "@/types/trends";

/** Una búsqueda de 14 días por semilla permite contar esta semana y la anterior sin pagar dos búsquedas. */
export const RADAR_WINDOW_DAYS = 14;
const PER_SOURCE = 15;
const SEED_CONCURRENCY = 3;
const AI_CONCURRENCY = 2;
const EXTRA_CANDIDATES = 2;

/** Lee las semillas de la sección "Semillas del Radar semanal" de docs/30X_BRAND_DNA.md. */
export async function loadRadarSeeds(): Promise<string[]> {
  const dna = await loadBrandDna();
  const start = dna.search(/^##\s+\d*\.?\s*Semillas del Radar/im);
  if (start < 0) throw new InvalidInputError("El ADN de marca no tiene la sección 'Semillas del Radar semanal'.");
  const section = dna.slice(start).split(/\n##\s/)[0]!;
  const seeds = [...section.matchAll(/^\s*-\s+(.+?)\s*$/gm)].map((m) => m[1]!).filter((s) => s.length >= 2 && s.length <= 200);
  if (seeds.length === 0) throw new InvalidInputError("La sección de semillas del Radar está vacía.");
  return [...new Set(seeds)].slice(0, 16);
}

export interface RadarOptions {
  networks: Exclude<Network, "web">[];
  maxTopics: number;
}

export async function runRadar(repo: TrendRepository, options: RadarOptions): Promise<RadarResult> {
  const started = Date.now();
  requireEnv("GEMINI_API_KEY", "El Radar semanal (agrupar piezas en temas)");
  const seeds = await loadRadarSeeds();
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
  const clusters = stored.length >= 2 ? await clusterTopics(recentFirst) : [];
  if (clusters.length === 0) notes.push("No hubo piezas suficientes para formar temas. Revisa las fuentes conectadas o amplía las semillas.");

  const now = Date.now();
  const candidates = clusters
    .map((c) => {
      const growth = computeTopicGrowth(c.members, now);
      const stage = evaluateStage(c.members, now);
      return { ...c, growth, stage, preScore: topicScore(growth, null) };
    })
    .sort((a, b) => b.preScore - a.preScore)
    .slice(0, options.maxTopics + EXTRA_CANDIDATES);

  // 3. Por qué funciona y cómo adaptarlo: autopsia de la pieza más representativa de cada tema.
  const analyzed = await mapWithConcurrency(candidates, AI_CONCURRENCY, async (c) => {
    let rep: TrendSignal | null = pickRepresentative(c.members, now);
    if (rep && rep.analysis_status !== "analyzed") {
      try {
        rep = await analyzeStoredSignal(repo, rep);
      } catch (err) {
        notes.push(`No se pudo analizar la pieza representativa de "${c.label}": ${errorMessage(err)}`);
      }
    }
    return { ...c, rep };
  });

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
    { networks: options.networks, seeds, signals_found: stored.length, sources, notes: [...new Set(notes)], took_ms: Date.now() - started },
    topics,
  );
}
