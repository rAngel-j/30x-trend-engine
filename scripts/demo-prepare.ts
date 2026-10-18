/**
 * Prepara la demo: `npm run demo:prepare` (docs/ARCHITECTURE.md §7b-septies).
 * Corre el Radar semanal del perfil principal en LinkedIn (la pregunta del entregable) y lo deja guardado,
 * para que la demo abra con resultados al instante. Cada radar usa 3 solicitudes de Gemini.
 *
 *   npm run demo:prepare                          → radar de LinkedIn del perfil principal
 *   npm run demo:prepare -- --all                 → además, un radar de las 4 redes
 *   npm run demo:prepare -- --profile=fintech     → otro perfil (por slug)
 */
import { getTrendRepository } from "@/lib/db/supabase";
import { optionalEnv } from "@/lib/env";
import { errorMessage } from "@/lib/errors";
import { ensureDefaultProfile } from "@/lib/profiles";
import { runRadar } from "@/lib/radar";
import type { Network } from "@/types/trends";

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string | undefined]));

async function main() {
  console.log("\nPreparando la demo del Radar semanal\n");
  if (!optionalEnv("GEMINI_API_KEY")) throw new Error("Falta GEMINI_API_KEY en .env.local (ejecuta npm run doctor).");
  const serp = Boolean(optionalEnv("TAVILY_API_KEY") || (optionalEnv("GOOGLE_CSE_API_KEY") && optionalEnv("GOOGLE_CSE_ID")));
  const youtube = Boolean(optionalEnv("YOUTUBE_API_KEY"));

  const repo = getTrendRepository();
  const def = await ensureDefaultProfile(repo);
  const wanted = args.get("profile");
  const profile = wanted ? (await repo.listProfiles()).find((p) => p.slug === wanted) : def;
  if (!profile) throw new Error(`No existe un perfil con slug "${wanted}". Perfiles: ${(await repo.listProfiles()).map((p) => p.slug).join(", ")}`);

  const plans: { label: string; networks: Exclude<Network, "web">[] }[] = [];
  if (serp) plans.push({ label: "LinkedIn", networks: ["linkedin"] });
  if (args.has("all") || !serp) {
    const all = [...(youtube ? (["youtube"] as const) : []), ...(serp ? (["linkedin", "instagram", "tiktok"] as const) : [])];
    if (all.length) plans.push({ label: "las 4 redes", networks: [...all] });
  }
  if (plans.length === 0) throw new Error("No hay fuentes conectadas (YOUTUBE_API_KEY o TAVILY_API_KEY).");

  console.log(`Perfil: ${profile.name} (${profile.seeds.length} semillas) · base: ${repo.kind}`);
  for (const plan of plans) {
    const started = Date.now();
    process.stdout.write(`\n→ Radar de ${plan.label}… (2-4 min)\n`);
    const result = await runRadar(repo, { networks: plan.networks, maxTopics: 10, profile });
    console.log(`  ✔ ${result.topics.length} temas de ${result.run.signals_found} piezas en ${Math.round((Date.now() - started) / 1000)} s`);
    for (const note of result.run.notes) console.log(`  · ${note}`);
    for (const t of result.topics) {
      const rep = t.representative;
      const scripts = rep?.analysis?.adaptations ? "guiones listos" : rep?.analysis ? "sin guiones (JEV bajo)" : "sin autopsia";
      console.log(`  ${String(t.rank).padStart(2)}. ${t.label} — ${t.this_week}/${t.last_week}, JEV ${t.jev_score ?? "—"}, ${scripts}`);
    }
  }
  await repo.close();
  console.log("\nListo. Abre la app (npm run dev) y el radar aparecerá al instante.\n");
}

main().catch((err) => {
  console.error(`\nNo se pudo preparar la demo: ${errorMessage(err)}\n`);
  process.exitCode = 1;
});
