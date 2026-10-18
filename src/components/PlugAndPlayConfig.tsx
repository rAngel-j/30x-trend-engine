"use client";

import { Check, Plug, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  getStatus,
  loadOverrides,
  storeOverrides,
  type ExportOverrides,
  type ServerStatus,
} from "@/lib/client/api";

interface PlugAndPlayConfigProps {
  onOverridesChange: (overrides: ExportOverrides) => void;
}

function StatusRow({ label, ok, missing }: { label: string; ok: boolean; missing: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span>{label}</span>
      {ok ? (
        <span className="inline-flex items-center gap-1 text-brote">
          <Check className="size-3.5" aria-hidden /> Conectado
        </span>
      ) : (
        <span className="text-right text-tinta">Falta {missing}</span>
      )}
    </li>
  );
}

function Block({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="border-t border-arena pt-5">
      <h3 className="semiwide text-base font-semibold">{title}</h3>
      {intro && <p className="mt-1 max-w-prose text-sm text-tinta">{intro}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const FIELDS: { key: keyof ExportOverrides; label: string; placeholder: string; type?: string }[] = [
  { key: "slackWebhookUrl", label: "Webhook de Slack", placeholder: "https://hooks.slack.com/services/…" },
  { key: "notionApiKey", label: "Token de la integración de Notion", placeholder: "ntn_…", type: "password" },
  { key: "notionDatabaseId", label: "ID de la base de Notion", placeholder: "32 caracteres del enlace de la base" },
  { key: "makeWebhookUrl", label: "Webhook de Make", placeholder: "https://hook.us1.make.com/…" },
];

export default function PlugAndPlayConfig({ onOverridesChange }: PlugAndPlayConfigProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [overrides, setOverrides] = useState<ExportOverrides>({});
  const [savedOverrides, setSavedOverrides] = useState(false);

  useEffect(() => {
    const stored = loadOverrides();
    setOverrides(stored);
    onOverridesChange(stored);
    getStatus().then(setStatus).catch(() => setStatus(null));
  }, [onOverridesChange]);

  const open = () => {
    dialog.current?.showModal();
    getStatus().then(setStatus).catch(() => setStatus(null));
  };

  const disconnected = status
    ? [status.ai.gemini, status.sources.youtube_api, status.sources.tavily || status.sources.google_cse].filter((v) => !v).length
    : 0;

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-2 rounded-lg border border-arena px-3 py-1.5 text-sm hover:border-carbon"
      >
        <Plug className="size-4" aria-hidden />
        Conexiones
        {disconnected > 0 && (
          <span className="rounded-full bg-dorado px-1.5 text-xs font-semibold text-carbon" aria-label={`${disconnected} sin configurar`}>
            {disconnected}
          </span>
        )}
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="pp-title"
        className="m-auto max-h-[90vh] w-[min(42rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl bg-crema p-0 text-carbon"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-arena bg-crema px-5 py-4">
          <h2 id="pp-title" className="wide text-lg font-bold">
            Conexiones
          </h2>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Cerrar" className="rounded-md p-1 text-tinta hover:text-carbon">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="space-y-6 px-5 pt-1 pb-6">
          <Block title="Fuentes y cerebro" intro="Se configuran en el servidor (.env.local). Lo que falte se desactiva sin romper el resto.">
            {status ? (
              <ul className="divide-y divide-arena">
                <StatusRow label="Gemini (autopsia, JEV y guiones)" ok={status.ai.gemini} missing="GEMINI_API_KEY" />
                <StatusRow label="YouTube (Outlier Score)" ok={status.sources.youtube_api} missing="YOUTUBE_API_KEY" />
                <StatusRow label="LinkedIn, Instagram y TikTok" ok={status.sources.tavily || status.sources.google_cse} missing="TAVILY_API_KEY" />
                <StatusRow label="Lector de enlaces sin límite" ok={status.sources.jina_key} missing="JINA_API_KEY (opcional)" />
                <StatusRow label="Base de datos en la nube" ok={status.repository === "supabase"} missing="SUPABASE_URL (hoy guarda en SQLite local)" />
              </ul>
            ) : (
              <p className="text-sm text-tinta">Consultando el servidor…</p>
            )}
          </Block>

          <Block
            title="A dónde enviar las tendencias"
            intro="Lo que pegues aquí se guarda solo en este navegador y tiene prioridad sobre la configuración del servidor."
          >
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                storeOverrides(overrides);
                onOverridesChange(overrides);
                setSavedOverrides(true);
                setTimeout(() => setSavedOverrides(false), 2000);
              }}
            >
              {FIELDS.map((f) => {
                const serverHas =
                  status &&
                  ((f.key === "slackWebhookUrl" && status.exports.slack) ||
                    (f.key === "makeWebhookUrl" && status.exports.make) ||
                    ((f.key === "notionApiKey" || f.key === "notionDatabaseId") && status.exports.notion));
                return (
                  <label key={f.key} className="grid gap-1 text-sm">
                    <span className="flex justify-between gap-2">
                      {f.label}
                      {serverHas && <span className="text-brote">El servidor ya lo tiene</span>}
                    </span>
                    <input
                      type={f.type ?? "text"}
                      value={overrides[f.key] ?? ""}
                      onChange={(e) => setOverrides((o) => ({ ...o, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      autoComplete="off"
                      className="rounded-lg border border-arena bg-beige px-3 py-2 placeholder:text-ceniza focus:border-carbon focus:outline-none"
                    />
                  </label>
                );
              })}
              <div className="flex items-center gap-3">
                <button type="submit" className="rounded-lg bg-carbon px-4 py-2 text-sm font-semibold text-crema hover:bg-carbon/90">
                  Guardar destinos
                </button>
                {savedOverrides && <span className="text-sm text-brote">Guardado</span>}
              </div>
            </form>
          </Block>

          <Block title="ADN de marca" intro="Ahora vive en cada perfil de marca: abre el botón de perfiles (junto a este) para editar audiencia, voces, ADN y semillas.">
            {status && <p className="text-sm text-tinta">Umbral para generar guiones: JEV {status.ai.jev_threshold}. Modelo: {status.ai.model}.</p>}
          </Block>
        </div>
      </dialog>
    </>
  );
}
