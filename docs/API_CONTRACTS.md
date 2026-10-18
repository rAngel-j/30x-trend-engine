# Contratos de API — 30X Trend Intelligence Engine

> Fuente de verdad de tipos: `src/types/trends.ts`. Este documento la describe y fija las firmas públicas de cada módulo.
> Estado: módulos internos **implementados (Fase 2)** · endpoints HTTP **implementados (Fase 3)**.

---

## 1. Entidad central: `TrendSignal`

Cada fila de `trend_signals` responde las 3 preguntas del reto:

| Pregunta | Campos |
|---|---|
| **A. ¿Está despegando y en qué etapa?** | `outlier_score`, `velocity_per_hour`, `author_weight`, `stage` (`emerging` · `peaking` · `saturated`), `stage_score`, `stage_evidence` |
| **B. ¿Por qué funcionó? (5 variables)** | `analysis.forensic.hook_analysis` · `format_type` · `topic_angle` · `timing_reason` · `author_vs_content` |
| **C. ¿Le sirve a 30X y cómo lo adapto?** | `jev_score` + `analysis.jev.breakdown`, `analysis.adaptations.andres_bilbao_reel`, `analysis.adaptations.x30_carousel`, `contrarian_angle` |

```jsonc
{
  "id": "uuid",
  "fingerprint": "sha256(url canónica)",
  "network": "youtube | linkedin | instagram | tiktok | web",
  "source": "youtube_api | tavily | google_cse | community",
  "url": "https://…",
  "title": "…",
  "excerpt": "…",
  // Sin datos personales: no hay nombre, handle, perfil ni miniatura del autor (ARCHITECTURE §7b-ter)
  "published_at": "2026-10-15T14:00:00.000Z",
  "language": "es | en | pt | other",
  "format_hint": "short_vertical | long_video | reel | image_post | text_post | article | unknown",
  "metrics": {
    "views": 120000, "likes": 5400, "comments": 310, "shares": null,
    "author_followers": 8200, "author_avg_views": 3100, "duration_seconds": 47
  },
  "outlier_score": 38.7,          // views / promedio del autor (null en SERP)
  "velocity_per_hour": 2500,
  "author_weight": 0.07,          // 0 = mérito del contenido, 1 = mérito del autor
  "stage": "emerging",
  "stage_score": 78,
  "stage_evidence": { "cohort_size": 22, "es_share": 0.05, "fresh_share": 0.55, "median_outlier": 4.2, "rule": "…" },
  "format_type": "reel_pantalla_dividida_demo",
  "jev_score": 82,
  "priority_score": 87.3,
  "analysis_status": "pending | analyzed | failed",
  "analysis_error": null,
  "analysis": { "forensic": {…}, "jev": {…}, "adaptations": {…} | null, "model": "gemini-3.8-flash", "analyzed_at": "…" },
  "query": "agentes de IA ventas",
  "discovered_at": "…", "last_seen_at": "…"
}
```

---

## 2. Módulos internos (Fase 2 — implementados)

### 2.1 Fuentes — `src/lib/sources/*`

| Función | Firma | Notas |
|---|---|---|
| `discoverYouTubeOutliers` | `(req: DiscoveryRequest) => Promise<{ signals: RawSignal[]; report: SourceReport }>` | `search.list` + `videos.list` + `channels.list`. Calcula outlier, velocidad, peso de autor. `report.quota_units` ≈ 102 por formato. |
| `fetchYouTubeVideos` | `(ids: string[], query: string) => Promise<RawSignal[]>` | Para el Sensor de Comunidad: enriquece una URL de YouTube con métricas reales. |
| `lookupIndexedUrl` | `(url: string, network) => Promise<SerpHit | null>` | Busca esa URL exacta en el índice público (Tavily → CSE). Para el Sensor en redes cerradas. |
| `discoverSocialSerp` | `(req: DiscoveryRequest) => Promise<{ signals: RawSignal[]; reports: SourceReport[] }>` | Tavily (principal) → Google CSE (respaldo). Solo `linkedin`, `instagram`, `tiktok`. |
| `readPublicUrl` | `(url: string, { text? }) => Promise<PublicReading>` | Redes cerradas: oEmbed + índice de búsqueda + texto de la persona (nunca descarga la página). YouTube: API + oEmbed. Web abierta: Jina. Devuelve `{ signal: RawSignal; content: string; providers: string[]; warnings: string[] }`. Rechaza URLs privadas (anti-SSRF). |
| `collectSignals` | `(req: DiscoveryRequest) => Promise<DiscoveryResult>` | Corre las fuentes en paralelo, deduplica por URL canónica y aplica `classifyCohort`. Nunca lanza por una fuente caída: lo reporta en `sources[]`. |

### 2.2 Inteligencia — `src/lib/intelligence/*`

| Función | Firma | Notas |
|---|---|---|
| `runRadar` | `(repo, { networks, maxTopics }) => Promise<RadarResult>` | Radar semanal completo (`src/lib/radar.ts`). Requiere Gemini. |
| `clusterTopics` | `(signals) => Promise<TopicCluster[]>` | Una llamada a Gemini; valida índices y exige ≥ 2 piezas por tema. |
| `computeTopicGrowth` | `(members, now?) => TopicGrowth` | Esta semana vs. anterior, crecimiento y volumen (deterministas). |
| `classifyCohort` | `(signals: RawSignal[]) => StagedSignal[]` | Determinista. Detecta idioma y asigna etapa a toda la cohorte. |
| `detectLanguage` | `(text: string) => Language \| null` | Heurística de stopwords. |
| `runForensic5D` | `(signal: StagedSignal, content?: string) => Promise<ForensicAutopsy>` | Gemini + `responseSchema`. |
| `scoreJev` | `(signal: StagedSignal, content?: string) => Promise<JevResult>` | Gemini puntúa 3 criterios; el código pondera 0.40 / 0.35 / 0.25. |
| `adaptToBrandDna` | `(signal, forensic, jev, content?) => Promise<BrandAdaptations>` | Lee `docs/30X_BRAND_DNA.md` en runtime. `contrarian_angle` obligatorio si `stage = saturated`. |
| `enrichSignal` | `(signal: StagedSignal, content?: string) => Promise<TrendAnalysis>` | Orquesta: forense ∥ JEV → adaptación si `jev ≥ JEV_ADAPT_THRESHOLD`. |
| `computePriority` | `(signal, jevScore) => number` | Fórmula en `ARCHITECTURE.md §4.4`. |

### 2.3 Persistencia — `src/lib/db/supabase.ts`

```ts
interface TrendRepository {
  readonly kind: "supabase" | "sqlite";
  upsertSignals(signals: StagedSignal[]): Promise<TrendSignal[]>;
  saveAnalysis(id: string, analysis: TrendAnalysis): Promise<TrendSignal>;
  markAnalysisFailed(id: string, error: string): Promise<void>;
  getSignal(id: string): Promise<TrendSignal | null>;
  getSignalByUrl(url: string): Promise<TrendSignal | null>;   // por fingerprint de la URL canónica
  querySignals(filters: TrendFilters): Promise<TrendPage>;
  logDiscoveryRun(run: DiscoveryRunLog): Promise<void>;
  purgeExpiredYouTube(days?: number): Promise<number>;   // política de 30 días de la YouTube API
  close(): Promise<void>;                 // libera el archivo SQLite
}
getTrendRepository(): TrendRepository   // elige Supabase o SQLite según el entorno
```

`TrendFilters` — todos opcionales:

| Campo | Tipo | Efecto |
|---|---|---|
| `networks` | `Network[]` | `network IN (…)` |
| `stages` | `TrendStage[]` | `stage IN (…)` |
| `formats` | `FormatType[]` | `format_type IN (…)` |
| `languages` | `Language[]` | `language IN (…)` |
| `statuses` | `AnalysisStatus[]` | `analysis_status IN (…)` |
| `windowDays` | `number` | `published_at ≥ now − N días` (o `discovered_at` si no hay fecha) |
| `minJev` / `maxJev` | `number` | rango sobre `jev_score` |
| `minOutlier` | `number` | `outlier_score ≥ N` |
| `search` | `string` | Postgres: `websearch_to_tsquery`; SQLite: `LIKE` sobre título, extracto, consulta |
| `sort` | `priority \| jev \| outlier \| recent \| velocity` | orden descendente |
| `limit` / `offset` | `number` | paginación (limit máx. 100, por defecto 20) |

---

## 3. Endpoints HTTP (Fase 3 — implementados)

Todas las rutas corren en runtime `nodejs`, validan la entrada con Zod y responden errores como `{ "error": { "code": string, "message": string } }` (ver §4).

### `POST /api/discover` — descubrir + analizar

```jsonc
// Request
{
  "query": "agentes de IA para ventas",        // 2-200 caracteres
  "networks": ["youtube","linkedin","instagram","tiktok"],
  "windowDays": 7,                              // 1-90
  "youtubeFormat": "any",                       // any | short | long
  "maxPerSource": 20,                           // 1-50
  "bilingual": true,                            // añade UNA variante en el otro idioma (requiere GEMINI_API_KEY)
  "analyzeTop": 5                               // 0-10 señales a pasar por Gemini, por prioridad
}
// Response 200
{
  "items": TrendSignal[],          // señales de ESTA corrida, ordenadas por priority_score
  "total": 37,
  "sources": SourceReport[],       // estado de cada fuente (ok | disabled | error)
  "queries": ["agentes de IA para ventas", "AI agents for sales"],
  "analysis": { "requested": 5, "analyzed": 4, "failed": 1, "skipped_reason": null },
  "repository": "supabase" | "sqlite",
  "took_ms": 21450
}
```

- Si **todas** las fuentes están `disabled` → `503 NO_SOURCES` con los `sources` para que la UI diga qué clave falta.
- Las señales ya analizadas no se vuelven a enviar a Gemini (ahorro de costo).
- Sin `GEMINI_API_KEY` la ingesta funciona igual; `analysis.skipped_reason` lo explica.

### `GET /api/discover` — lectura filtrada en tiempo real (ControlBar)

Sin nueva ingesta. Query params = `TrendFilters`; los arrays van separados por coma.

```
GET /api/discover?networks=linkedin,tiktok&stages=emerging,peaking&formats=reel_pantalla_dividida_demo
                 &minJev=70&windowDays=7&search=agentes&sort=priority&limit=10&offset=0
→ 200 { "items": TrendSignal[], "total": 12, "repository": "sqlite" }
```

Parámetros con valores fuera del dominio (p. ej. `stages=viral`) → `400 INVALID_INPUT`.

### `POST /api/analyze-url` — Sensor de Comunidad 30X

```jsonc
// Request (UI o webhook externo: Slack Workflow, Make, Zapier…) — envía url O id
{ "url": "https://www.linkedin.com/posts/…", "text": "Texto del post tal como lo viste (opcional, ≤ 8 000)", "force": false }
// Re-análisis de una señal ya guardada (botón "Analizar con IA"): leer la URL es opcional
{ "id": "uuid", "force": true }
// Response 200
{
  "item": TrendSignal,             // con analysis si hay GEMINI_API_KEY
  "providers": ["search_index","community_text"],   // youtube_api | oembed | search_index | jina | community_text
  "warnings": [],
  "cached": false                  // true si ya estaba analizada y no se pidió force
}
```

- En LinkedIn, Instagram y TikTok **no se descarga la página**: se usa oEmbed oficial, el índice de búsqueda y `text`. Si ninguno aporta contenido → `502` con la sugerencia de pegar el texto.
- La etapa de una pieza aislada es **provisional** (`stage_evidence.cohort_size = 1`).
- Con `id`, si la URL no se puede leer (p. ej. LinkedIn no indexado) se analiza con el extracto indexado y se avisa en `warnings`. `404` si el id no existe; `400` si se envían `url` e `id` a la vez.
- **Autenticación de webhooks:** si `INGEST_WEBHOOK_SECRET` está definida, las llamadas que no vienen del mismo origen deben enviar `Authorization: Bearer <secreto>`; si no → `401`.
- `400` URL inválida o privada · `502` no se pudo leer la URL pública.

### `POST /api/export-30x` — Plug & Play

```jsonc
// Request
{
  "id": "uuid",
  "targets": ["slack", "notion", "make"],
  "overrides": {                                    // opcional (PlugAndPlayConfig, Fase 4)
    "slackWebhookUrl": "https://hooks.slack.com/services/…",
    "makeWebhookUrl": "https://hook.us1.make.com/…",
    "notionApiKey": "ntn_…", "notionDatabaseId": "…"
  }
}
// Response 200 (también si algún destino falla: el detalle va por destino)
{
  "results": [
    { "target": "slack",  "status": "ok" },
    { "target": "notion", "status": "ok", "url": "https://www.notion.so/…" },
    { "target": "make",   "status": "disabled", "message": "Falta MAKE_WEBHOOK_URL" }
  ]
}
```

- Las URLs de override solo se aceptan en dominios oficiales (`hooks.slack.com`, `hook.*.make.com`) para evitar SSRF.
- `404` si el `id` no existe.

**Payload Slack** (Incoming Webhook, Block Kit): título enlazado, red · etapa · JEV · outlier, las 5 variables en una línea cada una, gancho del Reel y título del carrusel.

**Payload Notion** (`POST /v1/pages`): el conector **lee el esquema de la base** y solo llena las propiedades que existen con el tipo correcto. Nombres reconocidos (insensible a mayúsculas/acentos): título → propiedad `title` de la base; `Red` (select), `Etapa` (select), `Formato` (select), `JEV` (number), `Outlier` (number), `URL` (url), `Publicado` (date). Cuerpo: autopsia 5D, desglose JEV, guion del Reel y slides del carrusel.

**Payload Make** (webhook genérico): `{ "event": "trend.exported", "sent_at": ISO, "signal": TrendSignal }`.

### `POST /api/radar` — ejecutar el Radar semanal

```jsonc
// Request
{ "networks": ["linkedin", "youtube", "instagram", "tiktok"], "maxTopics": 10 }
// Response 200
{
  "run": {
    "id": "uuid", "created_at": ISO, "networks": [...], "seeds": ["agentes de IA para empresas", "AI agents for business", …],
    "signals_found": 143, "sources": SourceReport[], "notes": [], "took_ms": 84210
  },
  "topics": RadarTopic[]           // ordenados por score, máx. maxTopics
}
// 503 NO_SOURCES si ninguna fuente está configurada · 503 MISSING_CREDENTIAL si falta GEMINI_API_KEY (agrupar temas requiere IA)
```

`RadarTopic`:
```jsonc
{
  "rank": 1,
  "label": "Agentes de IA en ventas B2B",
  "thesis": "Equipos comerciales que delegan la prospección a agentes",
  "this_week": 8, "last_week": 2,
  "growth_index": 98, "volume_index": 80, "score": 88.4,
  "stage": "emerging", "stage_evidence": StageEvidence,
  "jev_score": 84,
  "networks": ["linkedin", "youtube"],
  "representative": TrendSignal,   // con analysis: las 5 variables, JEV y guiones
  "member_ids": ["uuid", …]
}
```

### `GET /api/radar` — último radar guardado

`?run=<uuid>` devuelve una corrida concreta; sin parámetros, la más reciente. Misma forma que la respuesta de `POST`. `404` si no hay ninguna.

### `GET /api/status` — qué está configurado

```jsonc
{
  "repository": "sqlite",
  "sources": { "youtube_api": false, "tavily": false, "google_cse": false, "jina_key": false, "meta_oembed": false },
  "ai": { "gemini": false, "model": "gemini-3.8-flash", "jev_threshold": 55 },
  "exports": { "slack": false, "notion": false, "make": false },
  "webhook_secret": true
}
```
Solo booleanos: nunca devuelve valores de claves.

### `GET | PUT /api/brand-dna` — ADN de marca editable

```jsonc
// GET → 200
{ "content": "# ADN de Marca 30X…", "updated_at": ISO, "editable": true }
// PUT { "content": "…" }  (200-40 000 caracteres) → 200 { "updated_at": ISO }
// 409 READ_ONLY si el sistema de archivos no permite escribir · 401 si viene de otro origen sin secreto
```

---

## 4. Errores normalizados

| Clase | Cuándo | HTTP sugerido |
|---|---|---|
| `MissingCredentialError` | Falta la variable de entorno de una fuente o de Gemini | 503 si es la única fuente; si no, `SourceReport.status = "disabled"` |
| `SourceError` | La API externa respondió error / timeout | 502 o `SourceReport.status = "error"` |
| `InvalidInputError` | URL no pública, ventana fuera de rango, consulta vacía | 400 |
| `AiOutputError` | Gemini devolvió JSON que no cumple el esquema tras 1 reintento | `analysis_status = "failed"` |
| `NotFoundError` | El `id` pedido no existe | 404 |
| `UnauthorizedError` | Webhook externo sin el secreto correcto | 401 |

Códigos de error en la respuesta: `READ_ONLY`, `INVALID_INPUT`, `NOT_FOUND`, `UNAUTHORIZED`, `MISSING_CREDENTIAL`, `NO_SOURCES`, `SOURCE_ERROR`, `AI_OUTPUT_ERROR`, `INTERNAL`.
