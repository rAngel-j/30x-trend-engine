"use client";

import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

/** Entrada a la demo cuando DEMO_ACCESS_CODE está activo. */
export default function AccessPage() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      if (!res.ok) {
        setError(res.status === 401 ? "Código incorrecto. Pídelo a quien te compartió la demo." : "No se pudo validar el código.");
        return;
      }
      // Solo rutas internas: evita redirecciones abiertas a otros sitios.
      const next = new URLSearchParams(window.location.search).get("next") ?? "/";
      window.location.assign(next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <p className="wide text-2xl font-black">30X</p>
      <h1 className="semiwide mt-6 text-3xl font-bold">Radar de tendencias</h1>
      <p className="mt-2 text-tinta">Esta demo está protegida para cuidar la cuota de las APIs. Ingresa el código que te compartieron.</p>
      <form onSubmit={submit} className="mt-6 flex gap-2">
        <label htmlFor="access-code" className="sr-only">
          Código de acceso
        </label>
        <input
          id="access-code"
          type="password"
          autoComplete="off"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-arena bg-beige px-3 py-2 focus:border-carbon focus:outline-none"
          placeholder="Código de acceso"
          required
        />
        <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-dorado px-4 py-2 font-semibold text-[#18181b] disabled:opacity-60">
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Entrar
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-alerta">
          {error}
        </p>
      )}
    </main>
  );
}
