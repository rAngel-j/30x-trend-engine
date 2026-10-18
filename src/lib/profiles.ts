/**
 * Perfiles de marca (docs/ARCHITECTURE.md §7b-quinquies).
 * El perfil por defecto (30X) se crea a partir de docs/30X_BRAND_DNA.md la primera vez que se necesita,
 * y los análisis/radares de versiones anteriores se le asignan.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { TrendRepository } from "@/lib/db/supabase";
import { NotFoundError } from "@/lib/errors";
import { profileRef } from "@/lib/intelligence/batch-analyzer";
import type { BrandProfile, BrandProfileInput } from "@/types/trends";

/** Validación de entrada para crear/editar perfiles (API y UI comparten las reglas). */
export const ProfileInputSchema = z.object({
  name: z.string().trim().min(2).max(60),
  audience: z.string().trim().min(10).max(300),
  topic_scope: z.string().trim().min(5).max(200),
  personal_label: z.string().trim().min(2).max(60),
  brand_label: z.string().trim().min(2).max(60),
  dna: z.string().min(200).max(40_000),
  seeds: z.array(z.string().trim().min(2).max(200)).min(2).max(16),
});

/** Lee las semillas de la sección "Semillas del Radar semanal" de un ADN en Markdown. */
export function parseSeedsFromDna(dna: string): string[] {
  const start = dna.search(/^##\s+\d*\.?\s*Semillas del Radar/im);
  if (start < 0) return [];
  const section = dna.slice(start).split(/\n##\s/)[0]!;
  const seeds = [...section.matchAll(/^\s*-\s+(.+?)\s*$/gm)].map((m) => m[1]!).filter((s) => s.length >= 2 && s.length <= 200);
  return [...new Set(seeds)].slice(0, 16);
}

/** Configuración del perfil 30X: sale de la especificación del proyecto y del ADN documentado. */
async function defaultProfileInput(): Promise<BrandProfileInput> {
  const dna = await readFile(resolve(process.cwd(), "docs", "30X_BRAND_DNA.md"), "utf8");
  return {
    name: "30X",
    audience: "Ejecutivos, líderes y equipos de Latinoamérica aprendiendo IA",
    topic_scope: "IA aplicada a negocios, liderazgo y equipos",
    personal_label: "@andresbilbao",
    brand_label: "@30x",
    dna,
    seeds: parseSeedsFromDna(dna),
  };
}

let ensuring: Promise<BrandProfile> | null = null;

/** Devuelve el perfil por defecto; si no existe, lo crea y le asigna los análisis anteriores. */
export function ensureDefaultProfile(repo: TrendRepository): Promise<BrandProfile> {
  ensuring ??= (async () => {
    const existing = await repo.getDefaultProfile();
    if (existing) return existing;
    const profile = await repo.createProfile(await defaultProfileInput(), true);
    for (const { id, analysis } of await repo.listUnassignedAnalyses()) {
      await repo.saveAnalysis(id, { ...analysis, profile: analysis.profile ?? profileRef(profile) });
    }
    await repo.assignRadarsWithoutProfile(profile.id);
    return profile;
  })().finally(() => {
    ensuring = null;
  });
  return ensuring;
}

/** Perfil pedido (o el por defecto si no se indica). */
export async function resolveProfile(repo: TrendRepository, profileId?: string | null): Promise<BrandProfile> {
  if (!profileId) return ensureDefaultProfile(repo);
  await ensureDefaultProfile(repo);
  const profile = await repo.getProfile(profileId);
  if (!profile) throw new NotFoundError(`No existe el perfil ${profileId}.`);
  return profile;
}
