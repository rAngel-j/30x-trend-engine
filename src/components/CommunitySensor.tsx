"use client";

import { Link2, LoaderCircle } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { analyzeUrl, ApiError } from "@/lib/client/api";
import type { TrendSignal } from "@/types/trends";

const NAME_KEY = "30x.sensorName";

interface CommunitySensorProps {
  onAnalyzed: (item: TrendSignal) => void;
}

type Feedback = { tone: "ok" | "warn" | "error"; text: string } | null;

export default function CommunitySensor({ onAnalyzed }: CommunitySensorProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    try {
      setName(window.localStorage.getItem(NAME_KEY) ?? "");
    } catch {
      /* sin almacenamiento: el nombre es opcional */
    }
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      try {
        if (name.trim()) window.localStorage.setItem(NAME_KEY, name.trim());
      } catch {
        /* ignorar */
      }
      const res = await analyzeUrl({ url: url.trim(), submitted_by: name.trim() || undefined, text: text.trim() || undefined });
      onAnalyzed(res.item);
      setUrl("");
      setText("");
      const pendingAi = res.item.analysis_status !== "analyzed";
      setFeedback({
        tone: pendingAi ? "warn" : "ok",
        text: res.cached
          ? `Ya estaba analizada: “${res.item.title}”.`
          : pendingAi
            ? res.item.analysis_error
              ? `Guardada, pero el análisis falló: ${res.item.analysis_error}`
              : "Guardada sin autopsia: conecta Gemini (GEMINI_API_KEY) para ver por qué funcionó y recibir los guiones."
            : `Analizada: “${res.item.title}”. JEV ${res.item.jev_score}.`,
      });
    } catch (err) {
      setFeedback({ tone: "error", text: err instanceof ApiError ? err.message : "No se pudo analizar el enlace. Revisa tu conexión." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-arena bg-beige p-3 sm:p-4">
      <label htmlFor="sensor-url" className="mb-2 block text-sm font-semibold">
        ¿Viste algo que está funcionando? Pega el enlace y te decimos por qué.
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ceniza" aria-hidden />
          <input
            id="sensor-url"
            type="url"
            inputMode="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.linkedin.com/posts/…"
            className="w-full rounded-lg border border-arena bg-crema py-2 pr-3 pl-9 text-sm placeholder:text-ceniza focus:border-carbon focus:outline-none"
          />
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tu nombre (opcional)"
          aria-label="Tu nombre"
          className="rounded-lg border border-arena bg-crema px-3 py-2 text-sm placeholder:text-ceniza focus:border-carbon focus:outline-none sm:w-44"
        />
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-carbon px-4 py-2 text-sm font-semibold text-crema hover:bg-carbon/90 disabled:opacity-60"
        >
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          {busy ? "Analizando…" : "Analizar enlace"}
        </button>
      </div>
      <details className="mt-2 text-sm" open={text.length > 0}>
        <summary className="cursor-pointer text-tinta hover:text-carbon">Añadir el texto de la publicación (recomendado en LinkedIn, Instagram y TikTok)</summary>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={8000}
          rows={4}
          placeholder="Copia aquí el texto tal como lo viste. No descargamos páginas de redes cerradas: sus términos lo prohíben."
          aria-label="Texto de la publicación"
          className="mt-2 w-full rounded-lg border border-arena bg-crema p-3 placeholder:text-ceniza focus:border-carbon focus:outline-none"
        />
      </details>
      {feedback && (
        <p
          role="status"
          className={`mt-2 text-sm ${feedback.tone === "error" ? "text-alerta" : feedback.tone === "warn" ? "text-dorado-hondo" : "text-brote"}`}
        >
          {feedback.text}
        </p>
      )}
    </form>
  );
}
