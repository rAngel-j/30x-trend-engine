import { createHash } from "node:crypto";
import { InvalidInputError } from "./errors";
import type { Network } from "@/types/trends";

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|igsh|igshid|si|feature|trk|lipi|rcm|_r|is_from_webapp|sender_device|share_)/i;

/** URL canónica para deduplicar: https, sin www, sin parámetros de tracking, sin barra final. */
export function canonicalizeUrl(input: string): string {
  const url = new URL(input);
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  // YouTube: normalizar youtu.be y shorts a watch?v=
  const ytId = extractYouTubeId(url.toString());
  if (ytId) return `https://youtube.com/watch?v=${ytId}`;
  return url.toString().replace(/\/$/, "");
}

export function fingerprintUrl(url: string): string {
  return createHash("sha256").update(canonicalizeUrl(url)).digest("hex");
}

export function detectNetwork(url: string): Network {
  const host = new URL(url).hostname.toLowerCase();
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) return "youtube";
  if (/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/.test(host)) return "linkedin";
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  if (/(^|\.)tiktok\.com$/.test(host)) return "tiktok";
  return "web";
}

export function extractYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return match?.[1] ?? null;
}

/** Valida que la URL sea http(s) pública. Bloquea hosts locales / privados (anti-SSRF). */
export function assertPublicHttpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidInputError("La URL no es válida.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidInputError("Solo se aceptan URLs http(s).");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    !host.includes(".");
  if (privateHost) throw new InvalidInputError("Solo se pueden analizar URLs públicas.");
  if (url.username || url.password) throw new InvalidInputError("La URL no puede incluir credenciales.");
  return url;
}

// ── Fecha de publicación decodificada desde IDs públicos (docs/ARCHITECTURE.md §4.2) ──

/** LinkedIn: los primeros 41 bits del activity/share/ugcPost id son ms Unix. */
export function linkedinIdToDate(url: string): Date | null {
  const match = url.match(/(?:activity|share|ugcPost)[:-](\d{19})/i) ?? url.match(/-(\d{19})(?:-|\/|$)/);
  if (!match?.[1]) return null;
  return plausibleDate(Number(BigInt(match[1]) >> 22n));
}

/** TikTok: id >> 32 = segundos Unix. */
export function tiktokIdToDate(url: string): Date | null {
  const match = url.match(/\/(?:video|photo)\/(\d{18,20})/);
  if (!match?.[1]) return null;
  return plausibleDate(Number(BigInt(match[1]) >> 32n) * 1000);
}

const IG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const IG_EPOCH_MS = 1314220021721n;

/** Instagram: shortcode → media id (base64 propio) → (id >> 23) + epoch de Instagram. */
export function instagramShortcodeToDate(url: string): Date | null {
  const match = url.match(/instagram\.com\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([\w-]{8,14})/);
  const code = match?.[1];
  if (!code || code.length > 11) return null; // shortcodes largos son de posts privados/archivados
  let id = 0n;
  for (const ch of code) {
    const value = IG_ALPHABET.indexOf(ch);
    if (value < 0) return null;
    id = id * 64n + BigInt(value);
  }
  return plausibleDate(Number((id >> 23n) + IG_EPOCH_MS));
}

function plausibleDate(ms: number): Date | null {
  const min = Date.UTC(2010, 0, 1);
  const max = Date.now() + 24 * 3600 * 1000;
  return ms >= min && ms <= max ? new Date(ms) : null;
}
