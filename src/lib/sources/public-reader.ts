/**
 * Sensor de Comunidad 30X — deconstruye cualquier URL pública que el equipo pegue o envíe por webhook.
 *
 * Cumplimiento (docs/ARCHITECTURE.md §7b-bis): en LinkedIn, Instagram y TikTok NUNCA se descarga la página,
 * ni directamente ni a través de lectores de terceros. Solo se usan:
 *   - oEmbed oficial (YouTube, TikTok; Instagram con token de app de Meta),
 *   - lo que el índice de búsqueda público ya tiene de esa URL (Tavily / Google CSE),
 *   - el texto que la persona vio públicamente y pega a mano ("Comunidad como sensor"),
 *   - YouTube Data API para videos de YouTube.
 * Jina Reader se usa solo para la web abierta (blogs, medios, documentación).
 */
import { optionalEnv } from "@/lib/env";
import { errorMessage, SourceError } from "@/lib/errors";
import { fetchJson } from "@/lib/http";
import { assertPublicHttpUrl, detectNetwork, extractYouTubeId, instagramShortcodeToDate, linkedinIdToDate, tiktokIdToDate } from "@/lib/url";
import { extractEngagement, lookupIndexedUrl, type IndexedHit, type SocialNetwork } from "./social-serp";
import { fetchYouTubeVideos } from "./youtube-outliers";
import type { FormatHint, Network, RawSignal } from "@/types/trends";

const MAX_CONTENT_CHARS = 12_000;
export const MAX_COMMUNITY_TEXT = 8_000;

const CLOSED_NETWORKS: readonly Network[] = ["linkedin", "instagram", "tiktok"];

export interface PublicReading {
  signal: RawSignal;
  /** Texto legible para la autopsia forense. */
  content: string;
  /** Proveedores que aportaron datos: "youtube_api", "oembed", "search_index", "jina", "community_text". */
  providers: string[];
  warnings: string[];
}

export interface ReadOptions {
  /** Texto de la publicación tal como la persona lo vio públicamente. */
  text?: string;
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

/** Solo web abierta. Nunca se llama para redes cerradas. */
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

const indexConfigured = () => Boolean(optionalEnv("TAVILY_API_KEY") || (optionalEnv("GOOGLE_CSE_API_KEY") && optionalEnv("GOOGLE_CSE_ID")));

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

function cleanIndexedTitle(title: string): string {
  return title.replace(/\s*[|•-]\s*(LinkedIn|Instagram|TikTok).*$/i, "").replace(/^(.+?)\s+(?:on|en)\s+(LinkedIn|Instagram):\s*/i, "").trim();
}

export async function readPublicUrl(input: string, options: ReadOptions = {}): Promise<PublicReading> {
  const url = assertPublicHttpUrl(input).toString();
  const network = detectNetwork(url);
  const closed = CLOSED_NETWORKS.includes(network);
  const text = options.text?.trim().slice(0, MAX_COMMUNITY_TEXT) || null;
  const ytId = network === "youtube" ? extractYouTubeId(url) : null;
  const useYouTubeApi = Boolean(ytId && optionalEnv("YOUTUBE_API_KEY"));
  const providers: string[] = [];
  const warnings: string[] = [];

  const [ytResult, oembedResult, indexResult, jinaResult] = await Promise.allSettled([
    useYouTubeApi ? fetchYouTubeVideos([ytId!], "community") : Promise.resolve([]),
    readOEmbed(network, url),
    closed && indexConfigured() ? lookupIndexedUrl(url, network as SocialNetwork) : Promise.resolve(null),
    network === "web" ? readJina(url) : Promise.resolve(null),
  ]);

  const ytSignal = ytResult.status === "fulfilled" ? ytResult.value[0] ?? null : null;
  const oembed = oembedResult.status === "fulfilled" ? oembedResult.value : null;
  const indexed: IndexedHit | null = indexResult.status === "fulfilled" ? indexResult.value : null;
  const jina = jinaResult.status === "fulfilled" ? jinaResult.value : null;

  for (const [ok, name, result] of [
    [Boolean(ytSignal), "youtube_api", ytResult],
    [Boolean(oembed), "oembed", oembedResult],
    [Boolean(indexed), "search_index", indexResult],
    [Boolean(jina?.content || jina?.title), "jina", jinaResult],
  ] as const) {
    if (ok) providers.push(name);
    else if (result.status === "rejected") warnings.push(errorMessage(result.reason));
  }
  if (text) providers.push("community_text");
  if (closed && !indexed && !text) {
    warnings.push("El buscador no tiene indexada esta publicación. Pega su texto para un análisis más completo.");
  }

  if (providers.length === 0) {
    const hint = closed
      ? "En LinkedIn, Instagram y TikTok no descargamos la página (sus términos lo prohíben): pega el texto de la publicación que viste."
      : "";
    throw new SourceError("Sensor de Comunidad", `No se pudo leer la URL pública. ${hint} ${warnings.join(" · ")}`.trim(), 502);
  }

  const content = [text, jina?.content ?? jina?.description, indexed?.content, oembed?.title, ytSignal?.excerpt]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join("\n\n")
    .slice(0, MAX_CONTENT_CHARS);

  if (ytSignal) {
    return { signal: { ...ytSignal, source: "community", query: "community" }, content: content || ytSignal.excerpt, providers, warnings };
  }

  const indexedDate = indexed?.published ? new Date(indexed.published) : null;
  const published =
    publishedFromUrl(network, url) ?? (jina?.publishedTime ? new Date(jina.publishedTime) : null) ?? (indexedDate && !Number.isNaN(indexedDate.getTime()) ? indexedDate : null);
  const engagement = extractEngagement(`${indexed?.title ?? ""} ${indexed?.content ?? ""} ${jina?.title ?? ""} ${jina?.description ?? ""} ${content.slice(0, 3000)}`);
  const handle = oembed?.author_unique_id ?? handleFromUrl(network, url);
  const hours = published && !Number.isNaN(published.getTime()) ? Math.max((Date.now() - published.getTime()) / 3_600_000, 1) : null;
  const title =
    (oembed?.title ?? jina?.title ?? (indexed ? cleanIndexedTitle(indexed.title) : "") ?? "").trim() || text?.split("\n")[0]?.slice(0, 160) || url;

  const signal: RawSignal = {
    network,
    source: "community",
    url,
    title: title.slice(0, 300),
    excerpt: (indexed?.content ?? jina?.description ?? content).slice(0, 800),
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
    raw: { providers, oembed_provider: oembed?.provider_name ?? null, indexed_by: indexed?.provider ?? null, community_text: Boolean(text) },
  };

  return { signal, content, providers, warnings };
}
