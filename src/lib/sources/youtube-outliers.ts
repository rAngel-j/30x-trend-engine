/**
 * YouTube Data API v3 — detección de videos largos y Shorts en ascenso con Outlier Score real.
 * search.list (100 u.) → videos.list (1 u.) → channels.list (1 u.). Fórmulas: docs/ARCHITECTURE.md §4.1.
 */
import { optionalEnv } from "@/lib/env";
import { errorMessage, MissingCredentialError } from "@/lib/errors";
import { fetchJson } from "@/lib/http";
import { normalizeLanguageCode } from "@/lib/intelligence/trend-stage";
import { scrubHandles } from "@/lib/privacy";
import type { DiscoveryRequest, RawSignal, SourceReport } from "@/types/trends";

const API = "https://www.googleapis.com/youtube/v3";
const SHORT_MAX_SECONDS = 180;
const AUTHOR_WEIGHT_CEILING = 50; // outlier ≥ 50 ⇒ el mérito es 100 % de la pieza

interface SearchResponse {
  items?: { id?: { videoId?: string } }[];
}

interface VideoItem {
  id: string;
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    channelTitle: string;
    tags?: string[];
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
    thumbnails?: Record<string, { url: string }>;
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
}

interface ChannelItem {
  id: string;
  snippet?: { customUrl?: string };
  statistics?: { viewCount?: string; subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string };
}

function apiKey(): string {
  const key = optionalEnv("YOUTUBE_API_KEY");
  if (!key) throw new MissingCredentialError("YOUTUBE_API_KEY", "YouTube Outliers");
  return key;
}

const int = (v?: string) => (v === undefined ? null : Number.parseInt(v, 10));

/** ISO-8601 (PT1H2M3S) → segundos. */
export function parseIsoDuration(iso?: string): number | null {
  const m = iso?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, d = "0", h = "0", min = "0", s = "0"] = m;
  return Number(d) * 86_400 + Number(h) * 3_600 + Number(min) * 60 + Number(s);
}

export interface OutlierMetrics {
  outlier_score: number | null;
  author_avg_views: number | null;
  velocity_per_hour: number | null;
  author_weight: number | null;
}

/** Outlier Score, velocidad y peso del autor (§4.1). Exportado para reutilizarlo en otras fuentes con datos de canal. */
export function computeOutlierMetrics(input: {
  views: number | null;
  channelViews: number | null;
  channelVideos: number | null;
  publishedAt: string | null;
  now?: number;
}): OutlierMetrics {
  const { views, channelViews, channelVideos, publishedAt, now = Date.now() } = input;
  const avg = channelViews !== null && channelVideos ? channelViews / Math.max(channelVideos, 1) : null;
  const outlier = views !== null && avg !== null ? views / Math.max(avg, 1) : null;
  const hours = publishedAt ? Math.max((now - new Date(publishedAt).getTime()) / 3_600_000, 1) : null;
  const weight =
    outlier === null ? null : Math.min(1, Math.max(0, 1 - Math.log10(Math.max(outlier, 1)) / Math.log10(AUTHOR_WEIGHT_CEILING)));
  return {
    outlier_score: outlier === null ? null : Math.round(outlier * 100) / 100,
    author_avg_views: avg === null ? null : Math.round(avg),
    velocity_per_hour: views !== null && hours !== null ? Math.round((views / hours) * 100) / 100 : null,
    author_weight: weight === null ? null : Math.round(weight * 1000) / 1000,
  };
}

async function getVideos(ids: string[], key: string): Promise<VideoItem[]> {
  const out: VideoItem[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const params = new URLSearchParams({ part: "snippet,statistics,contentDetails", id: ids.slice(i, i + 50).join(","), key });
    const res = await fetchJson<{ items?: VideoItem[] }>("YouTube videos.list", `${API}/videos?${params}`);
    out.push(...(res.items ?? []));
  }
  return out;
}

async function getChannels(ids: string[], key: string): Promise<Map<string, ChannelItem>> {
  const map = new Map<string, ChannelItem>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 50) {
    const params = new URLSearchParams({ part: "snippet,statistics", id: unique.slice(i, i + 50).join(","), key });
    const res = await fetchJson<{ items?: ChannelItem[] }>("YouTube channels.list", `${API}/channels?${params}`);
    for (const ch of res.items ?? []) map.set(ch.id, ch);
  }
  return map;
}

function toSignal(video: VideoItem, channel: ChannelItem | undefined, query: string): RawSignal {
  const views = int(video.statistics?.viewCount);
  const duration = parseIsoDuration(video.contentDetails?.duration);
  const text = `${video.snippet.title} ${video.snippet.description}`;
  const isShort = (duration !== null && duration <= SHORT_MAX_SECONDS) || /#shorts?\b/i.test(text);
  const subs = channel?.statistics?.hiddenSubscriberCount ? null : int(channel?.statistics?.subscriberCount);
  const metrics = computeOutlierMetrics({
    views,
    channelViews: int(channel?.statistics?.viewCount),
    channelVideos: int(channel?.statistics?.videoCount),
    publishedAt: video.snippet.publishedAt,
  });

  return {
    network: "youtube",
    source: "youtube_api",
    url: isShort ? `https://www.youtube.com/shorts/${video.id}` : `https://www.youtube.com/watch?v=${video.id}`,
    title: scrubHandles(video.snippet.title),
    excerpt: scrubHandles(video.snippet.description.slice(0, 600)),
    published_at: video.snippet.publishedAt,
    language: normalizeLanguageCode(video.snippet.defaultAudioLanguage ?? video.snippet.defaultLanguage),
    format_hint: isShort ? "short_vertical" : "long_video",
    metrics: {
      views,
      likes: int(video.statistics?.likeCount),
      comments: int(video.statistics?.commentCount),
      shares: null,
      author_followers: subs,
      author_avg_views: metrics.author_avg_views,
      duration_seconds: duration,
    },
    outlier_score: metrics.outlier_score,
    velocity_per_hour: metrics.velocity_per_hour,
    author_weight: metrics.author_weight,
    query,
    raw: {
      video_id: video.id,
      tags: video.snippet.tags?.slice(0, 15) ?? [],
      subs_ratio: views !== null && subs ? Math.round((views / subs) * 100) / 100 : null,
      channel_video_count: int(channel?.statistics?.videoCount),
    },
  };
}

/** Enriquecer IDs concretos (Sensor de Comunidad). 2 unidades de cuota. */
export async function fetchYouTubeVideos(ids: string[], query: string): Promise<RawSignal[]> {
  if (ids.length === 0) return [];
  const key = apiKey();
  const videos = await getVideos(ids, key);
  const channels = await getChannels(videos.map((v) => v.snippet.channelId), key);
  return videos.map((v) => toSignal(v, channels.get(v.snippet.channelId), query));
}

/** Descubrimiento: los videos con más vistas de la ventana, ordenados por Outlier Score. */
export async function discoverYouTubeOutliers(req: DiscoveryRequest): Promise<{ signals: RawSignal[]; report: SourceReport }> {
  let key: string;
  try {
    key = apiKey();
  } catch (err) {
    return { signals: [], report: { source: "youtube_api", status: "disabled", count: 0, message: errorMessage(err) } };
  }

  const maxResults = Math.min(Math.max(req.maxPerSource ?? 25, 1), 50);
  const publishedAfter = new Date(Date.now() - req.windowDays * 86_400_000).toISOString();
  const durations: ("short" | "medium" | "long" | "any")[] =
    req.youtubeFormat === "short" ? ["short"] : req.youtubeFormat === "long" ? ["medium", "long"] : ["any"];

  try {
    const ids = new Set<string>();
    let quota = 0;
    for (const videoDuration of durations) {
      const params = new URLSearchParams({
        part: "snippet",
        type: "video",
        q: req.query,
        order: "viewCount",
        publishedAfter,
        maxResults: String(maxResults),
        videoDuration,
        safeSearch: "moderate",
        key,
      });
      if (req.relevanceLanguage) params.set("relevanceLanguage", req.relevanceLanguage);
      const res = await fetchJson<SearchResponse>("YouTube search.list", `${API}/search?${params}`);
      quota += 100;
      for (const item of res.items ?? []) if (item.id?.videoId) ids.add(item.id.videoId);
    }

    const videos = await getVideos([...ids], key);
    const channels = await getChannels(videos.map((v) => v.snippet.channelId), key);
    quota += Math.ceil(ids.size / 50) + Math.ceil(channels.size / 50);

    const signals = videos
      .map((v) => toSignal(v, channels.get(v.snippet.channelId), req.query))
      .filter((s) => req.youtubeFormat !== "long" || s.format_hint === "long_video")
      .sort((a, b) => (b.outlier_score ?? 0) - (a.outlier_score ?? 0));

    return { signals, report: { source: "youtube_api", status: "ok", count: signals.length, quota_units: quota } };
  } catch (err) {
    return { signals: [], report: { source: "youtube_api", status: "error", count: 0, message: errorMessage(err) } };
  }
}
