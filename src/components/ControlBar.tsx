"use client";

import { RotateCcw, Search } from "lucide-react";
import type { ReactNode } from "react";
import {
  FORMAT_HINT_LABELS,
  FORMAT_LABELS,
  NETWORK_LABELS,
  SEARCHABLE_NETWORKS,
  SORT_LABELS,
  STAGE_INFO,
  STATUS_LABELS,
  WINDOW_OPTIONS,
} from "@/lib/client/labels";
import { ANALYSIS_STATUSES, FORMAT_TYPES, SORT_KEYS, TREND_STAGES, type TrendFilters } from "@/types/trends";

interface ControlBarProps {
  filters: TrendFilters;
  onChange: (next: TrendFilters) => void;
}

const OUTLIER_STEPS = [
  { value: undefined, label: "Cualquiera" },
  { value: 2, label: "×2+" },
  { value: 5, label: "×5+" },
  { value: 10, label: "×10+" },
] as const;

function toggle<T>(list: T[] | undefined, value: T): T[] | undefined {
  const next = list?.includes(value) ? list.filter((v) => v !== value) : [...(list ?? []), value];
  return next.length ? next : undefined;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-arena pt-4">
      <legend className="mb-2 text-sm font-semibold text-carbon">{title}</legend>
      {children}
    </fieldset>
  );
}

function Chip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
        active ? "border-carbon bg-carbon text-crema" : "border-arena bg-crema text-tinta hover:border-carbon hover:text-carbon"
      }`}
    >
      {children}
    </button>
  );
}

export default function ControlBar({ filters, onChange }: ControlBarProps) {
  const set = (patch: Partial<TrendFilters>) => onChange({ ...filters, ...patch, offset: 0 });
  const activeCount = [
    filters.networks?.length,
    filters.stages?.length,
    filters.formatHints?.length,
    filters.formats?.length,
    filters.statuses?.length,
    filters.windowDays,
    filters.minJev,
    filters.minOutlier,
    filters.search,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <label className="relative block">
        <span className="sr-only">Buscar en lo guardado</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ceniza" aria-hidden />
        <input
          type="search"
          value={filters.search ?? ""}
          onChange={(e) => set({ search: e.target.value || undefined })}
          placeholder="Buscar en lo guardado"
          className="w-full rounded-lg border border-arena bg-crema py-2 pr-3 pl-9 text-sm placeholder:text-ceniza focus:border-carbon focus:outline-none"
        />
      </label>

      <Group title="Red">
        <div className="flex flex-wrap gap-2">
          {SEARCHABLE_NETWORKS.map((n) => (
            <Chip key={n} active={!!filters.networks?.includes(n)} onClick={() => set({ networks: toggle(filters.networks, n) })}>
              {NETWORK_LABELS[n]}
            </Chip>
          ))}
        </div>
      </Group>

      <Group title="Etapa">
        <div className="flex flex-wrap gap-2">
          {TREND_STAGES.map((s) => (
            <Chip key={s} title={STAGE_INFO[s].hint} active={!!filters.stages?.includes(s)} onClick={() => set({ stages: toggle(filters.stages, s) })}>
              {STAGE_INFO[s].emoji} {STAGE_INFO[s].label}
            </Chip>
          ))}
        </div>
      </Group>

      <Group title="Publicado en">
        <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-arena text-sm">
          {WINDOW_OPTIONS.map((w) => {
            const active = filters.windowDays === w.days;
            return (
              <button
                key={w.days}
                type="button"
                aria-pressed={active}
                onClick={() => set({ windowDays: active ? undefined : w.days })}
                className={`py-1.5 ${active ? "bg-carbon text-crema" : "bg-crema text-tinta hover:text-carbon"} border-l border-arena first:border-l-0`}
              >
                {w.label}
              </button>
            );
          })}
        </div>
      </Group>

      <Group title={`Score JEV mínimo: ${filters.minJev ?? 0}`}>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={filters.minJev ?? 0}
          onChange={(e) => set({ minJev: Number(e.target.value) || undefined })}
          aria-label="Score JEV mínimo"
          className="w-full accent-dorado"
        />
        <p className="mt-1 text-xs text-tinta">Relevancia para ejecutivos y equipos de LatAm. Solo aplica a piezas ya analizadas.</p>
      </Group>

      <Group title="Outlier mínimo">
        <div className="flex flex-wrap gap-2">
          {OUTLIER_STEPS.map((o) => (
            <Chip key={o.label} active={filters.minOutlier === o.value} onClick={() => set({ minOutlier: o.value })}>
              {o.label}
            </Chip>
          ))}
        </div>
        <p className="mt-1 text-xs text-tinta">Cuántas veces superó el promedio de su propio canal. Solo YouTube.</p>
      </Group>

      <Group title="Formato">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(FORMAT_HINT_LABELS) as (keyof typeof FORMAT_HINT_LABELS)[]).map((f) => (
            <Chip key={f} active={!!filters.formatHints?.includes(f)} onClick={() => set({ formatHints: toggle(filters.formatHints, f) })}>
              {FORMAT_HINT_LABELS[f]}
            </Chip>
          ))}
        </div>
      </Group>

      <details className="border-t border-arena pt-4" open={Boolean(filters.formats?.length)}>
        <summary className="cursor-pointer text-sm font-semibold">Formato detallado (según la IA)</summary>
        <p className="mt-1 mb-2 text-xs text-tinta">Solo existe en piezas ya analizadas: filtra un subconjunto pequeño.</p>
        <div className="flex flex-wrap gap-1.5">
          {FORMAT_TYPES.map((f) => (
            <Chip key={f} active={!!filters.formats?.includes(f)} onClick={() => set({ formats: toggle(filters.formats, f) })}>
              {FORMAT_LABELS[f]}
            </Chip>
          ))}
        </div>
      </details>

      <Group title="Estado">
        <div className="flex flex-wrap gap-2">
          {ANALYSIS_STATUSES.map((s) => (
            <Chip key={s} active={!!filters.statuses?.includes(s)} onClick={() => set({ statuses: toggle(filters.statuses, s) })}>
              {STATUS_LABELS[s]}
            </Chip>
          ))}
        </div>
      </Group>

      <Group title="Ordenar por">
        <select
          value={filters.sort ?? "priority"}
          onChange={(e) => set({ sort: e.target.value as TrendFilters["sort"] })}
          className="w-full rounded-lg border border-arena bg-crema px-3 py-2 text-sm focus:border-carbon focus:outline-none"
        >
          {SORT_KEYS.map((k) => (
            <option key={k} value={k}>
              {SORT_LABELS[k]}
            </option>
          ))}
        </select>
      </Group>

      {activeCount > 0 && (
        <button
          type="button"
          onClick={() => onChange({ sort: filters.sort, limit: filters.limit })}
          className="inline-flex items-center gap-1.5 text-sm text-tinta underline-offset-4 hover:text-carbon hover:underline"
        >
          <RotateCcw className="size-3.5" aria-hidden /> Quitar {activeCount} {activeCount === 1 ? "filtro" : "filtros"}
        </button>
      )}
    </div>
  );
}
