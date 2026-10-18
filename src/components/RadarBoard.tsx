"use client";

import { Check, ChevronDown, LoaderCircle, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, getLatestRadar, runRadarNow, type ExportResult, type ExportTarget } from "@/lib/client/api";
import { NETWORK_LABELS, relativeDate, SEARCHABLE_NETWORKS, STAGE_INFO } from "@/lib/client/labels";
import InfoTip, { HELP } from "./InfoTip";
import SetupNotice from "./SetupNotice";
import ToggleRow from "./ToggleRow";
import TrendCard, { StageMeter, stageExplanation } from "./TrendCard";
import { TREND_STAGES, type BrandProfile, type Network, type RadarResult, type RadarTopic, type TrendSignal, type TrendStage } from "@/types/trends";

interface RadarBoardProps {
  profile: BrandProfile | null;
  onAnalyze: (signal: TrendSignal) => Promise<TrendSignal | void>;
  onExport: (signal: TrendSignal, target: ExportTarget) => Promise<ExportResult>;
}

/** Cómo trabaja el radar: es una secuencia real (cada paso usa el resultado del anterior). */
const HOW_IT_WORKS = [
  { title: "Busca en vivo", body: "YouTube API e índices públicos de LinkedIn, Instagram y TikTok, en español e inglés. Sin cuentas ni scraping." },
  { title: "Explica por qué", body: "El código mide crecimiento, Outlier y etapa; la IA hace la autopsia de 5 variables de la pieza clave." },
  { title: "Adapta a tu marca", body: "Score JEV para tu audiencia y guiones listos para tus dos voces, con envío a Slack o Notion." },
];

/** Pasos típicos de una corrida. El servidor no informa el avance: se estima por tiempo y así se indica. */
const STEPS = [
  { until: 50, label: "Buscando en las redes con las semillas del perfil" },
  { until: 95, label: "Agrupando las piezas en temas" },
  { until: 150, label: "Analizando la pieza clave de cada tema" },
  { until: Infinity, label: "Escribiendo los guiones" },
];

function growthText(t: RadarTopic): string {
  const names = t.networks.map((n) => NETWORK_LABELS[n]);
  const nets = names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names.at(-1)}` : (names[0] ?? "");
  const trend =
    t.last_week === 0
      ? `${t.this_week} ${t.this_week === 1 ? "pieza" : "piezas"} esta semana y ninguna la anterior`
      : `${t.this_week} ${t.this_week === 1 ? "pieza" : "piezas"} esta semana frente a ${t.last_week} la anterior`;
  return `${trend}, en ${nets}.`;
}

function TopicRow({ topic, expanded, onToggle, onAnalyze, onExport }: { topic: RadarTopic; expanded: boolean; onToggle: () => void } & Omit<RadarBoardProps, "profile">) {
  const [rep, setRep] = useState<TrendSignal | null>(topic.representative ?? null);
  const [repOpen, setRepOpen] = useState(true);
  const rising = topic.growth_index >= 50;
  const panelId = `topic-${topic.id}`;

  return (
    <li className={`rounded-xl border bg-beige ${expanded ? "border-carbon" : "border-transparent hover:border-arena"}`}>
      <ToggleRow
        expanded={expanded}
        controls={panelId}
        onToggle={onToggle}
        className="grid w-full grid-cols-[2.5rem_1fr] items-start gap-x-4 gap-y-3 p-4 text-left sm:grid-cols-[3rem_1fr_auto] sm:items-center"
      >
        <span className="wide pt-0.5 text-3xl leading-none font-bold text-dorado-hondo tabular-nums sm:text-4xl">{topic.rank}</span>
        <div className="min-w-0">
          <p className="semiwide text-lg leading-snug font-bold">{topic.label}</p>
          <p className="mt-1 line-clamp-2 text-sm text-tinta">{topic.thesis}</p>
        </div>
        <div className="col-span-2 flex items-center justify-between gap-5 sm:col-span-1 sm:justify-end">
          <div className="text-right">
            <p className="wide flex items-center justify-end gap-1 text-2xl leading-none font-bold tabular-nums">
              {rising ? <TrendingUp className="size-5 text-brote" aria-hidden /> : <TrendingDown className="size-5 text-ceniza" aria-hidden />}
              {topic.this_week}
              <span className="text-base font-semibold text-ceniza">/{topic.last_week}</span>
            </p>
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-tinta">
              esta semana / anterior <InfoTip label="esta semana / anterior">{HELP.growth}</InfoTip>
            </p>
          </div>
          <StageMeter stage={topic.stage} rule={topic.stage_evidence.rule} />
          <div className="min-w-12 text-right">
            <p className="wide text-2xl leading-none font-bold tabular-nums">{topic.jev_score ?? "—"}</p>
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-tinta">
              JEV <InfoTip label="el score JEV">{HELP.jev}</InfoTip>
            </p>
          </div>
          <ChevronDown className={`size-5 shrink-0 text-tinta transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
        </div>
      </ToggleRow>

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
              <p className="mb-3 max-w-prose text-sm text-tinta">Su autopsia explica por qué funciona el tema; sus guiones son la adaptación propuesta.</p>
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

export default function RadarBoard({ profile, onAnalyze, onExport }: RadarBoardProps) {
  const [radar, setRadar] = useState<RadarResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [networks, setNetworks] = useState<Exclude<Network, "web">[]>([...SEARCHABLE_NETWORKS]);
  const [stageFilter, setStageFilter] = useState<TrendStage[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const profileId = profile?.id ?? null;

  useEffect(() => {
    if (!profileId) return;
    setLoading(true);
    setRadar(null);
    setError(null);
    setExpandedId(null);
    getLatestRadar(profileId)
      .then(setRadar)
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 404)) setError(err instanceof ApiError ? err.message : "No se pudo cargar el último radar.");
      })
      .finally(() => setLoading(false));
  }, [profileId]);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const run = async () => {
    if (!profileId) return;
    setRunning(true);
    setElapsed(0);
    setError(null);
    try {
      const result = await runRadarNow({ networks, profileId });
      setRadar(result);
      setExpandedId(result.topics[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "El radar no terminó. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setRunning(false);
    }
  };

  const topics = (radar?.topics ?? []).filter((t) => stageFilter.length === 0 || stageFilter.includes(t.stage));
  const activeStep = STEPS.findIndex((s) => elapsed < s.until);

  return (
    <section aria-labelledby="radar-title" className="pt-8 pb-6 sm:pt-12">
      <h1 id="radar-title" className="semiwide max-w-4xl text-4xl leading-[1.08] font-bold sm:text-6xl">
        {radar && radar.topics.length > 0 && radar.topics.length < 10
          ? `Los ${radar.topics.length} temas que más crecen esta semana`
          : "Los 10 temas que más crecen esta semana"}
      </h1>
      <p className="mt-4 max-w-2xl text-tinta">
        {profile ? (
          <>
            Para <strong className="font-semibold text-carbon">{profile.name}</strong>: {profile.audience.charAt(0).toLowerCase() + profile.audience.slice(1)}. Con el porqué de cada
            tema y guiones listos para {profile.personal_label} y {profile.brand_label}.
          </>
        ) : (
          "Cargando perfil…"
        )}
      </p>

      <ol className="mt-6 grid max-w-4xl gap-3 sm:grid-cols-3">
        {HOW_IT_WORKS.map((step, i) => (
          <li key={step.title} className="flex gap-3 rounded-xl border border-arena p-3">
            <span className="wide text-lg leading-6 font-bold text-dorado-hondo tabular-nums">{i + 1}</span>
            <div>
              <p className="text-sm font-semibold">{step.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-tinta">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <SetupNotice />

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
          disabled={running || networks.length === 0 || !profileId}
          className="inline-flex items-center gap-2 rounded-lg bg-dorado px-5 py-2.5 font-semibold text-[#18181b] hover:bg-dorado/85 disabled:opacity-60"
        >
          {running ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
          {running ? `Actualizando… ${elapsed} s` : "Actualizar radar"}
        </button>
        {radar && !running && <span className="text-sm text-tinta">Última actualización {relativeDate(radar.run.created_at)}</span>}
      </div>

      <div role="status" className="mt-4 space-y-1 text-sm">
        {running && (
          <div className="max-w-xl rounded-xl border border-arena p-4">
            <p className="mb-2 text-tinta">Suele tardar entre 2 y 4 minutos. Pasos aproximados:</p>
            <ol className="space-y-1">
              {STEPS.map((s, i) => (
                <li key={s.label} className={`flex items-center gap-2 ${i < activeStep ? "text-tinta" : i === activeStep ? "font-semibold" : "text-ceniza"}`}>
                  {i < activeStep ? (
                    <Check className="size-4 text-brote" aria-hidden />
                  ) : i === activeStep ? (
                    <LoaderCircle className="size-4 animate-spin text-dorado-hondo" aria-hidden />
                  ) : (
                    <span className="size-4" aria-hidden />
                  )}
                  {s.label}
                </li>
              ))}
            </ol>
          </div>
        )}
        {error && <p className="text-alerta">{error}</p>}
        {!running &&
          radar?.run.notes.map((n) => (
            <p key={n} className="text-dorado-hondo">
              {n}
            </p>
          ))}
        {!running &&
          radar?.run.sources
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
          <InfoTip label="las etapas">{HELP.stage}</InfoTip>
          <span className="ml-1 text-sm text-tinta">
            {radar.run.signals_found} piezas revisadas en {radar.run.seeds.length} búsquedas
          </span>
        </div>
      )}

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-tinta">Cargando el último radar…</p>
        ) : !radar ? (
          <div className="rounded-xl border border-dashed border-arena p-8">
            <p className="semiwide text-lg font-semibold">Todavía no hay radar para este perfil.</p>
            <p className="mt-2 max-w-prose text-sm text-tinta">
              Pulsa Actualizar radar: buscamos en las redes elegidas con las semillas del perfil, agrupamos las piezas en temas y medimos cuáles crecen.
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
