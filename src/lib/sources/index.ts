/**
 * Orquestador de ingesta: corre las fuentes en paralelo (por cada variante de la consulta),
 * deduplica y clasifica la cohorte completa. Nunca lanza por una fuente caída: cada una
 * reporta su estado en `sources[]`.
 */
import { InvalidInputError } from "@/lib/errors";
import { classifyCohort } from "@/lib/intelligence/trend-stage";
import { canonicalizeUrl } from "@/lib/url";
import { discoverSocialSerp } from "./social-serp";
import { discoverYouTubeOutliers } from "./youtube-outliers";
import { NETWORKS, type DiscoveryRequest, type DiscoveryResult, type RawSignal, type SourceReport } from "@/types/trends";

export { readPublicUrl, type PublicReading } from "./public-reader";
export { fetchYouTubeVideos } from "./youtube-outliers";

const MAX_VARIANTS = 3;

export function validateDiscoveryRequest(req: DiscoveryRequest): DiscoveryRequest {
  const query = req.query?.trim();
  if (!query || query.length < 2) throw new InvalidInputError("La consulta debe tener al menos 2 caracteres.");
  if (query.length > 200) throw new InvalidInputError("La consulta no puede superar 200 caracteres.");
  const networks = [...new Set(req.networks)].filter((n) => (NETWORKS as readonly string[]).includes(n) && n !== "web");
  if (networks.length === 0) throw new InvalidInputError("Elige al menos una red: youtube, linkedin, instagram o tiktok.");
  const windowDays = Math.trunc(req.windowDays);
  if (!(windowDays >= 1 && windowDays <= 90)) throw new InvalidInputError("windowDays debe estar entre 1 y 90.");
  const queryVariants = (req.queryVariants ?? [])
    .map((q) => q.trim())
    .filter((q) => q.length >= 2 && q.toLowerCase() !== query.toLowerCase())
    .slice(0, MAX_VARIANTS - 1);
  return { ...req, query, networks, windowDays, queryVariants };
}

/** Une los reportes de la misma fuente a través de varias variantes de consulta. */
function mergeReports(reports: SourceReport[]): SourceReport[] {
  const bySource = new Map<SourceReport["source"], SourceReport>();
  for (const r of reports) {
    const prev = bySource.get(r.source);
    if (!prev) {
      bySource.set(r.source, { ...r });
      continue;
    }
    const messages = [prev.message, r.message].filter((m, i, all): m is string => !!m && all.indexOf(m) === i);
    bySource.set(r.source, {
      source: r.source,
      status: prev.status === "ok" || r.status === "ok" ? "ok" : prev.status === "error" || r.status === "error" ? "error" : "disabled",
      count: prev.count + r.count,
      ...(messages.length ? { message: messages.join(" · ") } : {}),
      ...(prev.quota_units !== undefined || r.quota_units !== undefined ? { quota_units: (prev.quota_units ?? 0) + (r.quota_units ?? 0) } : {}),
    });
  }
  return [...bySource.values()];
}

export async function collectSignals(input: DiscoveryRequest): Promise<DiscoveryResult> {
  const req = validateDiscoveryRequest(input);
  const queries = [req.query, ...(req.queryVariants ?? [])];

  const runs = await Promise.all(
    queries.map(async (q) => {
      const variant = { ...req, query: q };
      const [youtube, serp] = await Promise.all([
        req.networks.includes("youtube") ? discoverYouTubeOutliers(variant) : Promise.resolve(null),
        discoverSocialSerp(variant),
      ]);
      return {
        reports: [...(youtube ? [youtube.report] : []), ...serp.reports],
        // Todas las variantes se guardan bajo la consulta original para que el filtro de texto las encuentre.
        signals: [...(youtube?.signals ?? []), ...serp.signals].map((s) => ({ ...s, query: req.query, raw: { ...s.raw, matched_query: q } })),
      };
    }),
  );

  const seen = new Set<string>();
  const unique: RawSignal[] = runs.flatMap((r) => r.signals).filter((s) => {
    const key = canonicalizeUrl(s.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { signals: classifyCohort(unique), sources: mergeReports(runs.flatMap((r) => r.reports)) };
}
