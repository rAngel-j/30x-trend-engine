# Changelog

Registro de lo construido en cada fase. Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [1.4.0] — 2026-10-17 · Primera prueba con claves reales

Primera corrida real con YouTube y Gemini. Destapó problemas que las pruebas sin claves no podían ver; todos corregidos y re-verificados en real.

### Corregido
- **Modelo:** `gemini-2.5-flash` ya no está disponible para cuentas nuevas (404 al generar). Pasa a `gemini-3.8-flash`, verificado con Structured Outputs. Desvío de la especificación documentado (ADR 9).
- **Cuota de Gemini:** el plan gratuito de `gemini-3.8-flash` permite 20 solicitudes al día y el radar necesitaba ~30. Nuevo **análisis en lote** (`batch-analyzer.ts`): autopsia + JEV de todas las piezas en 1 solicitud y guiones en otra. Radar: 3 solicitudes; búsqueda: 3; Sensor: 2.
- **Reintentos:** también ante 503 "alta demanda"; la cuota diaria agotada se detecta por el tiempo de espera ("retry in 19h…") y se responde de inmediato con el tiempo de renovación.
- **Errores de Gemini** llegan con su mensaje (502) en vez de "Error interno".
- **Diagnóstico:** `npm run doctor` comprueba que el modelo *genera*, no solo que existe (antes dio un falso OK).
- **Contrarian obligatorio por tema:** los guiones obedecen la etapa del tema, no la de la pieza, y se vuelve a analizar una pieza guardada si su análisis no cumple la regla de su tema.
- **Pieza representativa:** combina alcance y rendimiento relativo (`log10(vistas) + log2(outlier)`). Antes ganaba un video de 653 vistas ×4; ahora gana uno de 167 mil vistas ×10.
- **Etapa coherente en la interfaz:** dentro de un tema solo se muestra la etapa del tema.
- `npm run smoke` / `check` ya no gastan cuota: las llamadas reales solo corren con `SMOKE_LIVE=1`.

### Verificado con datos reales
- 3 corridas del radar (solo YouTube): 96 piezas, 8 semillas, 9-10 temas en ~2-3 min; 816 unidades de YouTube por corrida.
- Última corrida: todos los temas analizados; el saturado con JEV ≥ 55 trae ángulo contrarian y el saturado con JEV 48 queda sin guiones, como manda el ADN.
- Salida sin campos de identidad ni handles.

## [1.3.0] — 2026-10-17 · Radar semanal y cero datos personales

Alineación con el planteamiento del reto: el entregable pide **temas** que crecen **esta semana** (no piezas sueltas) y la restricción 08 exige **nada de datos personales**.

### Añadido
- **Radar semanal** (`POST | GET /api/radar`, `src/lib/radar.ts`): barre las semillas del ADN (ES + EN) con ventana de 14 días, agrupa piezas en temas con Gemini (`topic-clusterer.ts`, una llamada), mide esta semana frente a la anterior en código (`topic-growth.ts`), analiza la pieza más representativa de cada tema y guarda el Top 10 en `radar_runs` + `radar_topics`.
- `RadarBoard`: primera pantalla de la app, "Los 10 temas de IA que más crecen esta semana", con filtro por etapa, motivo del crecimiento y la autopsia y los guiones de la pieza representativa.
- Semillas editables en `docs/30X_BRAND_DNA.md` §7.
- Migraciones `002_privacy.sql` y `003_radar.sql`; `src/lib/privacy.ts`.
- Reintento ante límites por minuto de Gemini (429), sin reintentar si se agotó la cuota diaria.

### Cambiado (privacidad)
- Ya no se guardan `author_name`, `author_handle`, `author_url`, `thumbnail_url`, el ID de canal ni el nombre de quien envía al Sensor. Las bases SQLite existentes se limpian al abrirse.
- Los títulos indexados pierden el prefijo con el nombre del autor y las menciones `@cuenta`.
- A Gemini no se le envían nombres y se le pide no nombrar personas.
- Tavily pasa a profundidad `basic` (solo snippets del índice, 1 crédito por búsqueda).

### Verificado
- Smoke test: crecimiento 8 vs. 2 → 97,5; limpieza de títulos; 8 semillas leídas del ADN; radar guardado y leído con su pieza representativa; base antigua sin columnas de identidad tras abrirse; radar sin Gemini → error claro.
- Migraciones 001 → 002 → 003 en PostgreSQL 17 (PGlite): idempotentes, sin identidad, CHECKs, cascada y `representative_id` → null.
- Navegador sobre base temporal con radar de muestra "[vista previa]" (borrada después): Top 10 como primera pantalla, tema expandido con su pieza, filtro por etapa, móvil a 375 px sin scroll horizontal; `POST /api/radar` sin fuentes → 503.

## [1.2.0] — 2026-10-17 · Auditoría de cumplimiento de reglas

Revisión de cada fuente contra la regla del reto: contenido público sí; datos privados, contenido tras login y técnicas que dependan de violar términos de servicio, no.

### Corregido
- **El Sensor ya no descarga páginas de LinkedIn, Instagram ni TikTok.** Antes las pedía a Jina Reader: es scraping tercerizado de redes cuyos términos lo prohíben. Ahora usa oEmbed oficial, lo que el índice de búsqueda tiene de esa URL exacta (`lookupIndexedUrl`) y el texto que la persona pega a mano. Jina queda solo para la web abierta.
- **Retención de 30 días de YouTube:** `purgeExpiredYouTube()` borra las señales de YouTube no refrescadas en 30 días; corre en cada `POST /api/discover` y `POST /api/analyze-url`.
- **Métricas derivadas y atribución:** la interfaz aclara que Outlier, velocidad, etapa y JEV son cálculos de 30X, y el pie de página atribuye los datos a YouTube con enlaces a sus Términos y a la Política de privacidad de Google.
- README: se retiró la afirmación no verificada de que Jina "respeta las reglas del sitio".

### Añadido
- Campo opcional "texto de la publicación" en el Sensor de Comunidad (`text` en `POST /api/analyze-url`).
- Sección "Cumplimiento de reglas" en `docs/ARCHITECTURE.md` con la tabla red por red.

### Verificado
- Smoke test: la purga borra solo datos de YouTube vencidos; un post de LinkedIn sin índice ni texto da error que pide el texto, y con texto se analiza sin usar Jina.

## [1.1.0] — 2026-10-17 · Puesta en marcha

### Añadido
- `npm run doctor` (`scripts/doctor.ts`): prueba cada credencial de `.env.local` contra el servicio real con la llamada más barata (Gemini `models.get`, YouTube 1 unidad, Tavily 1 crédito, `count` en Supabase, esquema de Notion; Slack y Make solo formato para no enviar mensajes). Nunca imprime claves y sale con código 1 si falta lo mínimo (Gemini + una fuente).
- README: guía paso a paso para obtener las claves gratuitas de Gemini, YouTube y Tavily.

### Cambiado
- `errorMessage()` extrae el mensaje legible cuando un SDK devuelve el cuerpo JSON del proveedor (p. ej. Gemini). Mejora los errores del diagnóstico y los `analysis_error` guardados.

### Verificado
- Sin claves: el diagnóstico lista lo que falta y qué desbloquea cada una. Con claves inválidas de prueba: Gemini y YouTube reportan el error real del proveedor y Slack rechaza una URL no oficial.

## [1.0.0] — 2026-10-17 · Fase 5: Auditoría y README final

### Corregido (hallazgos de la auditoría)
- **"Analizar con IA" fallaba en piezas de LinkedIn, Instagram y TikTok**: pasaba por la lectura de la URL y, sin Jina, respondía 502. `/api/analyze-url` acepta ahora `{ id }` y, si la URL no se puede leer, analiza con el extracto indexado y lo avisa.
- **Enlaces externos**: los resultados de índices SERP solo se aceptan con `https://` y la interfaz nunca renderiza un `href` que no sea http(s).
- **Cuota de la búsqueda bilingüe**: se limita a una variante extra en el otro idioma (antes podían ser dos y triplicar la cuota de YouTube y Tavily).
- `/api/discover` ya no llama a Gemini para traducir si ninguna fuente está configurada.
- Filtro de ventana en Supabase con valores entre comillas para PostgREST.
- Migración sin dependencia de `pgcrypto` (`gen_random_uuid()` es nativo desde PostgreSQL 13).

### Añadido
- `npm run check`: tipos + prueba de humo + build de producción.
- README final para el jurado: problema, ecuación de valor, recorrido, ToS, fórmulas, Plug & Play, verificación y límites.

### Verificado
- `tsc`, `npm run smoke`, `next build` y `npm audit` (0 vulnerabilidades).
- Migración aplicada en PostgreSQL 17 real (PGlite): idempotente, CHECKs, upsert que preserva análisis, búsqueda de texto, RLS e índices en uso.
- `/api/analyze-url` con `id` (200), `id` + `url` (400) e id inexistente (404); `/api/discover` sin fuentes responde 503 sin gastar IA.

## [0.4.0] — 2026-10-17 · Fase 4: Interfaz dinámica y filtrable

### Añadido
- `src/app/page.tsx`: buscador escrito como frase ("¿Qué está despegando sobre ___?") que lanza `POST /api/discover`, resumen de la corrida por fuente, ranking numerado Top 10 con "Ver 10 más", filtros sincronizados con la URL y estados vacíos que dicen qué hacer.
- `src/components/ControlBar.tsx`: filtros en vivo (red, etapa, ventana, JEV mínimo, outlier mínimo, formato, estado, orden, texto) con consulta debounced a `GET /api/discover`.
- `src/components/TrendCard.tsx`: fila de ranking con termómetro de etapa, JEV y multiplicador de Outlier; al expandir: evidencia de la etapa en lenguaje claro, las 5 variables, Matriz JEV con pesos, banderas rojas, guion del Reel por segundos y carrusel por slides (con copiar), ángulo contrarian, "Analizar con IA" y envío a Slack / Notion / Make.
- `src/components/CommunitySensor.tsx`: pegar un enlace + nombre opcional; la pieza aparece abierta en el ranking.
- `src/components/PlugAndPlayConfig.tsx`: estado de fuentes y destinos del servidor, webhooks propios guardados en el navegador y editor del ADN de marca.
- `GET /api/status` y `GET | PUT /api/brand-dna`; `src/lib/client/*` (cliente HTTP y etiquetas en español).
- Tipografía Archivo con eje de anchura, paleta 30X como tokens de Tailwind, foco visible y `prefers-reduced-motion`.

### Verificado
- `tsc`, `next build` y `npm run smoke` sin errores.
- Revisión en navegador sobre una base SQLite temporal (con una pieza real del Sensor y una de muestra marcada "[vista previa]", ambas borradas después): tarjeta expandida completa, pestañas de guiones, filtro de etapa con URL compartible, exportación sin destino con mensaje, diálogo de Conexiones, "Buscar ahora" sin claves con explicación por fuente, Sensor desde la UI y móvil a 375 px sin scroll horizontal.
- Guardado del ADN probado con el mismo contenido (archivo intacto) y rechazo de contenido inválido.
- **Pendiente con claves reales:** ver tarjetas con análisis generado por Gemini y resultados de ingesta reales.

## [0.3.0] — 2026-10-17 · Fase 3: API Routes y Plug & Play

### Añadido
- `POST /api/discover`: expansión bilingüe de la consulta (ES ⇄ EN con Gemini), ingesta de todas las variantes en una sola cohorte, persistencia, bitácora en `discovery_runs` y análisis del Top N pendiente por prioridad (concurrencia 3). `503 NO_SOURCES` si ninguna fuente tiene credenciales.
- `GET /api/discover`: lectura filtrada para la ControlBar (red, etapa, formato, idioma, estado, ventana, rango JEV, outlier mínimo, texto libre, orden, paginación) validada con Zod.
- `POST /api/analyze-url`: Sensor de Comunidad con caché (no re-analiza si ya está analizada salvo `force`), conserva la etapa real si la URL ya llegó por `/discover`, registra `submitted_by`, y secreto opcional `INGEST_WEBHOOK_SECRET` para webhooks externos.
- `POST /api/export-30x`: Slack (Block Kit), Notion (descubre el esquema de la base y llena solo propiedades compatibles) y Make (JSON completo), cada destino independiente. Overrides de webhooks restringidos a dominios oficiales.
- `src/lib/api.ts` (errores uniformes con `code` estable), `src/lib/pipeline.ts`, `src/lib/intelligence/query-expander.ts`, `src/lib/export/*`.
- `TrendRepository.getSignalByUrl()`.

### Cambiado
- `collectSignals()` acepta `queryVariants` y fusiona reportes de fuentes entre variantes.
- El Sensor no llama a Jina para YouTube cuando hay YouTube API (Jina anónimo bloquea youtube.com).
- `next.config.ts` incluye `docs/30X_BRAND_DNA.md` en el tracing de las rutas de IA.

### Verificado
- `tsc --noEmit` y `next build` sin errores ni avisos.
- Servidor de producción probado en vivo: GET vacío/filtrado (200), filtro inválido (400), body inválido (400), sin fuentes (503 con detalle), webhook sin secreto (401), mismo origen sin secreto (200), URL privada (400), URL pública con dedupe entre `youtube.com/watch` y `youtu.be` (mismo id), `submitted_by` preservado, export sin destinos (`disabled`), id inexistente (404), override a dominio no oficial (400), envío real a hooks.slack.com (Slack respondió `no_team` al webhook de prueba, confirma que el payload sale).
- **Pendiente con claves reales:** ingesta YouTube/Tavily, análisis Gemini de punta a punta, página creada en Notion y webhook de Make.

## [0.2.0] — 2026-10-17 · Fase 2: Motores de Ingesta y Cerebro JEV

### Añadido
- `src/lib/sources/youtube-outliers.ts`: YouTube Data API v3 (`search` → `videos` → `channels`). Outlier Score real (`views / promedio del canal`), velocidad (vistas/h), peso del autor (0-1), detección Short vs. largo, ratio vistas/suscriptores. Reporta la cuota consumida.
- `src/lib/sources/social-serp.ts`: descubrimiento en LinkedIn, Instagram y TikTok vía Tavily (principal) y Google Programmable Search (respaldo). Fecha de publicación decodificada del ID público de la URL, autor desde el path, engagement parseado del snippet indexado (`1,2 K reacciones`, `3.4M views`…).
- `src/lib/sources/public-reader.ts`: Sensor de Comunidad 30X. oEmbed (YouTube, TikTok, Instagram con token Meta) + Jina Reader + YouTube API para videos. Bloquea URLs privadas (anti-SSRF).
- `src/lib/sources/index.ts`: `collectSignals()` corre las fuentes en paralelo, deduplica por URL canónica y clasifica la cohorte; cada fuente reporta `ok` / `disabled` / `error` sin tumbar la búsqueda.
- `src/lib/intelligence/trend-stage.ts`: detección de idioma por stopwords, etapa `emerging` / `peaking` / `saturated` con evidencia auditable, y fórmula de prioridad del Top 10.
- `src/lib/intelligence/gemini-client.ts`: cliente único de `gemini-2.5-flash` con `responseSchema` + validación Zod + 1 reintento; carga en caliente de `docs/30X_BRAND_DNA.md`.
- `src/lib/intelligence/forensic-5d.ts`: autopsia de las 5 variables. El veredicto autor-vs-contenido se fija de forma determinista cuando hay `author_weight`.
- `src/lib/intelligence/jev-scorer.ts`: Matriz JEV; Gemini puntúa 3 criterios y el código pondera 0.40 / 0.35 / 0.25.
- `src/lib/intelligence/bilbao-adapter.ts`: Reel para @andresbilbao + carrusel para @30x; `contrarian_angle` obligatorio si la tendencia está saturada.
- `src/lib/intelligence/analyze.ts`: `enrichSignal()` = forense ∥ JEV → adaptación solo si JEV ≥ 55.
- `scripts/smoke.ts` (`npm run smoke`): verifica cálculos, filtros SQLite, degradación de fuentes sin clave, Sensor de Comunidad sobre URL real y error claro sin `GEMINI_API_KEY`.

### Verificado
- `tsc --noEmit` sin errores (TypeScript estricto + `noUncheckedIndexedAccess`).
- Smoke test OK sin credenciales: oEmbed de YouTube respondió en vivo; Jina anónimo bloqueó `youtube.com` (403) y el sensor degradó correctamente.
- **Pendiente con claves reales:** YouTube API, Tavily/CSE y Gemini (no hay `.env.local` todavía).

## [0.1.0] — 2026-10-17 · Fase 1: Cimientos y Docs

### Añadido
- Proyecto Next.js 16 (App Router) + TypeScript estricto + Tailwind 4 + Lucide, paleta 30X en `globals.css`.
- `CLAUDE.md` (versión limpia de `agent.md`) con estado de construcción por fase.
- `docs/ARCHITECTURE.md` (diagramas Mermaid, fórmulas, ADR), `docs/API_CONTRACTS.md`, `docs/30X_BRAND_DNA.md` (Matriz JEV + reglas de @andresbilbao y @30x).
- `src/types/trends.ts`: contratos estrictos compartidos.
- `supabase/migrations/001_trend_signals.sql`: `trend_signals` + `discovery_runs`, columna `tsvector`, un índice por cada filtro de la ControlBar, RLS activado.
- `src/lib/db/supabase.ts`: `TrendRepository` con Supabase o fallback automático a SQLite nativo (`node:sqlite`); upsert que nunca borra análisis previos; filtros por red, etapa, formato, idioma, estado, ventana, rango JEV, outlier mínimo y texto libre.
- `.env.example` con todas las variables (ninguna obligatoria para arrancar).
