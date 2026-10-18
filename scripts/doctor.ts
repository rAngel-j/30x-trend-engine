/**
 * Diagnóstico de conexiones: `npm run doctor`.
 * Prueba cada credencial de .env.local con la llamada más barata posible contra el servicio real.
 * Nunca imprime valores de claves. Detalle: docs/ARCHITECTURE.md §7c.
 */
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { GEMINI_MODEL, optionalEnv } from "@/lib/env";
import { errorMessage } from "@/lib/errors";
import { fetchJson } from "@/lib/http";

type Status = "ok" | "missing" | "error" | "format";

interface Check {
  name: string;
  unlocks: string;
  required: "core" | "source" | "optional";
  vars: string[];
  run: () => Promise<string>;
}

const has = (...names: string[]) => names.every((n) => Boolean(optionalEnv(n)));

const CHECKS: Check[] = [
  {
    name: "Gemini",
    unlocks: "autopsia 5D, Matriz JEV, guiones y búsqueda bilingüe",
    required: "core",
    vars: ["GEMINI_API_KEY"],
    run: async () => {
      const ai = new GoogleGenAI({ apiKey: optionalEnv("GEMINI_API_KEY")! });
      // Generar de verdad: un modelo puede existir (models.get) y no estar habilitado para tu cuenta.
      const res = await ai.models.generateContent({ model: GEMINI_MODEL(), contents: "Responde solo: ok", config: { maxOutputTokens: 5 } });
      return `${GEMINI_MODEL()} genera respuestas (${res.modelVersion ?? "ok"})`;
    },
  },
  {
    name: "YouTube Data API",
    unlocks: "outliers de YouTube",
    required: "source",
    vars: ["YOUTUBE_API_KEY"],
    run: async () => {
      const params = new URLSearchParams({ part: "id", id: "zjkBMFhNj_g", key: optionalEnv("YOUTUBE_API_KEY")! });
      const res = await fetchJson<{ items?: unknown[] }>("YouTube", `https://www.googleapis.com/youtube/v3/videos?${params}`);
      return `respondió (${res.items?.length ?? 0} video) · 1 unidad de cuota`;
    },
  },
  {
    name: "Tavily",
    unlocks: "LinkedIn, Instagram y TikTok",
    required: "source",
    vars: ["TAVILY_API_KEY"],
    run: async () => {
      const res = await fetchJson<{ results?: unknown[] }>("Tavily", "https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${optionalEnv("TAVILY_API_KEY")}` },
        body: JSON.stringify({ query: "AI agents linkedin post", max_results: 1, search_depth: "basic", include_domains: ["linkedin.com"] }),
      });
      return `respondió (${res.results?.length ?? 0} resultado) · 1 crédito`;
    },
  },
  {
    name: "Google Programmable Search",
    unlocks: "respaldo de LinkedIn, Instagram y TikTok",
    required: "optional",
    vars: ["GOOGLE_CSE_API_KEY", "GOOGLE_CSE_ID"],
    run: async () => {
      const params = new URLSearchParams({ key: optionalEnv("GOOGLE_CSE_API_KEY")!, cx: optionalEnv("GOOGLE_CSE_ID")!, q: "AI agents site:linkedin.com/posts", num: "1" });
      await fetchJson("Google CSE", `https://www.googleapis.com/customsearch/v1?${params}`);
      return "respondió · 1 consulta";
    },
  },
  {
    name: "Jina Reader",
    unlocks: "lectura sin límite de enlaces del Sensor",
    required: "optional",
    vars: ["JINA_API_KEY"],
    run: async () => {
      await fetchJson("Jina", "https://r.jina.ai/https://example.com", {
        headers: { Accept: "application/json", Authorization: `Bearer ${optionalEnv("JINA_API_KEY")}` },
        timeoutMs: 25_000,
      });
      return "respondió";
    },
  },
  {
    name: "Supabase",
    unlocks: "base de datos en la nube (sin ella se usa SQLite local)",
    required: "optional",
    vars: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    run: async () => {
      const client = createClient(optionalEnv("SUPABASE_URL")!, optionalEnv("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
      const { count, error } = await client.from("trend_signals").select("id", { count: "exact", head: true });
      if (error) {
        const hint = /does not exist|schema cache/i.test(error.message) ? " → aplica supabase/migrations/001_trend_signals.sql" : "";
        throw new Error(`${error.message}${hint}`);
      }
      return `migración aplicada · ${count ?? 0} señales guardadas`;
    },
  },
  {
    name: "Notion",
    unlocks: "exportar a la base de contenidos",
    required: "optional",
    vars: ["NOTION_API_KEY", "NOTION_DATABASE_ID"],
    run: async () => {
      const db = await fetchJson<{ properties?: Record<string, { type: string }> }>(
        "Notion",
        `https://api.notion.com/v1/databases/${encodeURIComponent(optionalEnv("NOTION_DATABASE_ID")!)}`,
        { headers: { Authorization: `Bearer ${optionalEnv("NOTION_API_KEY")}`, "Notion-Version": "2022-06-28" } },
      );
      return `base accesible · ${Object.keys(db.properties ?? {}).length} columnas`;
    },
  },
  {
    name: "Slack",
    unlocks: "exportar a un canal",
    required: "optional",
    vars: ["SLACK_WEBHOOK_URL"],
    run: async () => {
      if (!/^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\//.test(optionalEnv("SLACK_WEBHOOK_URL")!)) throw new Error("FORMAT");
      return "formato válido (no se envía mensaje de prueba)";
    },
  },
  {
    name: "Make",
    unlocks: "exportar a escenarios de Make",
    required: "optional",
    vars: ["MAKE_WEBHOOK_URL"],
    run: async () => {
      if (!/^https:\/\/hook\.([a-z0-9-]+\.)?(make\.com|integromat\.com)\//.test(optionalEnv("MAKE_WEBHOOK_URL")!)) throw new Error("FORMAT");
      return "formato válido (no se envía mensaje de prueba)";
    },
  },
];

const ICON: Record<Status, string> = { ok: "✔", missing: "·", error: "✖", format: "✖" };

async function main() {
  console.log("\nDiagnóstico de conexiones 30X (lee .env.local; nunca muestra claves)\n");
  const results = new Map<string, Status>();
  const details = new Map<string, string>();

  for (const check of CHECKS) {
    let status: Status;
    let detail: string;
    if (!has(...check.vars)) {
      status = "missing";
      detail = `falta ${check.vars.filter((v) => !optionalEnv(v)).join(" + ")}${check.required === "optional" ? " (opcional)" : ""}`;
    } else {
      try {
        detail = await check.run();
        status = "ok";
      } catch (err) {
        const msg = errorMessage(err);
        status = msg === "FORMAT" ? "format" : "error";
        detail = msg === "FORMAT" ? "la URL no tiene el formato oficial" : msg;
      }
    }
    results.set(check.name, status);
    details.set(check.name, detail);
    console.log(`  ${ICON[status]} ${check.name.padEnd(28)} ${detail}`);
    if (status !== "ok") console.log(`    ${"".padEnd(28)} desbloquea: ${check.unlocks}`);
  }

  const coreOk = results.get("Gemini") === "ok";
  const sourceOk = ["YouTube Data API", "Tavily", "Google Programmable Search"].some((n) => results.get(n) === "ok");
  console.log("");
  if (coreOk && sourceOk) {
    console.log("Listo para operar: hay IA y al menos una fuente de descubrimiento. Ejecuta `npm run dev`.\n");
    return;
  }
  console.log("Falta lo mínimo para operar:");
  if (!coreOk) {
    const geminiDetail = details.get("Gemini") ?? "";
    if (/quota|RESOURCE_EXHAUSTED|429/i.test(geminiDetail)) {
      console.log(`  - La clave de Gemini es válida, pero se agotó la cuota gratuita de ${GEMINI_MODEL()} (20 solicitudes al día).`);
      console.log("    Espera a que se renueve, usa otro modelo en GEMINI_MODEL (p. ej. gemini-3.7-flash) o activa facturación en Google AI Studio.");
    } else {
      console.log("  - GEMINI_API_KEY válida (https://aistudio.google.com/apikey)");
    }
  }
  if (!sourceOk) console.log("  - YOUTUBE_API_KEY o TAVILY_API_KEY válida (ver README → Levantar el entorno)");
  console.log("");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("El diagnóstico no pudo ejecutarse:", errorMessage(err));
  process.exitCode = 1;
});
