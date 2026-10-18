/**
 * Sensor de Comunidad 30X — deconstruye cualquier URL pública que el equipo pegue o envíe por webhook.
 * oEmbed oficial (YouTube, TikTok, Instagram con token Meta) + Jina Reader para el texto completo
 * + YouTube Data API si es un video (métricas reales y Outlier Score).
 * Nuestro servidor nunca descarga la red social directamente: Jina y los endpoints oEmbed lo hacen.
 */
import { optionalEnv } from "@/lib/env";
import { errorMessage, SourceError } from "@/lib/errors";
import { fetchJson } from "@/lib/http";
import { assertPublicHttpUrl, detectNetwork, extractYouTubeId, instagramShortcodeToDate, linkedinIdToDate, tiktokIdToDate } from "@/lib/url";
import { extractEngagement } from "./social-serp";
import { fetchYouTubeVideos } from "./youtube-outliers";
import type { FormatHint, Network, RawSignal } from "@/types/trends";

const MAX_CONTENT_CHARS = 12_000;

export interface PublicReading {
  signal: RawSignal;
  /** Texto completo legible (markdown) para la autopsia forense. */
  content: string;
  /** Proveedores que respondieron, en orden: "youtube_api", "oembed", "jina". */
  providers: string[];
  warnings: string[];
}

interface OEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
  author_unique_id?: string;
  thumbnail_url?: string;
  provider_name?: string;
}

interface JinaResponse {
  data?: { title?: string; description?: string; url?: string; content?: string; publishedTime?: string };
}

function oembedEndpoint(network: Network, url: string): string | null {
  const encoded = encodeURIComponent(url);
  if (network === "youtube") return `https://www.youtube.com/oembed?format=json&url=${encoded}`;
  if (network === "tiktok") return `https://www.tiktok.com/oembed?url=${encoded}`;
  if (network === "instagram") {
    const token = optionalEnv("META_OEMBED_TOKEN");
    return token ? `https://graph.facebook.com/v23.0/instagram_oembed?url=${encoded}&access_token=${encodeURIComponent(token)}` : null;
  }
  return null; // LinkedIn no ofrece oEmbed público
}

async function readOEmbed(network: Network, url: string): Promise<OEmbed | null> {
  const endpoint = oembedEndpoint(network, url);
  return endpoint ? fetchJson<OEmbed>(`oEmbed ${network}`, endpoint, { timeoutMs: 10_000 }) : null;
}

async function readJina(url: string): Promise<JinaResponse["data"] | null> {
  const key = optionalEnv("JINA_API_KEY");
  const res = await fetchJson<JinaResponse>("Jina Reader", `https://r.jina.ai/${url}`, {
    headers: {
      Accept: "application/json",
      "X-Return-Format": "markdown",
      "X-Timeout": "20",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    timeoutMs: 30_000,
  });
  return res.data ?? null;
}

function publishedFromUrl(network: Network, url: string): Date | null {
  if (network === "linkedin") return linkedinIdToDate(url);
  if (network === "tiktok") return tiktokIdToDate(url);
  if (network === "instagram") return instagramShortcodeToDate(url);
  return null;
}

function formatHintFor(network: Network, url: string): FormatHint {
  if (network === "tiktok") return "short_vertical";
  if (network === "instagram") return /\/(reel|reels|tv)\//.test(url) ? "reel" : "image_post";
  if (network === "linkedin") return /\/pulse\//.test(url) ? "article" : "text_post";
  if (network === "youtube") return /\/shorts\//.test(url) ? "short_vertical" : "long_video";
  return "article";
}

function handleFromUrl(network: Network, url: string): string | null {
  const path = new URL(url).pathname;
  if (network === "tiktok") return path.match(/\/@([\w.]+)/)?.[1] ?? null;
  if (network === "linkedin") return path.match(/\/posts\/([^_/]+)_/)?.[1] ?? null;
  if (network === "instagram") return path.match(/^\/([\w.]+)\/(?:p|reel|reels|tv)\//)?.[1] ?? null;
  return null;
}

export async function readPublicUrl(input: string): Promise<PublicReading> {
  const url = assertPublicHttpUrl(input).toString();
  const network = detectNetwork(url);
  const ytId = network === "youtube" ? extractYouTubeId(url) : null;
  const providers: string[] = [];
  const warnings: string[] = [];

  const useYouTubeApi = Boolean(ytId && optionalEnv("YOUTUBE_API_KEY"));
  const [ytResult, oembedResult, jinaResult] = await Promise.allSettled([
    useYouTubeApi ? fetchYouTubeVideos([ytId!], "community") : Promise.resolve([]),
    readOEmbed(network, url),
    // Con la YouTube API ya tenemos título y descripción completos; Jina anónimo además bloquea youtube.com.
    useYouTubeApi ? Promise.resolve(null) : readJina(url),
  ]);

  const ytSignal = ytResult.status === "fulfilled" ? ytResult.value[0] ?? null : null;
  const oembed = oembedResult.status === "fulfilled" ? oembedResult.value : null;
  const jina = jinaResult.status === "fulfilled" ? jinaResult.value : null;

  if (ytSignal) providers.push("youtube_api");
  else if (ytResult.status === "rejected") warnings.push(errorMessage(ytResult.reason));
  if (oembed) providers.push("oembed");
  else if (oembedResult.status === "rejected") warnings.push(errorMessage(oembedResult.reason));
  if (jina?.content || jina?.title) providers.push("jina");
  else if (jinaResult.status === "rejected") warnings.push(errorMessage(jinaResult.reason));

  if (providers.length === 0) {
    throw new SourceError("Sensor de Comunidad", `No se pudo leer la URL pública. ${warnings.join(" · ")}`.trim(), 502);
  }

  const content = (jina?.content ?? jina?.description ?? oembed?.title ?? ytSignal?.excerpt ?? "").slice(0, MAX_CONTENT_CHARS);

  if (ytSignal) {
    return { signal: { ...ytSignal, source: "community", query: "community" }, content: content || ytSignal.excerpt, providers, warnings };
  }

  const published = publishedFromUrl(network, url) ?? (jina?.publishedTime ? new Date(jina.publishedTime) : null);
  const engagement = extractEngagement(`${jina?.title ?? ""} ${jina?.description ?? ""} ${content.slice(0, 3000)}`);
  const handle = oembed?.author_unique_id ?? handleFromUrl(network, url);
  const hours = published && !Number.isNaN(published.getTime()) ? Math.max((Date.now() - published.getTime()) / 3_600_000, 1) : null;

  const signal: RawSignal = {
    network,
    source: "community",
    url,
    title: (oembed?.title ?? jina?.title ?? "").trim().slice(0, 300) || url,
    excerpt: (jina?.description ?? content).slice(0, 800),
    author_name: oembed?.author_name ?? null,
    author_handle: handle,
    author_url: oembed?.author_url ?? null,
    thumbnail_url: oembed?.thumbnail_url ?? null,
    published_at: hours !== null ? published!.toISOString() : null,
    language: null,
    format_hint: formatHintFor(network, url),
    metrics: { ...engagement, author_followers: null, author_avg_views: null, duration_seconds: null },
    outlier_score: null,
    velocity_per_hour: engagement.views !== null && hours ? Math.round((engagement.views / hours) * 100) / 100 : null,
    author_weight: null,
    query: "community",
    raw: { providers, oembed_provider: oembed?.provider_name ?? null },
  };

  return { signal, content, providers, warnings };
}
