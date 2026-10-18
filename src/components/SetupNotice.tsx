"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { getStatus, type ServerStatus } from "@/lib/client/api";

/** Solo aparece si falta lo mínimo para buscar en vivo: dice qué falta y cómo resolverlo. */
export default function SetupNotice() {
  const [status, setStatus] = useState<ServerStatus | null>(null);

  useEffect(() => {
    getStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  if (!status) return null;
  const missing: string[] = [];
  if (!status.ai.gemini) missing.push("Gemini (GEMINI_API_KEY) para la autopsia, el JEV y los guiones");
  if (!status.sources.youtube_api && !status.sources.tavily && !status.sources.google_cse) {
    missing.push("al menos una fuente: YouTube (YOUTUBE_API_KEY) o LinkedIn, Instagram y TikTok (TAVILY_API_KEY)");
  }
  if (missing.length === 0) return null;

  return (
    <div role="status" className="mt-4 flex max-w-3xl gap-3 rounded-xl border border-dorado/60 bg-beige p-4 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-dorado-hondo" aria-hidden />
      <div>
        <p className="font-semibold">Para buscar en vivo falta conectar {missing.length === 1 ? "una cosa" : "dos cosas"}:</p>
        <ul className="mt-1 list-disc pl-5 text-tinta">
          {missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <p className="mt-2 text-tinta">
          Agrega las claves en <code className="rounded bg-crema px-1">.env.local</code> y comprueba con <code className="rounded bg-crema px-1">npm run doctor</code>. Mientras
          tanto puedes explorar lo que ya está guardado.
        </p>
      </div>
    </div>
  );
}
