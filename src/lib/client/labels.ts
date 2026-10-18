/** Etiquetas en español para la interfaz. */
import type { AnalysisStatus, FormatHint, FormatType, Network, SortKey, TrendStage } from "@/types/trends";

export const NETWORK_LABELS: Record<Network, string> = {
  youtube: "YouTube",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  tiktok: "TikTok",
  web: "Web",
};

export const SEARCHABLE_NETWORKS: Exclude<Network, "web">[] = ["youtube", "linkedin", "instagram", "tiktok"];

export const STAGE_INFO: Record<TrendStage, { emoji: string; label: string; hint: string }> = {
  emerging: { emoji: "🌱", label: "Emergente", hint: "Acelera en inglés y casi nadie lo cubre en español." },
  peaking: { emoji: "🚀", label: "Despegando", hint: "Momento ideal para publicar." },
  saturated: { emoji: "🔥", label: "Saturada", hint: "Ya todos lo copiaron: solo con un ángulo contrarian." },
};

export const FORMAT_LABELS: Record<FormatType, string> = {
  carrusel_comparativo: "Carrusel comparativo",
  carrusel_paso_a_paso: "Carrusel paso a paso",
  reel_pantalla_dividida_demo: "Reel pantalla dividida con demo",
  talking_head_subtitulos: "Talking head con subtítulos",
  screen_recording_tutorial: "Tutorial grabando pantalla",
  post_texto_estructurado: "Post de texto estructurado",
  video_largo_explicativo: "Video largo explicativo",
  entrevista_o_podcast: "Entrevista o podcast",
  meme_o_humor: "Meme o humor",
  otro: "Otro",
};

export const FORMAT_HINT_LABELS: Record<Exclude<FormatHint, "unknown">, string> = {
  short_vertical: "Video corto vertical",
  long_video: "Video largo",
  reel: "Reel",
  image_post: "Post con imagen o carrusel",
  text_post: "Post de texto",
  article: "Artículo",
};

export const STATUS_LABELS: Record<AnalysisStatus, string> = {
  analyzed: "Analizadas",
  pending: "Sin analizar",
  failed: "Con error",
};

export const SORT_LABELS: Record<SortKey, string> = {
  priority: "Prioridad",
  jev: "Score JEV",
  outlier: "Outlier",
  velocity: "Velocidad",
  recent: "Más recientes",
};

export const WINDOW_OPTIONS = [
  { days: 1, label: "24 h" },
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
] as const;

export const VERDICT_LABELS = {
  author_driven: "Lo empujó el autor",
  content_driven: "Lo empujó el contenido",
  balanced: "Mitad y mitad",
} as const;

export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function relativeDate(iso: string | null): string {
  if (!iso) return "fecha desconocida";
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return "hace minutos";
  if (hours < 24) return `hace ${Math.round(hours)} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `hace ${days} ${days === 1 ? "día" : "días"}`;
  return new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
}
