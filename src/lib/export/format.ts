/** Textos compartidos por los conectores de exportación. */
import type { TrendSignal, TrendStage } from "@/types/trends";

export const STAGE_LABEL: Record<TrendStage, string> = {
  emerging: "🌱 Emergente",
  peaking: "🚀 Despegando",
  saturated: "🔥 Saturada",
};

export const NETWORK_LABEL: Record<TrendSignal["network"], string> = {
  youtube: "YouTube",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  tiktok: "TikTok",
  web: "Web",
};

export function compactNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "n/d";
  return new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function headline(signal: TrendSignal): string {
  const parts = [
    NETWORK_LABEL[signal.network],
    STAGE_LABEL[signal.stage],
    `JEV ${signal.jev_score ?? "—"}`,
    signal.outlier_score !== null ? `Outlier ×${signal.outlier_score}` : null,
    signal.metrics.views !== null ? `${compactNumber(signal.metrics.views)} vistas` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Las 5 variables en una línea cada una (null si aún no hay análisis). */
export function fiveVariables(signal: TrendSignal): [string, string][] | null {
  const f = signal.analysis?.forensic;
  if (!f) return null;
  return [
    ["Gancho", `"${f.hook_analysis.hook_text}" — ${f.hook_analysis.mechanism}`],
    ["Formato", `${f.format_type.label.replaceAll("_", " ")}: ${f.format_type.description}`],
    ["Tema", `${f.topic_angle.thesis} (dolor: ${f.topic_angle.pain_point})`],
    ["Momento", `${f.timing_reason.catalyst} — ${f.timing_reason.why_this_week}`],
    ["Autor", `${f.author_vs_content.verdict.replace("_", " ")}: ${f.author_vs_content.explanation}`],
  ];
}
