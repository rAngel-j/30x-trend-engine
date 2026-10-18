"use client";

import { Bookmark, BookmarkPlus, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, createView, deleteView, listViews } from "@/lib/client/api";
import type { SavedView, TrendFilters } from "@/types/trends";

interface SavedViewsProps {
  profileId: string | null;
  filters: TrendFilters;
  onApply: (filters: TrendFilters) => void;
}

/** Filtros con nombre ("Emergentes de LinkedIn con JEV ≥ 70"), guardados por perfil y compartidos por el equipo. */
export default function SavedViews({ profileId, filters, onApply }: SavedViewsProps) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profileId) return;
    listViews(profileId)
      .then((r) => setViews(r.items))
      .catch(() => setViews([]));
  }, [profileId]);

  const hasFilters = Object.entries(filters).some(([k, v]) => !["limit", "offset", "sort"].includes(k) && v !== undefined && !(Array.isArray(v) && v.length === 0));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!profileId || name.trim().length < 2) return;
    setError(null);
    try {
      const { limit: _l, offset: _o, ...clean } = filters;
      const { item } = await createView(profileId, name.trim(), clean);
      setViews((v) => [...v, item]);
      setName("");
      setNaming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la vista.");
    }
  };

  const remove = async (id: string) => {
    setViews((v) => v.filter((x) => x.id !== id));
    try {
      await deleteView(id);
    } catch {
      /* si falla, se vuelve a ver al recargar */
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Mis vistas</p>
      {views.length === 0 && !naming && <p className="text-xs text-tinta">Combina filtros y guárdalos con un nombre para volver a ellos con un clic.</p>}
      <div className="flex flex-wrap gap-1.5">
        {views.map((v) => (
          <span key={v.id} className="inline-flex items-center rounded-full border border-arena bg-crema text-sm">
            <button type="button" onClick={() => onApply({ ...v.filters, sort: v.filters.sort })} className="inline-flex items-center gap-1 py-1 pr-1 pl-3 hover:text-dorado-hondo" title="Aplicar esta vista">
              <Bookmark className="size-3" aria-hidden /> {v.name}
            </button>
            <button type="button" onClick={() => remove(v.id)} aria-label={`Borrar la vista ${v.name}`} className="rounded-full p-1 pr-2 text-ceniza hover:text-alerta">
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
      </div>
      {naming ? (
        <form onSubmit={save} className="flex gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="Nombre de la vista"
            aria-label="Nombre de la vista"
            className="min-w-0 flex-1 rounded-lg border border-arena bg-crema px-2 py-1 text-sm placeholder:text-ceniza focus:border-carbon focus:outline-none"
          />
          <button type="submit" className="rounded-lg bg-carbon px-3 py-1 text-sm font-semibold text-crema">
            Guardar
          </button>
          <button type="button" onClick={() => setNaming(false)} className="text-sm text-tinta hover:text-carbon">
            Cancelar
          </button>
        </form>
      ) : (
        <button
          type="button"
          disabled={!hasFilters}
          onClick={() => setNaming(true)}
          title={hasFilters ? "Guardar los filtros actuales" : "Elige algún filtro primero"}
          className="inline-flex items-center gap-1.5 text-sm text-tinta hover:text-carbon disabled:cursor-not-allowed disabled:opacity-50"
        >
          <BookmarkPlus className="size-4" aria-hidden /> Guardar filtros actuales
        </button>
      )}
      {error && <p className="text-xs text-alerta">{error}</p>}
    </div>
  );
}
