# Changelog

Registro de lo construido en cada fase. Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [1.7.0] — 2026-10-18 · Nuevo nombre: Lunes AI

### Cambiado
- El producto se llama **Lunes AI**, con el lema *"Tu semana de contenido, resuelta antes del lunes"*. Nace de la frase de cierre del pitch y deja claro el resultado (no la herramienta). Se presenta como *hecho para el equipo de Media de 30X*, sin usar la marca de 30X en el nombre, coherente con los perfiles de marca que lo hacen útil para cualquiera.
- Nombre nuevo en la cabecera, la pantalla de acceso, el título de la pestaña, el README, la guía de demo, la de publicación y los títulos de los documentos.
- Diapositivas regeneradas como `docs/pitch/Lunes-AI-pitch.pptx` (portada, pie y cierre con el nombre nuevo; notas del orador actualizadas).

## [1.6.2] — 2026-10-18 · Escrituras en Supabase y tiempos en Vercel

### Corregido
- **"[Supabase] invalid input syntax for type json" al actualizar el radar:** al recortar textos a veces se corta un emoji a la mitad; SQLite lo aceptaba, pero PostgREST lee el cuerpo como JSON de Postgres y lo rechaza (reproducido en PostgreSQL 17). Todo lo que se escribe en Supabase se limpia antes (mitades de emoji y carácter nulo).
- **Error 504 en el Sensor de Comunidad publicado:** `/api/analyze-url` y `/api/discover` pasan de 120 s a 300 s, como el radar; los reintentos ante "alta demanda" de Gemini no cabían en 120 s. Si el hosting corta por tiempo, la interfaz lo explica en lugar de mostrar "Error HTTP 504".

## [1.6.1] — 2026-10-18 · Radar en la nube

### Corregido
- **"Error interno" al actualizar el radar en la app publicada:** PostgREST recibe los filtros `in.(…)` en la URL y Supabase rechaza más de ~200 huellas (medido: 150 ✔, 250 ✖). Un radar de 4 redes junta 400+ piezas. Lecturas por huella o id y upserts van ahora en bloques de 100; el upsert deja una fila por huella. Verificado contra Supabase real con 600+ ids.
- Los errores de Supabase llegan a la interfaz con su motivo (502) en vez de "Error interno".

## [1.6.0] — 2026-10-18 · Publicar en una URL

### Añadido
- **Guía de publicación** `docs/DEPLOY.md`: Vercel (plan gratuito, despliegue en cada `git push`, funciones de 300 s) + Supabase, con variables, comprobación, cómo compartir, límites y problemas frecuentes.
- `supabase/setup.sql`: las migraciones 001-004 en un solo archivo idempotente para pegar en el SQL Editor. Validado dos veces seguidas en PostgreSQL 17 (PGlite).
- `npm run db:push`: copia la base local (perfiles, piezas, análisis, radares y vistas) a Supabase sin llamar a la IA, para publicar con el radar ya preparado. Probado con la base real (420 piezas, 9 radares, 81 temas) contra PostgreSQL 17.

### Cambiado
- En Vercel sin Supabase, el fallback SQLite usa `/tmp` para que la app arranque igual. `SQLITE_PATH` queda comentada en `.env.example`.

## [1.5.1] — 2026-10-18 · Pitch de 5 minutos

### Añadido
- **Diapositivas del pitch** en `docs/pitch/30X-Radar-pitch.pptx`: 8 diapositivas en modo oscuro con la paleta 30X, capturas reales de la app y notas del orador con tiempos. Siguen `docs/DEMO.md` y llevan marcado el criterio de evaluación que cubre cada una (impacto, innovación, viabilidad técnica, viabilidad de implementación).

### Corregido
- Doble punto en "Gancho" y "Formato" de la autopsia cuando la IA ya cerraba la frase.
- Cabecera de `docs/30X_BRAND_DNA.md`: el ADN ahora vive en el perfil y se edita desde la app.

## [1.5.0] — 2026-10-18 · Perfiles de marca, modo oscuro y preparación de la demo

### Añadido
- **Perfiles de marca** (`/api/profiles`, `ProfileManager`, migración `004_profiles.sql`): audiencia, temas de interés, voz personal, voz de marca, ADN y semillas por perfil. El perfil 30X se crea solo desde `docs/30X_BRAND_DNA.md` y adopta los análisis y radares anteriores. Cada análisis pertenece a su perfil: los filtros de IA (JEV, formato detallado, estado, orden por JEV) solo consideran los del perfil activo.
- **Vistas guardadas** (`/api/views`, `SavedViews`): combinaciones de filtros con nombre, por perfil y compartidas por el equipo.
- **Modo oscuro** con la paleta 30X, aplicado antes de pintar (sin destello claro) y recordado en el navegador.
- Ayuda contextual ("?") para JEV, Outlier, etapa y crecimiento; franja "Cómo funciona" en tres pasos; aviso de configuración solo cuando falta una clave.
- **Código de acceso para demos públicas** (`DEMO_ACCESS_CODE`, `src/proxy.ts`, `/acceso`, `/api/access`): cookie httpOnly con hash, comparación de tiempo constante, espera ante código incorrecto; los webhooks siguen entrando con su secreto.
- `npm run demo:prepare`: deja el radar de LinkedIn precargado. Guion de demo de 5 minutos y preguntas del jurado en `docs/DEMO.md`.
- Ícono propio de la app.

### Cambiado
- **Filtro de formato**: ahora usa el formato detectado al ingerir, que existe en todas las piezas (antes usaba el de la IA, presente solo en ~5 % de las piezas). El formato fino de la IA queda como filtro secundario, señalado como tal.
- Guiones genéricos `personal_reel` / `brand_carousel` con las voces del perfil; los análisis antiguos se leen con compatibilidad. Prompts de IA, agrupador de temas, exportaciones e interfaz sin "30X" fijo.
- Cabeceras de tarjetas como filas accesibles por teclado (`ToggleRow`), para poder contener botones de ayuda sin anidar botones.
- `/api/brand-dna` retirado: el ADN vive en cada perfil.
- README reorganizado alrededor de los 5 criterios de evaluación.

### Verificado
- `tsc`, `npm run smoke` (incluye creación del perfil 30X, adopción de análisis anteriores, aislamiento de JEV entre perfiles, vistas y guiones antiguos) y `next build`.
- Migraciones 001-004 en PostgreSQL 17 (PGlite): un solo perfil por defecto, CHECK del ADN, cascadas al borrar un perfil, índice perfil + JEV en uso.
- Navegador sobre una copia de los datos reales: claro y oscuro, tema expandido, ayuda contextual, creación de un perfil "Fintech Andina" desde la interfaz, radar vacío por perfil, vista guardada y filtros en la URL.
- Código de acceso: redirección a `/acceso`, 401 en la API, código incorrecto con espera, cookie httpOnly, webhook con su secreto.
- `npm run demo:prepare` real: radar de LinkedIn con 7 temas de 89 piezas en 143 s, 6 con guiones.

## [1.4.2] — 2026-10-18 · Radar de LinkedIn listo para la demo

### Corregido
- **Semana anclada a la cobertura del índice:** el índice de LinkedIn llegaba 5 días atrás y "esta semana" salía casi vacía, así que todo parecía decrecer o saturado. Cada red se mide ahora hasta la fecha más reciente que tiene indexada, y la interfaz lo indica.
- Los temas sin al menos 2 piezas dentro de las dos semanas medidas ya no entran al ranking.
- **Fallo de red al generar guiones:** antes descartaba también las autopsias ya hechas. Ahora la autopsia se guarda con `scripts_error`, la interfaz ofrece "Generar guiones de nuevo" y el siguiente radar los regenera.
- Los fallos de red transitorios ("fetch failed", conexión cortada) se reintentan como el 503.

### Verificado con datos reales
- Radar solo de LinkedIn (la pregunta del entregable): 113 piezas, 7 temas con evidencia, 7/7 autopsias, guiones en los 6 con JEV ≥ 55 y ángulo contrarian en todos los temas saturados con guiones. Sin correos ni campos de identidad en la salida.

## [1.4.1] — 2026-10-18 · Prueba real en 4 redes y privacidad reforzada

### Corregido
- **Privacidad:** las descripciones de YouTube y algunos snippets traían correos, teléfonos, enlaces a perfiles y menciones pegadas al texto (`texto@cuenta`). `scrubText` ahora los elimina en todas las fuentes, y la base SQLite existente se limpia al abrirse (verificado: 407 piezas sin restos).
- Títulos indexados que solo decían "Instagram" pasan a usar el texto de la pieza.
- `npm run doctor` distingue la cuota agotada de una clave inválida.

### Verificado con datos reales
- Radar en las 4 redes (YouTube + Tavily): 403 piezas (101 YouTube, 310 LinkedIn/Instagram/TikTok), fecha exacta en el 100 % de las piezas de redes cerradas, 10 temas multired con autopsia y guiones.
- Los índices de búsqueda no traen métricas de alcance de las redes cerradas (límite legal): con varias redes, la pieza representativa sale de YouTube, la única con evidencia de rendimiento.
- **Pendiente:** el radar solo de LinkedIn completo. La ingesta funciona, pero el análisis no se pudo terminar porque se agotaron las cuotas diarias gratuitas de Gemini y hubo un 503 temporal.

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
