/**
 * Sube la base local a Supabase: `npm run db:push` (docs/DEPLOY.md).
 * Copia perfiles, piezas, análisis, radares y vistas guardadas desde SQLite (.data/trends.db) a la base en la nube,
 * para publicar la app con el radar ya preparado sin gastar cuota de IA otra vez. No llama a ninguna API de IA.
 *
 *   npm run db:push            → copia a una base en la nube vacía
 *   npm run db:push -- --force → copia aunque la nube ya tenga datos (actualiza por id; no borra nada)
 *
 * Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local y las migraciones aplicadas (supabase/setup.sql).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@supabase/supabase-js";
import { optionalEnv } from "@/lib/env";
import { errorMessage } from "@/lib/errors";

const force = process.argv.includes("--force");

/** Tablas en orden de dependencias, con las columnas que en SQLite son JSON en texto o booleanos en entero. */
const TABLES: { name: string; json: string[]; bool?: string[] }[] = [
  { name: "brand_profiles", json: ["seeds"], bool: ["is_default"] },
  { name: "trend_signals", json: ["metrics", "stage_evidence", "analysis", "raw"] },
  { name: "radar_runs", json: ["networks", "seeds", "sources", "notes"] },
  { name: "radar_topics", json: ["stage_evidence", "networks", "member_ids"] },
  { name: "saved_views", json: ["filters"] },
];
const BATCH = 200;

async function main() {
  const url = optionalEnv("SUPABASE_URL");
  const key = optionalEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local (docs/DEPLOY.md, paso 1).");
  const path = resolve(process.cwd(), optionalEnv("SQLITE_PATH") ?? ".data/trends.db");
  if (!existsSync(path)) throw new Error(`No hay base local en ${path}: no hay nada que subir.`);

  const local = new DatabaseSync(path, { readOnly: true });
  const cloud = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const probe = await cloud.from("brand_profiles").select("id", { count: "exact", head: true });
  if (probe.error) throw new Error(`No se pudo leer la base en la nube (¿ejecutaste supabase/setup.sql?): ${probe.error.message}`);
  if ((probe.count ?? 0) > 0 && !force) {
    throw new Error("La base en la nube ya tiene perfiles. Para copiar igualmente (actualiza por id, no borra nada): npm run db:push -- --force");
  }
  if ((probe.count ?? 0) > 0) {
    // Solo puede haber un perfil por defecto: el de la copia local manda.
    const { error } = await cloud.from("brand_profiles").update({ is_default: false }).eq("is_default", true);
    if (error) throw new Error(error.message);
  }

  console.log(`\nSubiendo ${path} → Supabase\n`);
  for (const table of TABLES) {
    const rows = (local.prepare(`SELECT * FROM ${table.name}`).all() as Record<string, unknown>[]).map((row) => {
      const out: Record<string, unknown> = { ...row };
      for (const col of table.json) if (typeof out[col] === "string") out[col] = JSON.parse(out[col] as string);
      for (const col of table.bool ?? []) if (col in out) out[col] = Boolean(out[col]);
      return out;
    });
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await cloud.from(table.name).upsert(rows.slice(i, i + BATCH), { onConflict: "id" });
      if (error) throw new Error(`${table.name}: ${error.message}`);
    }
    console.log(`  ✔ ${table.name.padEnd(15)} ${rows.length}`);
  }
  local.close();
  console.log("\nListo: la app publicada ya abre con estos datos.\n");
}

main().catch((err) => {
  console.error(`\n✖ ${errorMessage(err)}\n`);
  process.exit(1);
});
