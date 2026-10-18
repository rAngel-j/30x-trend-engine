/**
 * Social SERP — descubrimiento de publicaciones públicas indexadas en LinkedIn, Instagram y TikTok
 * a través de índices de búsqueda (Tavily → Google Programmable Search). Nunca toca las redes directamente.
 * Reconstrucción de fecha, autor y engagement: docs/ARCHITECTURE.md §4.2.
 */
import { optionalEnv } from "@/lib/env";
import { errorMessage, MissingCredentialError } from "@/lib/errors";
import { fetchJson } from "@/lib/http";
import { canonicalizeUrl, instagramShortcodeToDate, linkedinIdToDate, tiktokIdToDate } from "@/lib/url";
import type { DiscoveryRequest, FormatHint, Network, RawSignal, SignalMetrics, SourceId, SourceReport } from "@/types/trends";

export type SocialNetwork = Extract<Network, "linkedin" | "instagram" | "tiktok">;
export const SERP_NETWORKS: readonly SocialNetwork[] = ["linkedin", "instagram", "tiktok"];

interface NetworkSpec {
  domain: string;
  /** Filtro site: para Google CSE (admite path). */
  cseSite: string;
  /** Palabra que ayuda al índice a priorizar publicaciones sobre perfiles. */
  hint: string;
  /** Solo URLs de piezas individuales (no perfiles, empleos, etc.). */
  isPost: RegExp;
}

const SPECS: Record<SocialNetwork, NetworkSpec> = {
  linkedin: { domain: "linkedin.com", cseSite: "linkedin.com/posts", hint: "LinkedIn post", isPost: /linkedin\.com\/(posts\/|feed\/update\/|pulse\/)/i },
  instagram: { domain: "instagram.com", cseSite: "instagram.com", hint: "Instagram reel", isPost: /instagram\.com\/(?:[\w.]+\/)?(p|reel|reels|tv)\/[\w-]+/i },
  tiktok: { domain: "tiktok.com", cseSite: "tiktok.com", hint: "TikTok", isPost: /tiktok\.com\/@[\w.]+\/(video|photo)\/\d+/i },
};

interface SerpHit {
  url: string;
  title: string;
  content: string;
  published?: string | null;
  provider: SourceId;
  score?: number;
}

// ── Proveedores ────────────────────────────────────────────────────

function tavilyTimeRange(days: number): "day" | "week" | "month" | "year" {
  if (days <= 1) return "day";
  if (days <= 7) return "week";
  if (days <= 31) return "month";
  return "year";
}

async function searchTavily(network: SocialNetwork, req: DiscoveryRequest, key: string): Promise<SerpHit[]> {
  const spec = SPECS[network];
  const res = await fetchJson<{ results?: { url: string; title?: string; content?: string; score?: number; published_date?: string }[] }>(
    "Tavily",
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query: `${req.query} ${spec.hint}`,
        search_depth: "advanced",
        topic: "general",
        max_results: Math.min(req.maxPerSource ?? 20, 20),
        include_domains: [spec.domain],
        time_range: tavilyTimeRange(req.windowDays),
        include_answer: false,
        include_raw_content: false,
      }),
      timeoutMs: 25_000,
    },
  );
  return (res.results ?? []).map((r) => ({
    url: r.url,
    title: r.title ?? "",
    content: r.content ?? "",
    published: r.published_date ?? null,
    provider: "tavily" as const,
    score: r.score,
  }));
}

interface CseItem {
  link: string;
  title?: string;
  snippet?: string;
  pagemap?: { metatags?: Record<string, string>[] };
}

async function searchGoogleCse(network: SocialNetwork, req: DiscoveryRequest, key: string, cx: string): Promise<SerpHit[]> {
  const spec = SPECS[network];
  const wanted = Math.min(req.maxPerSource ?? 20, 30);
  const hits: SerpHit[] = [];
  for (let start = 1; start <= wanted; start += 10) {
    const params = new URLSearchParams({
      key,
      cx,
      q: `${req.query} site:${spec.cseSite}`,
      dateRestrict: `d${Math.max(1, Math.round(req.windowDays))}`,
      num: String(Math.min(10, wanted - start + 1)),
      start: String(start),
    });
    const res = await fetchJson<{ items?: CseItem[] }>("Google CSE", `https://www.googleapis.com/customsearch/v1?${params}`);
    const items = res.items ?? [];
    for (const item of items) {
      const meta = item.pagemap?.metatags?.[0] ?? {};
      hits.push({
        url: item.link,
        title: meta["og:title"] ?? item.title ?? "",
        content: [meta["og:description"], item.snippet].filter(Boolean).join(" — "),
        published: meta["article:published_time"] ?? meta["og:updated_time"] ?? null,
        provider: "google_cse",
      });
    }
    if (items.length < 10) break;
  }
  return hits;
}

// ── Extracción desde el índice ─────────────────────────────────────

const MULTIPLIERS: Record<string, number> = { k: 1e3, mil: 1e3, m: 1e6, mill: 1e6, millones: 1e6, b: 1e9 };

/** "1,234" → 1234 · "1,2 K" → 1200 · "3.4M" → 3 400 000 · "12 mil" → 12 000. */
export function parseCompactNumber(raw: string): number | null {
  const m = raw.trim().match(/^(\d[\d.,]*)\s*(k|mil|millones|mill|m|b)?$/i);
  if (!m?.[1]) return null;
  const suffix = m[2]?.toLowerCase();
  if (suffix) return Math.round(Number.parseFloat(m[1].replace(",", ".")) * (MULTIPLIERS[suffix] ?? 1));
  const n = Number.parseInt(m[1].replace(/[.,]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

const NUM = String.raw`(\d[\d.,]*\s*(?:k|mil|millones|mill|m|b)?)`;
const ENGAGEMENT_PATTERNS: [keyof SignalMetrics, RegExp][] = [
  ["views", new RegExp(`${NUM}\\s*(?:views|visualizaciones|reproducciones|vistas|plays)\\b`, "i")],
  ["likes", new RegExp(`${NUM}\\s*(?:likes|reactions|reacciones|me gusta|curtidas)\\b`, "i")],
  ["comments", new RegExp(`${NUM}\\s*(?:comments|comentarios|comentários)\\b`, "i")],
  ["shares", new RegExp(`${NUM}\\s*(?:shares|reposts|compartidos|veces compartido|compartilhamentos)\\b`, "i")],
];

export function extractEngagement(text: string): Pick<SignalMetrics, "views" | "likes" | "comments" | "shares"> {
  const out = { views: null, likes: null, comments: null, shares: null } as Pick<SignalMetrics, "views" | "likes" | "comments" | "shares">;
  for (const [field, pattern] of ENGAGEMENT_PATTERNS) {
    const match = text.match(pattern)?.[1];
    if (match) (out as Record<string, number | null>)[field] = parseCompactNumber(match);
  }
  return out;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** Instagram indexa "… on October 3, 2026: …". */
function dateFromSnippet(text: string): Date | null {
  const m = text.match(/\bon (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})/i);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[3]), MONTHS[m[1]!.toLowerCase()]!, Number(m[2])));
}

function publishedAt(network: SocialNetwork, hit: SerpHit): string | null {
  const fromId =
    network === "linkedin" ? linkedinIdToDate(hit.url) : network === "tiktok" ? tiktokIdToDate(hit.url) : instagramShortcodeToDate(hit.url);
  const indexed = hit.published ? new Date(hit.published) : null;
  const date = fromId ?? (indexed && !Number.isNaN(indexed.getTime()) ? indexed : null) ?? dateFromSnippet(hit.content);
  return date ? date.toISOString() : null;
}

function author(network: SocialNetwork, hit: SerpHit): { name: string | null; handle: string | null; url: string | null } {
  const url = new URL(hit.url);
  if (network === "linkedin") {
    const handle = url.pathname.match(/\/posts\/([^_/]+)_/)?.[1] ?? null;
    const name = hit.title.match(/^(.+?)\s+(?:on|en|no)\s+LinkedIn/i)?.[1] ?? hit.title.match(/\|\s*([^|]+?)\s*(?:\|\s*\d+\s*comments)?$/i)?.[1] ?? null;
    return { name, handle, url: handle ? `https://www.linkedin.com/in/${handle}` : null };
  }
  if (network === "tiktok") {
    const handle = url.pathname.match(/\/@([\w.]+)/)?.[1] ?? null;
    const name = hit.title.match(/^(.+?)\s*\(@[\w.]+\)/)?.[1] ?? null;
    return { name, handle, url: handle ? `https://www.tiktok.com/@${handle}` : null };
  }
  const text = `${hit.title} ${hit.content}`;
  const handle = url.pathname.match(/^\/([\w.]+)\/(?:p|reel|reels|tv)\//)?.[1] ?? text.match(/\(@([\w.]+)\)/)?.[1] ?? text.match(/-\s*([\w.]+) on [A-Z][a-z]+ \d/)?.[1] ?? null;
  const name = hit.title.match(/^(.+?)\s+(?:on|en)\s+Instagram/i)?.[1] ?? hit.title.match(/^(.+?)\s*\(@/)?.[1] ?? null;
  return { name, handle, url: handle ? `https://www.instagram.com/${handle}` : null };
}

function formatHint(network: SocialNetwork, url: string): FormatHint {
  if (network === "tiktok") return "short_vertical";
  if (network === "instagram") return /\/(reel|reels|tv)\//.test(url) ? "reel" : "image_post";
  return /\/pulse\//.test(url) ? "article" : "text_post";
}

function cleanTitle(title: string): string {
  return title.replace(/\s*[|•-]\s*(LinkedIn|Instagram|TikTok).*$/i, "").replace(/^(.+?)\s+(?:on|en)\s+(LinkedIn|Instagram):\s*/i, "").trim();
}

function toSignal(network: SocialNetwork, hit: SerpHit, query: string): RawSignal {
  const published = publishedAt(network, hit);
  const engagement = extractEngagement(`${hit.title} ${hit.content}`);
  const who = author(network, hit);
  const hours = published ? Math.max((Date.now() - new Date(published).getTime()) / 3_600_000, 1) : null;
  return {
    network,
    source: hit.provider,
    url: hit.url,
    title: cleanTitle(hit.title) || hit.content.slice(0, 120),
    excerpt: hit.content.slice(0, 800),
    author_name: who.name,
    author_handle: who.handle,
    author_url: who.url,
    thumbnail_url: null,
    published_at: published,
    language: null, // lo asigna classifyCohort
    format_hint: formatHint(network, hit.url),
    metrics: { ...engagement, author_followers: null, author_avg_views: null, duration_seconds: null },
    outlier_score: null, // sin promedio del autor no hay outlier honesto
    velocity_per_hour: engagement.views !== null && hours ? Math.round((engagement.views / hours) * 100) / 100 : null,
    author_weight: null,
    query,
    raw: { provider: hit.provider, relevance: hit.score ?? null, indexed_published: hit.published ?? null },
  };
}

// ── Búsqueda de una URL concreta (Sensor de Comunidad) ─────────────

export interface IndexedHit {
  title: string;
  content: string;
  published: string | null;
  provider: SourceId;
}

/**
 * Busca esa URL exacta en el índice público (Tavily → Google CSE) y devuelve lo que el buscador ya indexó.
 * Es la vía legal para "leer" una pieza de LinkedIn, Instagram o TikTok sin descargar la página.
 */
export async function lookupIndexedUrl(url: string, network: SocialNetwork): Promise<IndexedHit | null> {
  const target = canonicalizeUrl(url);
  const matches = (candidate: string) => {
    try {
      return canonicalizeUrl(candidate) === target;
    } catch {
      return false;
    }
  };

  const tavilyKey = optionalEnv("TAVILY_API_KEY");
  if (tavilyKey) {
    const res = await fetchJson<{ results?: { url: string; title?: string; content?: string; published_date?: string }[] }>(
      "Tavily",
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tavilyKey}` },
        body: JSON.stringify({ query: url, search_depth: "basic", max_results: 5, include_domains: [SPECS[network].domain] }),
      },
    );
    const hit = res.results?.find((r) => matches(r.url));
    if (hit) return { title: hit.title ?? "", content: hit.content ?? "", published: hit.published_date ?? null, provider: "tavily" };
  }

  const cseKey = optionalEnv("GOOGLE_CSE_API_KEY");
  const cseId = optionalEnv("GOOGLE_CSE_ID");
  if (cseKey && cseId) {
    const params = new URLSearchParams({ key: cseKey, cx: cseId, q: url, num: "5" });
    const res = await fetchJson<{ items?: CseItem[] }>("Google CSE", `https://www.googleapis.com/customsearch/v1?${params}`);
    const item = res.items?.find((i) => matches(i.link));
    if (item) {
      const meta = item.pagemap?.metatags?.[0] ?? {};
      return {
        title: meta["og:title"] ?? item.title ?? "",
        content: [meta["og:description"], item.snippet].filter(Boolean).join(" — "),
        published: meta["article:published_time"] ?? null,
        provider: "google_cse",
      };
    }
  }
  return null;
}

// ── API pública ────────────────────────────────────────────────────

export async function discoverSocialSerp(req: DiscoveryRequest): Promise<{ signals: RawSignal[]; reports: SourceReport[] }> {
  const networks = req.networks.filter((n): n is SocialNetwork => (SERP_NETWORKS as readonly string[]).includes(n));
  if (networks.length === 0) return { signals: [], reports: [] };

  const tavilyKey = optionalEnv("TAVILY_API_KEY");
  const cseKey = optionalEnv("GOOGLE_CSE_API_KEY");
  const cseId = optionalEnv("GOOGLE_CSE_ID");

  if (!tavilyKey && !(cseKey && cseId)) {
    const message = new MissingCredentialError("TAVILY_API_KEY (o GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID)", "Social SERP").message;
    return { signals: [], reports: [{ source: "tavily", status: "disabled", count: 0, message }] };
  }

  const tally: Record<"tavily" | "google_cse", { count: number; errors: string[]; used: boolean }> = {
    tavily: { count: 0, errors: [], used: false },
    google_cse: { count: 0, errors: [], used: false },
  };

  const perNetwork = await Promise.all(
    networks.map(async (network) => {
      let hits: SerpHit[] | null = null;
      if (tavilyKey) {
        tally.tavily.used = true;
        try {
          hits = await searchTavily(network, req, tavilyKey);
        } catch (err) {
          tally.tavily.errors.push(`${network}: ${errorMessage(err)}`);
        }
      }
      if (hits === null && cseKey && cseId) {
        tally.google_cse.used = true;
        try {
          hits = await searchGoogleCse(network, req, cseKey, cseId);
        } catch (err) {
          tally.google_cse.errors.push(`${network}: ${errorMessage(err)}`);
        }
      }
      const posts = (hits ?? []).filter((h) => /^https:\/\//i.test(h.url) && SPECS[network].isPost.test(h.url));
      const signals = posts.map((h) => toSignal(network, h, req.query));
      for (const s of signals) tally[s.source as "tavily" | "google_cse"].count++;
      return signals;
    }),
  );

  const reports: SourceReport[] = (["tavily", "google_cse"] as const)
    .filter((p) => tally[p].used)
    .map((p) => ({
      source: p,
      status: tally[p].errors.length && tally[p].count === 0 ? "error" : "ok",
      count: tally[p].count,
      ...(tally[p].errors.length ? { message: tally[p].errors.join(" · ") } : {}),
    }));

  return { signals: perNetwork.flat(), reports };
}
