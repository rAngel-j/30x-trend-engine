"use client";

import { Check, ChevronDown, Copy, ExternalLink, LoaderCircle, Send, Sparkles, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ExportResult, ExportTarget } from "@/lib/client/api";
import { compact, FORMAT_LABELS, NETWORK_LABELS, relativeDate, STAGE_INFO, VERDICT_LABELS } from "@/lib/client/labels";
import { TREND_STAGES, type BrandAdaptations, type TrendSignal, type TrendStage } from "@/types/trends";

interface TrendCardProps {
  signal: TrendSignal;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
  onAnalyze: (signal: TrendSignal) => Promise<void>;
  onExport: (signal: TrendSignal, target: ExportTarget) => Promise<ExportResult>;
}

/** Solo enlaces http(s): nunca `javascript:` u otros esquemas llegados de fuentes externas. */
const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined);

const STAGE_COLOR: Record<TrendStage, string> = {
  emerging: "bg-brote",
  peaking: "bg-dorado",
  saturated: "bg-ceniza",
};

function StageMeter({ stage, rule }: { stage: TrendStage; rule: string }) {
  const index = TREND_STAGES.indexOf(stage);
  const info = STAGE_INFO[stage];
  return (
    <div className="w-28" title={`${info.hint}\n${rule}`}>
      <div className="flex gap-0.5" aria-hidden>
        {TREND_STAGES.map((s, i) => (
          <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= index ? STAGE_COLOR[stage] : "bg-arena"}`} />
        ))}
      </div>
      <p className={`mt-1 text-sm ${stage === "saturated" ? "text-ceniza" : "text-carbon"}`}>
        {info.emoji} {info.label}
      </p>
    </div>
  );
}

/** La evidencia de la etapa en lenguaje del equipo de contenido (la regla técnica queda en el tooltip). */
function stageExplanation(signal: TrendSignal): string {
  const e = signal.stage_evidence;
  const pct = (n: number) => `${Math.round(n * 100)} %`;
  if (e.cohort_size <= 1) return "Etapa provisional: es una pieza suelta, sin otras piezas del mismo tema para comparar.";
  const parts = [
    `De ${e.cohort_size} piezas sobre este tema, ${pct(e.es_share)} están en español`,
    `${pct(e.fresh_share)} se publicaron en los últimos 3 días`,
  ];
  if (e.median_outlier !== null) parts.push(`la pieza típica rinde ×${e.median_outlier} sobre el promedio de su canal`);
  return `${parts.join(", ")}.`;
}

function Stat({ value, label, emphasis = false }: { value: string; label: string; emphasis?: boolean }) {
  return (
    <div className="min-w-16 text-right">
      <p className={`wide leading-none font-bold tabular-nums ${emphasis ? "text-3xl text-dorado-hondo" : "text-2xl"}`}>{value}</p>
      <p className="mt-1 text-xs text-tinta">{label}</p>
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-arena pt-4">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h3 className="semiwide text-base font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="inline-flex items-center gap-1.5 text-sm text-tinta hover:text-carbon"
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? "Copiado" : label}
    </button>
  );
}

function reelText(a: BrandAdaptations): string {
  const r = a.andres_bilbao_reel;
  return [`GANCHO: ${r.hook}`, ...r.beats.map((b) => `[${b.second}s] ${b.line}\n   En pantalla: ${b.on_screen_text}`), `CTA: ${r.cta}`].join("\n");
}

function carouselText(a: BrandAdaptations): string {
  const c = a.x30_carousel;
  return [c.title, ...c.slides.map((s, i) => `${i + 1}. ${s.headline}\n   ${s.body}`), `CTA: ${c.cta}`, "", c.caption].join("\n");
}

function Scripts({ adaptations }: { adaptations: BrandAdaptations }) {
  const [tab, setTab] = useState<"reel" | "carousel">("reel");
  const reel = adaptations.andres_bilbao_reel;
  const carousel = adaptations.x30_carousel;
  return (
    <div>
      <div role="tablist" aria-label="Guiones" className="mb-4 inline-flex rounded-lg border border-arena p-0.5 text-sm">
        {(
          [
            ["reel", `Reel para @andresbilbao (${reel.duration_seconds} s)`],
            ["carousel", `Carrusel para @30x (${carousel.slides.length} slides)`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-md px-3 py-1.5 ${tab === key ? "bg-carbon text-crema" : "text-tinta hover:text-carbon"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "reel" ? (
        <div>
          <p className="semiwide mb-4 max-w-prose text-xl leading-snug font-semibold">“{reel.hook}”</p>
          <ol className="space-y-3">
            {reel.beats.map((b, i) => (
              <li key={i} className="grid grid-cols-[3rem_1fr] gap-3">
                <span className="wide pt-0.5 text-sm font-bold text-dorado-hondo tabular-nums">{b.second}s</span>
                <div>
                  <p className="max-w-prose">{b.line}</p>
                  <p className="mt-0.5 text-sm text-tinta">En pantalla: {b.on_screen_text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm">
            <span className="font-semibold">Cierre:</span> {reel.cta}
          </p>
          <div className="mt-3">
            <CopyButton text={reelText(adaptations)} label="Copiar guion" />
          </div>
        </div>
      ) : (
        <div>
          <p className="semiwide mb-4 max-w-prose text-xl leading-snug font-semibold">{carousel.title}</p>
          <ol className="grid gap-2 sm:grid-cols-2">
            {carousel.slides.map((s, i) => (
              <li key={i} className="rounded-lg bg-crema p-3">
                <p className="text-xs text-tinta tabular-nums">Slide {i + 1}</p>
                <p className="font-semibold">{s.headline}</p>
                <p className="mt-1 text-sm text-tinta">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 max-w-prose text-sm whitespace-pre-line text-tinta">{carousel.caption}</p>
          <div className="mt-3">
            <CopyButton text={carouselText(adaptations)} label="Copiar carrusel" />
          </div>
        </div>
      )}
    </div>
  );
}

const TARGETS: { target: ExportTarget; label: string }[] = [
  { target: "slack", label: "Slack" },
  { target: "notion", label: "Notion" },
  { target: "make", label: "Make" },
];

function ExportRow({ signal, onExport }: { signal: TrendSignal; onExport: TrendCardProps["onExport"] }) {
  const [busy, setBusy] = useState<ExportTarget | null>(null);
  const [results, setResults] = useState<Partial<Record<ExportTarget, ExportResult>>>({});
  return (
    <div className="flex flex-wrap items-center gap-2">
      {TARGETS.map(({ target, label }) => {
        const result = results[target];
        return (
          <button
            key={target}
            type="button"
            disabled={busy !== null}
            onClick={async () => {
              setBusy(target);
              try {
                const r = await onExport(signal, target);
                setResults((prev) => ({ ...prev, [target]: r }));
              } finally {
                setBusy(null);
              }
            }}
            title={result?.message}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60 ${
              result?.status === "ok"
                ? "border-brote text-brote"
                : result?.status === "error"
                  ? "border-alerta text-alerta"
                  : "border-arena hover:border-carbon"
            }`}
          >
            {busy === target ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            ) : result?.status === "ok" ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <Send className="size-3.5" aria-hidden />
            )}
            {result?.status === "ok" ? `Enviado a ${label}` : `Enviar a ${label}`}
          </button>
        );
      })}
      <a
        href={safeHref(signal.url)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-2 py-1.5 text-sm text-tinta hover:text-carbon"
      >
        <ExternalLink className="size-3.5" aria-hidden /> Ver pieza original
      </a>
      {Object.values(results)
        .filter((r) => r && r.status !== "ok")
        .map((r) => (
          <p key={r!.target} role="status" className="w-full text-sm text-alerta">
            {TARGETS.find((t) => t.target === r!.target)?.label}: {r!.status === "disabled" ? `${r!.message}. Configúralo en Conexiones.` : r!.message}
          </p>
        ))}
    </div>
  );
}

export default function TrendCard({ signal, rank, expanded, onToggle, onAnalyze, onExport }: TrendCardProps) {
  const [analyzing, setAnalyzing] = useState(false);
  const a = signal.analysis;
  const m = signal.metrics;
  const panelId = `trend-${signal.id}`;

  const analyze = async () => {
    setAnalyzing(true);
    try {
      await onAnalyze(signal);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <li className={`rounded-xl border bg-beige transition-colors ${expanded ? "border-carbon" : "border-transparent hover:border-arena"}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="grid w-full grid-cols-[2.5rem_1fr] items-start gap-x-4 gap-y-3 p-4 text-left sm:grid-cols-[3rem_1fr_auto] sm:items-center"
      >
        <span className="wide pt-0.5 text-3xl leading-none font-bold text-arena tabular-nums sm:text-4xl">{rank}</span>

        <div className="min-w-0">
          <p className="line-clamp-2 font-semibold">{signal.title}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-tinta">
            <span>{NETWORK_LABELS[signal.network]}</span>
            {signal.author_name && <span className="max-w-48 truncate">{signal.author_name}</span>}
            <span>{relativeDate(signal.published_at)}</span>
            {signal.format_type && <span>{FORMAT_LABELS[signal.format_type]}</span>}
          </p>
        </div>

        <div className="col-span-2 flex items-center justify-between gap-5 sm:col-span-1 sm:justify-end">
          <StageMeter stage={signal.stage} rule={signal.stage_evidence.rule} />
          <Stat value={signal.jev_score === null ? "—" : String(signal.jev_score)} label="JEV" />
          {signal.outlier_score !== null ? (
            <Stat value={`×${signal.outlier_score >= 10 ? Math.round(signal.outlier_score) : signal.outlier_score}`} label="sobre su promedio" emphasis={signal.outlier_score >= 5} />
          ) : (
            <Stat value={compact(m.views ?? m.likes)} label={m.views !== null ? "vistas" : m.likes !== null ? "reacciones" : "sin métricas"} />
          )}
          <ChevronDown className={`size-5 shrink-0 text-tinta transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
        </div>
      </button>

      {expanded && (
        <div id={panelId} className="space-y-5 px-4 pb-5 sm:pl-20">
          <Section title="Por qué está en esta etapa">
            <p className="max-w-prose text-sm" title={signal.stage_evidence.rule}>
              {STAGE_INFO[signal.stage].hint} <span className="text-tinta">{stageExplanation(signal)}</span>
            </p>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {(
                [
                  ["Vistas", compact(m.views)],
                  ["Reacciones", compact(m.likes)],
                  ["Comentarios", compact(m.comments)],
                  ["Vistas por hora", compact(signal.velocity_per_hour)],
                  ["Seguidores del autor", compact(m.author_followers)],
                  ["Promedio del autor", compact(m.author_avg_views)],
                ] as const
              )
                .filter(([, v]) => v !== "—")
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-tinta">{k}</dt>
                    <dd className="font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
            </dl>
          </Section>

          {!a ? (
            <Section title="Autopsia pendiente">
              {signal.analysis_status === "failed" && (
                <p className="mb-3 flex max-w-prose gap-2 text-sm text-alerta">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> El último análisis falló: {signal.analysis_error}
                </p>
              )}
              <p className="mb-3 max-w-prose text-sm text-tinta">
                Analizar genera las 5 variables, el score JEV y, si supera el umbral, el Reel y el carrusel listos para grabar.
              </p>
              <button
                type="button"
                onClick={analyze}
                disabled={analyzing}
                className="inline-flex items-center gap-2 rounded-lg bg-carbon px-4 py-2 text-sm font-semibold text-crema hover:bg-carbon/90 disabled:opacity-60"
              >
                {analyzing ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                {analyzing ? "Analizando…" : signal.analysis_status === "failed" ? "Analizar de nuevo" : "Analizar con IA"}
              </button>
            </Section>
          ) : (
            <>
              <Section title="Por qué funcionó">
                <dl className="grid gap-4 md:grid-cols-[8rem_1fr]">
                  {(
                    [
                      ["Gancho", <>“{a.forensic.hook_analysis.hook_text}” <span className="text-tinta">— {a.forensic.hook_analysis.mechanism}. {a.forensic.hook_analysis.why_it_works}</span></>],
                      ["Formato", <>{FORMAT_LABELS[a.forensic.format_type.label]}. <span className="text-tinta">{a.forensic.format_type.description}</span></>],
                      ["Tema", <>{a.forensic.topic_angle.thesis} <span className="text-tinta">Dolor: {a.forensic.topic_angle.pain_point}</span></>],
                      ["Momento", <>{a.forensic.timing_reason.catalyst} <span className="text-tinta">{a.forensic.timing_reason.why_this_week}</span></>],
                      ["Autor", <>{VERDICT_LABELS[a.forensic.author_vs_content.verdict]}. <span className="text-tinta">{a.forensic.author_vs_content.explanation}</span></>],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="semiwide font-semibold">{k}</dt>
                      <dd className="max-w-prose">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Section>

              <Section title={`Matriz JEV: ${a.jev.jev_latam_score} de 100`}>
                <div className="grid max-w-xl gap-2">
                  {(
                    [
                      ["Impacto en negocio", a.jev.breakdown.business_impact, "40 %"],
                      ["Aplicable sin un gran equipo técnico", a.jev.breakdown.practical_applicability, "35 %"],
                      ["Claridad ejecutiva", a.jev.breakdown.executive_clarity, "25 %"],
                    ] as const
                  ).map(([label, value, weight]) => (
                    <div key={label} className="grid grid-cols-[1fr_2.5rem] items-center gap-3 text-sm">
                      <div>
                        <div className="flex justify-between">
                          <span>{label}</span>
                          <span className="text-tinta">pesa {weight}</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-arena">
                          <div className="h-full rounded-full bg-carbon" style={{ width: `${value}%` }} />
                        </div>
                      </div>
                      <span className="text-right font-semibold tabular-nums">{value}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 max-w-prose text-sm text-tinta">{a.jev.breakdown.rationale}</p>
                {a.jev.breakdown.red_flags.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-alerta">
                    {a.jev.breakdown.red_flags.map((f) => (
                      <li key={f} className="flex gap-2">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {f}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {a.adaptations ? (
                <Section title="Listo para grabar" aside={<span className="text-sm text-tinta">{a.adaptations.publish_window}</span>}>
                  {a.adaptations.contrarian_angle && (
                    <p className="mb-4 max-w-prose rounded-lg border-l-4 border-dorado bg-crema p-3 text-sm">
                      <span className="font-semibold">Ángulo contrarian:</span> {a.adaptations.contrarian_angle}
                    </p>
                  )}
                  <Scripts adaptations={a.adaptations} />
                </Section>
              ) : (
                <Section title="Sin guiones">
                  <p className="max-w-prose text-sm text-tinta">
                    El score JEV quedó por debajo del umbral: esta pieza no le sirve lo suficiente a la audiencia de 30X como para adaptarla.
                  </p>
                </Section>
              )}
            </>
          )}

          <Section title="Enviar al equipo">
            <ExportRow signal={signal} onExport={onExport} />
          </Section>
        </div>
      )}
    </li>
  );
}
