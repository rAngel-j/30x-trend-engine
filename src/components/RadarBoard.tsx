"use client";

import { ChevronDown, LoaderCircle, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, getLatestRadar, runRadarNow, type ExportResult, type ExportTarget } from "@/lib/client/api";
import { NETWORK_LABELS, relativeDate, SEARCHABLE_NETWORKS, STAGE_INFO } from "@/lib/client/labels";
import TrendCard, { StageMeter, stageExplanation } from "./TrendCard";
import { TREND_STAGES, type Network, type RadarResult, type RadarTopic, type TrendSignal, type TrendStage } from "@/types/trends";

interface RadarBoardProps {
  onAnalyze: (signal: TrendSignal) => Promise<TrendSignal | void>;
  onExport: (signal: TrendSignal, target: ExportTarget) => Promise<ExportResult>;
}

function growthText(t: RadarTopic): string {
  const names = t.networks.map((n) => NETWORK_LABELS[n]);
  const nets = names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names.at(-1)}` : (names[0] ?? "");
  const trend =
    t.last_week === 0
      ? `${t.this_week} ${t.this_week === 1 ? "pieza" : "piezas"} esta semana y ninguna la anterior`
      : `${t.this_week} ${t.this_week === 1 ? "pieza" : "piezas"} esta semana frente a ${t.last_week} la anterior`;
  return `${trend}, en ${nets}.`;
}

function TopicRow({ topic, expanded, onToggle, onAnalyze, onExport }: { topic: RadarTopic; expanded: boolean; onToggle: () => void } & RadarBoardProps) {
  const [rep, setRep] = useState<TrendSignal | null>(topic.representative ?? null);
  const [repOpen, setRepOpen] = useState(true);
  const rising = topic.growth_index >= 50;
  const panelId = `topic-${topic.id}`;

  return (
    <li className={`rounded-xl border bg-beige ${expanded ? "border-carbon" : "border-transparent hover:border-arena"}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="grid w-full grid-cols-[2.5rem_1fr] items-start gap-x-4 gap-y-3 p-4 text-left sm:grid-cols-[3rem_1fr_auto] sm:items-center"
      >
        <span className="wide pt-0.5 text-3xl leading-none font-bold text-dorado-hondo tabular-nums sm:text-4xl">{topic.rank}</span>
        <div className="min-w-0">
          <p className="semiwide text-lg leading-snug font-bold">{topic.label}</p>
          <p className="mt-1 line-clamp-2 text-sm text-tinta">{topic.thesis}</p>
        </div>
        <div className="col-span-2 flex items-center justify-between gap-5 sm:col-span-1 sm:justify-end">
          <div className="text-right" title="Piezas publicadas esta semana y la anterior">
            <p className="wide flex items-center justify-end gap-1 text-2xl leading-none font-bold tabular-nums">
              {rising ? <TrendingUp className="size-5 text-brote" aria-hidden /> : <TrendingDown className="size-5 text-ceniza" aria-hidden />}
              {topic.this_week}
              <span className="text-base font-semibold text-ceniza">/{topic.last_week}</span>
            </p>
            <p className="mt-1 text-xs text-tinta">esta semana / anterior</p>
          </div>
          <StageMeter stage={topic.stage} rule={topic.stage_evidence.rule} />
          <div className="min-w-12 text-right">
            <p className="wide text-2xl leading-none font-bold tabular-nums">{topic.jev_score ?? "—"}</p>
            <p className="mt-1 text-xs text-tinta">JEV</p>
          </div>
          <ChevronDown className={`size-5 shrink-0 text-tinta transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
        </div>
      </button>

      {expanded && (
        <div id={panelId} className="space-y-4 px-4 pb-5 sm:pl-20">
          <section className="border-t border-arena pt-4">
            <h3 className="semiwide mb-2 text-base font-semibold">Por qué está creciendo</h3>
            <p className="max-w-prose text-sm">
              {growthText(topic)} <span className="text-tinta">Crecimiento {topic.growth_index}/100 (50 = estable).</span>
            </p>
            <p className="mt-2 max-w-prose text-sm">
              {STAGE_INFO[topic.stage].hint} <span className="text-tinta">{stageExplanation(topic.stage_evidence)}</span>
            </p>
          </section>
          {rep ? (
            <section>
              <h3 className="semiwide mb-2 text-base font-semibold">La pieza que mejor lo representa</h3>
              <p className="mb-3 max-w-prose text-sm text-tinta">Su autopsia explica por qué funciona el tema; sus guiones son la adaptación propuesta para 30X.</p>
              <ol>
                <TrendCard
                  inTopic
                  signal={rep}
                  rank={topic.rank}
                  expanded={repOpen}
                  onToggle={() => setRepOpen((v) => !v)}
                  onAnalyze={async (s) => {
                    const updated = await onAnalyze(s);
                    if (updated) setRep(updated);
                  }}
                  onExport={onExport}
                />
              </ol>
            </section>
          ) : (
            <p className="text-sm text-tinta">La pieza representativa ya no está disponible (los datos de YouTube se borran a los 30 días).</p>
          )}
        </div>
      )}
    </li>
  );
}

export default function RadarBoard({ onAnalyze, onExport }: RadarBoardProps) {
  const [radar, setRadar] = useState<RadarResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [networks, setNetworks] = useState<Exclude<Network, "web">[]>([...SEARCHABLE_NETWORKS]);
  const [stageFilter, setStageFilter] = useState<TrendStage[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    getLatestRadar()
      .then(setRadar)
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 404)) setError(err instanceof ApiError ? err.message : "No se pudo cargar el último radar.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const run = async () => {
    setRunning(true);
    setElapsed(0);
    setError(null);
    try {
      const result = await runRadarNow({ networks });
      setRadar(result);
      setExpandedId(result.topics[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "El radar no terminó. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setRunning(false);
    }
  };

  const topics = (radar?.topics ?? []).filter((t) => stageFilter.length === 0 || stageFilter.includes(t.stage));

  return (
    <section aria-labelledby="radar-title" className="pt-8 pb-6 sm:pt-14">
      <h1 id="radar-title" className="semiwide max-w-4xl text-4xl leading-[1.08] font-bold sm:text-6xl">
        Los 10 temas de IA que más crecen esta semana
      </h1>
      <p className="mt-4 max-w-2xl text-tinta">
        Por qué está creciendo cada uno, si le sirve a ejecutivos y equipos de Latinoamérica y cómo adaptarlo para @andresbilbao y @30x.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Redes del radar</legend>
          {SEARCHABLE_NETWORKS.map((n) => {
            const active = networks.includes(n);
            return (
              <button
                key={n}
                type="button"
                aria-pressed={active}
                disabled={running}
                onClick={() => setNetworks((list) => (active ? list.filter((x) => x !== n) : [...list, n]))}
                className={`rounded-full border px-3 py-1 text-sm ${active ? "border-carbon bg-carbon text-crema" : "border-arena text-tinta hover:border-carbon"}`}
              >
                {NETWORK_LABELS[n]}
              </button>
            );
          })}
        </fieldset>
        <button
          type="button"
          onClick={run}
          disabled={running || networks.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-dorado px-5 py-2.5 font-semibold text-carbon hover:bg-dorado/85 disabled:opacity-60"
        >
          {running ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
          {running ? `Actualizando… ${elapsed} s` : "Actualizar radar"}
        </button>
        {radar && !running && <span className="text-sm text-tinta">Última actualización {relativeDate(radar.run.created_at)}</span>}
      </div>

      <div role="status" className="mt-3 space-y-1 text-sm">
        {running && <p className="text-tinta">Buscando en vivo, agrupando temas y analizando la pieza clave de cada uno. Suele tardar entre 2 y 4 minutos.</p>}
        {error && <p className="text-alerta">{error}</p>}
        {radar?.run.notes.map((n) => (
          <p key={n} className="text-dorado-hondo">
            {n}
          </p>
        ))}
        {radar?.run.sources
          .filter((s) => s.status !== "ok")
          .map((s) => (
            <p key={s.source} className="text-tinta">
              {s.source === "youtube_api" ? "YouTube" : "LinkedIn, Instagram y TikTok"}: {s.status === "disabled" ? "sin conectar" : "falló"}. {s.message}
            </p>
          ))}
      </div>

      {radar && radar.topics.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar temas por etapa">
          {TREND_STAGES.map((s) => {
            const active = stageFilter.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => setStageFilter((list) => (active ? list.filter((x) => x !== s) : [...list, s]))}
                className={`rounded-full border px-3 py-1 text-sm ${active ? "border-carbon bg-carbon text-crema" : "border-arena bg-crema text-tinta hover:border-carbon"}`}
              >
                {STAGE_INFO[s].emoji} {STAGE_INFO[s].label}
              </button>
            );
          })}
          <span className="text-sm text-tinta">
            {radar.run.signals_found} piezas analizadas de {radar.run.seeds.length} búsquedas
          </span>
        </div>
      )}

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-tinta">Cargando el último radar…</p>
        ) : !radar ? (
          <div className="rounded-xl border border-dashed border-arena p-8">
            <p className="semiwide text-lg font-semibold">Todavía no hay radar de esta semana.</p>
            <p className="mt-2 max-w-prose text-sm text-tinta">
              Pulsa Actualizar radar: buscamos en las redes elegidas con las semillas del ADN de marca, agrupamos las piezas en temas y medimos cuáles crecen.
            </p>
          </div>
        ) : topics.length === 0 ? (
          <p className="rounded-xl border border-dashed border-arena p-6 text-sm text-tinta">
            {radar.topics.length === 0 ? "Este radar no encontró temas con al menos 2 piezas." : "Ningún tema está en las etapas elegidas."}
          </p>
        ) : (
          <ol className="space-y-2">
            {topics.map((t) => (
              <TopicRow
                key={t.id}
                topic={t}
                expanded={expandedId === t.id}
                onToggle={() => setExpandedId((id) => (id === t.id ? null : t.id))}
                onAnalyze={onAnalyze}
                onExport={onExport}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
