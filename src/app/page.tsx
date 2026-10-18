"use client";

import { LoaderCircle, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import CommunitySensor from "@/components/CommunitySensor";
import ControlBar from "@/components/ControlBar";
import PlugAndPlayConfig from "@/components/PlugAndPlayConfig";
import ProfileManager from "@/components/ProfileManager";
import RadarBoard from "@/components/RadarBoard";
import SavedViews from "@/components/SavedViews";
import ThemeToggle from "@/components/ThemeToggle";
import TrendCard from "@/components/TrendCard";
import {
  ApiError,
  analyzeUrl,
  discover,
  exportTrend,
  filtersToQuery,
  listProfiles,
  listTrends,
  loadActiveProfileId,
  queryToFilters,
  storeActiveProfileId,
  type DiscoverResponse,
  type ExportOverrides,
  type ExportResult,
  type ExportTarget,
} from "@/lib/client/api";
import { NETWORK_LABELS, SEARCHABLE_NETWORKS, WINDOW_OPTIONS } from "@/lib/client/labels";
import type { BrandProfile, Network, SourceReport, TrendFilters, TrendSignal } from "@/types/trends";

const PAGE_SIZE = 10;

const SOURCE_LABELS: Record<SourceReport["source"], string> = {
  youtube_api: "YouTube",
  tavily: "LinkedIn, Instagram y TikTok",
  google_cse: "LinkedIn, Instagram y TikTok (Google)",
  community: "Comunidad 30X",
};

type Notice = { tone: "info" | "warn" | "error"; text: string; sources?: SourceReport[] } | null;

export default function RadarPage() {
  const [filters, setFilters] = useState<TrendFilters>({});
  const [profiles, setProfiles] = useState<BrandProfile[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const profile = profiles.find((p) => p.id === profileId) ?? null;
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<TrendSignal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const [query, setQuery] = useState("");
  const [searchNetworks, setSearchNetworks] = useState<Exclude<Network, "web">[]>([...SEARCHABLE_NETWORKS]);
  const [windowDays, setWindowDays] = useState(7);
  const [searching, setSearching] = useState(false);
  const [lastRun, setLastRun] = useState<DiscoverResponse | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const overrides = useRef<ExportOverrides>({});
  const onOverridesChange = useCallback((o: ExportOverrides) => {
    overrides.current = o;
  }, []);

  const reloadProfiles = useCallback(async (selectId?: string | null) => {
    try {
      const { items, default_id } = await listProfiles();
      setProfiles(items);
      setProfileId((current) => {
        const wanted = selectId ?? current ?? loadActiveProfileId();
        const next = wanted && items.some((p) => p.id === wanted) ? wanted : default_id;
        storeActiveProfileId(next);
        return next;
      });
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "No se pudieron cargar los perfiles.");
    }
  }, []);

  useEffect(() => {
    void reloadProfiles();
  }, [reloadProfiles]);

  const switchProfile = (id: string) => {
    storeActiveProfileId(id);
    setProfileId(id);
    setExpandedId(null);
    setLastRun(null);
    setNotice(null);
  };

  // Filtros ⇄ URL: una vista filtrada se comparte copiando el enlace.
  useEffect(() => {
    setFilters(queryToFilters(new URLSearchParams(window.location.search)));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const qs = filtersToQuery({ ...filters, limit: undefined, offset: undefined });
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [filters, ready]);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        if (!profileId) return;
        const page = await listTrends({ ...filters, limit: filters.limit ?? PAGE_SIZE }, profileId, signal);
        setItems(page.items);
        setTotal(page.total);
        setListError(null);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setListError(err instanceof ApiError ? err.message : "No se pudo cargar la lista. Revisa que el servidor esté corriendo.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [filters, profileId],
  );

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const timer = setTimeout(() => refresh(controller.signal), 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [refresh, ready]);

  const runDiscovery = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2 || searchNetworks.length === 0) return;
    setSearching(true);
    setNotice(null);
    try {
      const res = await discover({ query: q, networks: searchNetworks, windowDays, analyzeTop: 5, profileId: profileId ?? undefined });
      setLastRun(res);
      setExpandedId(null);
      setFilters({ search: q, sort: "priority" });
      if (res.total === 0) setNotice({ tone: "warn", text: `No apareció nada sobre “${q}” en ${windowDaysLabel(windowDays)}. Prueba una ventana más amplia o un tema más general.`, sources: res.sources });
    } catch (err) {
      setLastRun(null);
      setNotice({
        tone: "error",
        text: err instanceof ApiError ? err.message : "La búsqueda no terminó. Revisa tu conexión e inténtalo de nuevo.",
        sources: err instanceof ApiError ? (err.payload.sources as SourceReport[] | undefined) : undefined,
      });
    } finally {
      setSearching(false);
    }
  };

  const replaceItem = (item: TrendSignal) => {
    setItems((list) => {
      const exists = list.some((s) => s.id === item.id);
      return exists ? list.map((s) => (s.id === item.id ? item : s)) : [item, ...list];
    });
  };

  const handleAnalyze = async (signal: TrendSignal): Promise<TrendSignal | void> => {
    try {
      const res = await analyzeUrl({ id: signal.id, force: true, profileId: profileId ?? undefined });
      replaceItem(res.item);
      if (res.item.analysis_status !== "analyzed") {
        setNotice({ tone: "warn", text: res.item.analysis_error ?? res.warnings.at(-1) ?? "La pieza sigue sin analizar." });
      }
      return res.item;
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "No se pudo analizar la pieza." });
    }
  };

  const handleExport = async (signal: TrendSignal, target: ExportTarget): Promise<ExportResult> => {
    try {
      const res = await exportTrend(signal.id, [target], overrides.current);
      return res.results[0] ?? { target, status: "error", message: "Sin respuesta del servidor" };
    } catch (err) {
      return { target, status: "error", message: err instanceof ApiError ? err.message : "No se pudo enviar." };
    }
  };

  const handleSensorResult = (item: TrendSignal) => {
    replaceItem(item);
    setExpandedId(item.id);
  };

  const hasFilters = Object.entries(filters).some(([k, v]) => k !== "sort" && k !== "limit" && v !== undefined);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <p className="flex items-baseline gap-2">
          <span className="wide text-2xl font-black">30X</span>
          <span className="text-tinta">Radar de tendencias</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="profile-select" className="sr-only">
            Perfil de marca activo
          </label>
          <select
            id="profile-select"
            value={profileId ?? ""}
            onChange={(e) => switchProfile(e.target.value)}
            disabled={profiles.length === 0}
            className="h-9 max-w-[14rem] rounded-lg border border-arena bg-crema px-3 text-sm font-semibold focus:border-carbon focus:outline-none"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                Perfil: {p.name}
              </option>
            ))}
          </select>
          <ProfileManager profiles={profiles} activeId={profileId} onChanged={(id) => void reloadProfiles(id)} />
          <ThemeToggle />
          <PlugAndPlayConfig onOverridesChange={onOverridesChange} />
        </div>
      </header>

      <RadarBoard profile={profile} onAnalyze={handleAnalyze} onExport={handleExport} />

      <form onSubmit={runDiscovery} className="mt-16 border-t border-arena pt-10 pb-6">
        <p className="mb-3 text-sm text-tinta">¿Tienes un tema concreto en mente? Explóralo pieza por pieza.</p>
        <h2 className="semiwide max-w-5xl text-3xl leading-[1.1] font-bold sm:text-4xl">
          <label htmlFor="hero-query">¿Qué está despegando sobre</label>{" "}
          <span className="inline-flex w-full max-w-[16ch] items-end">
            <input
              id="hero-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="agentes de IA"
              minLength={2}
              maxLength={200}
              required
              className="min-w-0 flex-1 border-b-4 border-dorado bg-transparent pb-1 font-bold text-carbon placeholder:text-arena focus:border-carbon focus:outline-none"
            />
            <span aria-hidden>?</span>
          </span>
        </h2>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Redes donde buscar</legend>
            {SEARCHABLE_NETWORKS.map((n) => {
              const active = searchNetworks.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSearchNetworks((list) => (active ? list.filter((x) => x !== n) : [...list, n]))}
                  className={`rounded-full border px-3 py-1 text-sm ${active ? "border-carbon bg-carbon text-crema" : "border-arena text-tinta hover:border-carbon"}`}
                >
                  {NETWORK_LABELS[n]}
                </button>
              );
            })}
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-tinta">
            en
            <select
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
              className="rounded-lg border border-arena bg-crema px-2 py-1 text-carbon focus:border-carbon focus:outline-none"
            >
              {WINDOW_OPTIONS.map((w) => (
                <option key={w.days} value={w.days}>
                  {w.days === 1 ? "las últimas 24 h" : `los últimos ${w.label}`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={searching || searchNetworks.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-dorado px-5 py-2.5 font-semibold text-[#18181b] hover:bg-dorado/85 disabled:opacity-60"
          >
            {searching && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            {searching ? "Buscando y analizando…" : "Buscar ahora"}
          </button>
        </div>
        <p className="mt-3 max-w-2xl text-sm text-tinta">
          Buscamos en vivo, también en inglés, para detectar lo que todavía no llega al español. Las 5 piezas con más potencial salen con autopsia y guion.
        </p>
      </form>

      <CommunitySensor profileId={profileId} onAnalyzed={handleSensorResult} />

      {(lastRun || notice) && (
        <div role="status" className="mt-4 space-y-2 text-sm">
          {lastRun && lastRun.total > 0 && (
            <p>
              Encontramos {lastRun.total} {lastRun.total === 1 ? "pieza" : "piezas"} para {lastRun.queries.map((q) => `“${q}”`).join(" y ")}.{" "}
              {lastRun.analysis.analyzed > 0 && `Analizamos las ${lastRun.analysis.analyzed} con más prioridad. `}
              {lastRun.analysis.skipped_reason && <span className="text-dorado-hondo">{lastRun.analysis.skipped_reason}</span>}
            </p>
          )}
          {lastRun?.notes?.map((n) => (
            <p key={n} className="text-tinta">
              {n}
            </p>
          ))}
          {notice && <p className={notice.tone === "error" ? "text-alerta" : notice.tone === "warn" ? "text-dorado-hondo" : ""}>{notice.text}</p>}
          {(notice?.sources ?? lastRun?.sources)?.filter((s) => s.status !== "ok").map((s) => (
            <p key={s.source} className="text-tinta">
              {SOURCE_LABELS[s.source]}: {s.status === "disabled" ? "sin conectar" : "falló"}. {s.message}
            </p>
          ))}
        </div>
      )}

      <div className="mt-10 grid gap-8 lg:grid-cols-[16.5rem_1fr]">
        <aside>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className="mb-3 inline-flex items-center gap-2 rounded-lg border border-arena px-3 py-1.5 text-sm lg:hidden"
          >
            <SlidersHorizontal className="size-4" aria-hidden /> {showFilters ? "Ocultar filtros" : "Filtrar"}
          </button>
          <div className={`${showFilters ? "block" : "hidden"} lg:sticky lg:top-6 lg:block`}>
            <div className="mb-5">
              <SavedViews profileId={profileId} filters={filters} onApply={(f) => setFilters(f)} />
            </div>
            <ControlBar filters={filters} onChange={setFilters} />
          </div>
        </aside>

        <section aria-labelledby="ranking-title" aria-busy={loading}>
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 id="ranking-title" className="wide text-2xl font-bold">
              {items.length > 0 ? `Top ${items.length}` : "Ranking"}
            </h2>
            <p className="text-sm text-tinta">
              {loading ? "Actualizando…" : total > 0 ? `${total} ${total === 1 ? "pieza guardada coincide" : "piezas guardadas coinciden"}` : ""}
            </p>
          </div>

          {listError ? (
            <p className="rounded-xl border border-alerta p-4 text-sm text-alerta">{listError}</p>
          ) : items.length === 0 && !loading ? (
            <div className="rounded-xl border border-dashed border-arena p-8">
              <p className="semiwide text-lg font-semibold">{hasFilters ? "Ninguna pieza cumple estos filtros." : "Todavía no hay tendencias guardadas."}</p>
              <p className="mt-2 max-w-prose text-sm text-tinta">
                {hasFilters
                  ? "Quita algún filtro o amplía la ventana de fecha. Las piezas sin analizar no tienen score JEV ni formato."
                  : "Escribe un tema arriba y pulsa Buscar ahora, o pega un enlace que hayas visto funcionar."}
              </p>
            </div>
          ) : (
            <ol className={`space-y-2 ${loading ? "opacity-60" : ""}`}>
              {items.map((s, i) => (
                <TrendCard
                  key={s.id}
                  signal={s}
                  rank={(filters.offset ?? 0) + i + 1}
                  expanded={expandedId === s.id}
                  onToggle={() => setExpandedId((id) => (id === s.id ? null : s.id))}
                  onAnalyze={handleAnalyze}
                  onExport={handleExport}
                />
              ))}
            </ol>
          )}

          {items.length > 0 && items.length < total && (
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...f, limit: (f.limit ?? PAGE_SIZE) + PAGE_SIZE }))}
              className="mt-4 w-full rounded-xl border border-arena py-3 text-sm hover:border-carbon"
            >
              Ver {Math.min(PAGE_SIZE, total - items.length)} más
            </button>
          )}
        </section>
      </div>

      <footer className="mt-16 border-t border-arena pt-6 text-xs leading-relaxed text-tinta">
        <p className="max-w-3xl">
          Solo contenido público: APIs oficiales, índices de búsqueda, oEmbed y enlaces que comparte el equipo. Nunca usamos cuentas, logins ni descargamos
          páginas de LinkedIn, Instagram o TikTok.
        </p>
        <p className="mt-2 max-w-3xl">
          Datos de video obtenidos con YouTube API Services. Outlier, velocidad, etapa y score JEV son cálculos propios de 30X, no métricas de YouTube. Al usar
          esta herramienta aceptas los{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-carbon">
            Términos de servicio de YouTube
          </a>{" "}
          y la{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-carbon">
            Política de privacidad de Google
          </a>
          . Los datos de YouTube se borran si no se refrescan en 30 días.
        </p>
      </footer>
    </div>
  );
}

function windowDaysLabel(days: number): string {
  return days === 1 ? "las últimas 24 horas" : `los últimos ${days} días`;
}
