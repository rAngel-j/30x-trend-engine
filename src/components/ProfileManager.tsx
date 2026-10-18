"use client";

import { LoaderCircle, Plus, Trash2, UserRoundCog, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, createProfile, deleteProfile, updateProfile } from "@/lib/client/api";
import type { BrandProfile, BrandProfileInput } from "@/types/trends";

interface ProfileManagerProps {
  profiles: BrandProfile[];
  activeId: string | null;
  /** Se llama con el perfil creado o editado (o null si se borró) para refrescar la lista. */
  onChanged: (selectId: string | null) => void;
}

type Draft = Omit<BrandProfileInput, "seeds"> & { seedsText: string };

const toDraft = (p: BrandProfile | undefined, asNew = false): Draft => ({
  name: asNew ? "" : p?.name ?? "",
  audience: p?.audience ?? "",
  topic_scope: p?.topic_scope ?? "",
  personal_label: asNew ? "" : p?.personal_label ?? "",
  brand_label: asNew ? "" : p?.brand_label ?? "",
  dna: p?.dna ?? "",
  seedsText: (p?.seeds ?? []).join("\n"),
});

const fromDraft = (d: Draft): BrandProfileInput => ({
  name: d.name.trim(),
  audience: d.audience.trim(),
  topic_scope: d.topic_scope.trim(),
  personal_label: d.personal_label.trim(),
  brand_label: d.brand_label.trim(),
  dna: d.dna,
  seeds: d.seedsText.split("\n").map((s) => s.trim()).filter(Boolean),
});

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      {hint && <span className="text-xs text-tinta">{hint}</span>}
      {children}
    </label>
  );
}

const input = "rounded-lg border border-arena bg-beige px-3 py-2 placeholder:text-ceniza focus:border-carbon focus:outline-none";

export default function ProfileManager({ profiles, activeId, onChanged }: ProfileManagerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(toDraft(undefined));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const current = profiles.find((p) => p.id === editingId);

  useEffect(() => {
    if (editingId === "new" || editingId === null) return;
    setDraft(toDraft(profiles.find((p) => p.id === editingId)));
  }, [editingId, profiles]);

  const open = () => {
    setMessage(null);
    setEditingId(activeId ?? profiles[0]?.id ?? null);
    dialog.current?.showModal();
  };

  const startNew = () => {
    setMessage(null);
    setDraft(toDraft(profiles.find((p) => p.id === activeId) ?? profiles[0], true));
    setEditingId("new");
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const input = fromDraft(draft);
      const { item } = editingId === "new" ? await createProfile(input) : await updateProfile(editingId!, input);
      setEditingId(item.id);
      setMessage({ error: false, text: editingId === "new" ? `Perfil "${item.name}" creado.` : "Cambios guardados. Aplican desde el siguiente análisis." });
      onChanged(item.id);
    } catch (err) {
      setMessage({ error: true, text: err instanceof ApiError ? err.message : "No se pudo guardar el perfil." });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!current || current.is_default) return;
    if (!window.confirm(`¿Borrar el perfil "${current.name}"? Sus radares y vistas guardadas también se borran.`)) return;
    setBusy(true);
    try {
      await deleteProfile(current.id);
      setEditingId(profiles.find((p) => p.is_default)?.id ?? null);
      onChanged(null);
    } catch (err) {
      setMessage({ error: true, text: err instanceof ApiError ? err.message : "No se pudo borrar el perfil." });
    } finally {
      setBusy(false);
    }
  };

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Gestionar perfiles de marca"
        title="Gestionar perfiles de marca"
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-arena px-3 text-sm text-tinta hover:border-carbon hover:text-carbon"
      >
        <UserRoundCog className="size-4" aria-hidden />
        <span className="hidden sm:inline">Perfiles</span>
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="pm-title"
        className="m-auto max-h-[92vh] w-[min(56rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl bg-crema p-0 text-carbon"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-arena bg-crema px-5 py-4">
          <div>
            <h2 id="pm-title" className="wide text-lg font-bold">
              Perfiles de marca
            </h2>
            <p className="text-sm text-tinta">Cada perfil define audiencia, voces, ADN y semillas. Hecho para 30X, útil para cualquier marca.</p>
          </div>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Cerrar" className="rounded-md p-1 text-tinta hover:text-carbon">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="grid gap-6 p-5 md:grid-cols-[13rem_1fr]">
          <nav aria-label="Perfiles" className="space-y-1">
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setMessage(null);
                  setEditingId(p.id);
                }}
                aria-current={editingId === p.id}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${editingId === p.id ? "bg-carbon text-crema" : "hover:bg-beige"}`}
              >
                <span className="font-semibold">{p.name}</span>
                {p.is_default && <span className={`ml-2 text-xs ${editingId === p.id ? "text-crema/70" : "text-tinta"}`}>principal</span>}
              </button>
            ))}
            <button
              type="button"
              onClick={startNew}
              className={`mt-2 inline-flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm ${editingId === "new" ? "border-carbon" : "border-arena text-tinta hover:border-carbon hover:text-carbon"}`}
            >
              <Plus className="size-4" aria-hidden /> Nuevo perfil
            </button>
          </nav>

          {editingId && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              {editingId === "new" && (
                <p className="rounded-lg bg-beige p-3 text-sm text-tinta">
                  Partimos del perfil actual como plantilla: cambia nombre, audiencia, voces y semillas, y adapta el ADN (todavía describe al perfil original).
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre">
                  <input className={input} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ej.: Fintech Andina" required minLength={2} maxLength={60} />
                </Field>
                <Field label="Temas que le interesan" hint="El radar deja fuera lo que no trate de esto.">
                  <input className={input} value={draft.topic_scope} onChange={(e) => set({ topic_scope: e.target.value })} placeholder="IA aplicada a finanzas personales" required />
                </Field>
              </div>
              <Field label="Audiencia" hint="A quién le habla. El score JEV mide qué tanto le sirve cada pieza a esta audiencia.">
                <input className={input} value={draft.audience} onChange={(e) => set({ audience: e.target.value })} placeholder="Jóvenes profesionales de LatAm que empiezan a invertir" required />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Voz personal (Reel)" hint="Fundador, vocero o creador.">
                  <input className={input} value={draft.personal_label} onChange={(e) => set({ personal_label: e.target.value })} placeholder="@fundadora" required />
                </Field>
                <Field label="Voz de marca (carrusel)">
                  <input className={input} value={draft.brand_label} onChange={(e) => set({ brand_label: e.target.value })} placeholder="@marca" required />
                </Field>
              </div>
              <Field label="Semillas del radar" hint="Una búsqueda por línea. Mezcla español e inglés para detectar lo que aún no llega al español (2 a 16).">
                <textarea className={`${input} font-mono text-xs`} rows={5} value={draft.seedsText} onChange={(e) => set({ seedsText: e.target.value })} />
              </Field>
              <Field label="ADN de marca" hint="Reglas de voz, Matriz JEV y prohibiciones, en Markdown. Es lo que sigue la IA al escribir los guiones.">
                <textarea className={`${input} font-mono text-xs leading-relaxed`} rows={12} spellCheck={false} value={draft.dna} onChange={(e) => set({ dna: e.target.value })} />
              </Field>

              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-carbon px-4 py-2 text-sm font-semibold text-crema hover:bg-carbon/90 disabled:opacity-60">
                  {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
                  {editingId === "new" ? "Crear perfil" : "Guardar cambios"}
                </button>
                {current && !current.is_default && (
                  <button type="button" onClick={remove} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-arena px-3 py-2 text-sm text-alerta hover:border-alerta">
                    <Trash2 className="size-4" aria-hidden /> Borrar perfil
                  </button>
                )}
                {message && (
                  <span role="status" className={`text-sm ${message.error ? "text-alerta" : "text-brote"}`}>
                    {message.text}
                  </span>
                )}
              </div>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
