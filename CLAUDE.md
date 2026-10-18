# AGENT.md / CLAUDE.md — Especificación Maestra del Proyecto: 30X Trend Intelligence Engine

## 1. Contexto y Objetivo del Sistema

Estás construyendo una plataforma de inteligencia editorial en tiempo real y "Plug & Play" para el equipo de Media de **30X** (educación y contenido sobre IA para líderes, fundadores y equipos en Latinoamérica).

- **Problema a resolver:** Descubrir en tiempo real qué temas y formatos están despegando en **LinkedIn, Instagram, TikTok y YouTube**, explicar científicamente por qué funcionan, filtrar si le sirven a ejecutivos de Latinoamérica y adaptarlos al ADN de `@30x` y `@andresbilbao`.

- **Propuesta de valor (Regla de Oro):** Vender el resultado final ("El Hueco"), no un dashboard vacío ("El Taladro"). Reducir el tiempo de espera y el esfuerzo del equipo de contenido a cero.

## 2. Restricciones Estrictas (Inquebrantables)

1. **PROHIBIDO EL CONTENIDO ESTÁTICO / HARDCODED:** No crees mocks fijos como solución final. Todo tema debe provenir de consultas reales a APIs públicas, ser almacenado en base de datos y poder filtrarse dinámicamente por red, ventana de tiempo, etapa de tendencia, formato y score.

2. **CUMPLIMIENTO LEGAL 100% (ToS Compliant):**

   - **Entra:** Contenido público en redes mediante APIs oficiales, índices de búsqueda públicos (SERP para agentes), protocolos `oEmbed` y enlaces públicos enviados por la comunidad de 30X ("Comunidad como Sensor").

   - **No entra:** Datos privados, credenciales/logins de terceros, ni scrapers piratas que violen los Términos de Servicio de Meta, LinkedIn o TikTok.

3. **CERO SOBRE-INGENIERÍA VISUAL:** Prioriza velocidad de respuesta, filtros funcionales en tiempo real y exportación en 1 clic hacia el ecosistema de 30X (Slack / Notion / Make Webhooks).

## 3. Stack Tecnológico Obligatorio

- **Framework:** Next.js 14+ (App Router) con TypeScript estricto.

- **Estilos:** TailwindCSS + Lucide Icons. Paleta oficial 30X: Crema (`#F7F4EF`), Beige (`#EFECE6`), Dorado (`#E5A93C`), Negro Carbón (`#18181B`).

- **Base de Datos y Filtros:** Supabase (PostgreSQL) — o SQLite local con Prisma/Drizzle como fallback automático si aún no se han configurado las credenciales de Supabase para que nunca falle en local.

- **Fuentes de Datos (APIs):**

  1. `YouTube Data API v3`: Para detectar videos largos y YouTube Shorts en ascenso y calcular el `Outlier Score` real (`views / channel_subscribers_or_avg`).

  2. `Tavily Search API` / `Google Custom Search`: Para descubrir publicaciones públicas indexadas en `linkedin.com/posts`, `instagram.com/reel` y `tiktok.com` por fecha y palabra clave sin violar ToS.

  3. `Jina Reader API (r.jina.ai)` + `oEmbed`: Para el módulo "Sensor de Comunidad 30X", permitiendo analizar en vivo cualquier URL pública que el equipo pegue o envíe por webhook.

- **Motor de IA:** Google Gemini API (`@google/genai`, modelo `gemini-2.5-flash` — retirado para cuentas nuevas en 2026, se usa `gemini-3.8-flash`; ver `docs/ARCHITECTURE.md` ADR 9) usando exclusivamente **Structured Outputs (`responseSchema`)**.

## 4. Lógica de Negocio que el Agente DEBE Implementar

Cada pieza o tendencia procesada por el backend debe responder obligatoriamente a las 3 preguntas del reto:

### A. Detección Temprana y Etapa de la Tendencia

- Calcular el **Outlier Score**: Diferenciar si una pieza tuvo éxito por la fama masiva del autor o porque el tema/gancho multiplicó por $N$ veces el rendimiento promedio del canal.

- Clasificar el estado de saturación en:

  - `emerging` (🌱 Recién empieza: alta aceleración en fuentes tempranas/inglés, casi nula presencia en español).

  - `peaking` (🚀 Despegando: momento ideal para publicar en 30X).

  - `saturated` (🔥 Ya todos lo copiaron: descartar o exigir un ángulo contrarian).

### B. Autopsia Forense de las 5 Variables ("¿Por qué funcionó?")

El esquema de datos y la UI deben desglosar explícitamente estas 5 variables para cada pieza referente:

1. `hook_analysis` (**El Gancho**): Qué dijo o mostró en los primeros 3 segundos / primera línea.

2. `format_type` (**El Formato**): Ej. Carrusel comparativo, Reel pantalla dividida con demo, Talking head con subtítulos dinámicos, Post de texto estructurado.

3. `topic_angle` (**El Tema**): La tesis o dolor central que aborda.

4. `timing_reason` (**El Momento**): Por qué funcionó *esta semana* (coyuntura, lanzamiento, dolor operativo actual).

5. `author_vs_content` (**Quién la publicó**): Evaluación objetiva del peso del autor frente al mérito propio de la pieza.

### C. Filtro JEV (Audiencia LatAm) + Adaptación ADN 30X

- **Matriz JEV (`jev_latam_score` 0-100):** Evaluar relevancia para *ejecutivos, líderes y equipos de Latinoamérica aprendiendo IA* bajo 3 criterios: Impacto en negocio/ROI, Aplicabilidad práctica sin requerir un equipo de 20 ingenieros, y Claridad ejecutiva.

- **Adaptación Automática a Referentes (`docs/30X_BRAND_DNA.md`):**

  - Generar propuesta para el Instagram/TikTok de **Andrés Bilbao (`@andresbilbao`)**: Guion de Reel directo, pragmático, enfocado en liderazgo y mentalidad de empresas *AI-Native*.

  - Generar propuesta para el Instagram/LinkedIn de **30X (`@30x`)**: Estructura de carrusel táctico o guía accionable para equipos.

## 5. Reglas de Documentación Continua (OBLIGATORIO PARA CLAUDE CODE)

Tienes la obligación estricta de mantener la documentación del repositorio actualizada en cada iteración:

1. Antes de escribir código de un módulo nuevo, crea o actualiza el contrato en `docs/API_CONTRACTS.md` y la arquitectura en `docs/ARCHITECTURE.md` (incluyendo diagramas Mermaid).

2. Cada vez que completes una funcionalidad o endpoint, registra el cambio en `docs/CHANGELOG.md`.

3. Mantén el archivo `README.md` en la raíz impecable, explicando:

   - El problema y la ecuación de valor aplicada.

   - La arquitectura de datos abiertos y cumplimiento de ToS.

   - Los flujos de ingesta, el cálculo de Outliers, el modelo JEV y los Webhooks Plug & Play para Slack/Notion de 30X.

   - Instrucciones paso a paso para levantar el entorno en 2 minutos.

## 6. Plan de Ejecución Paso a Paso (Orden de Construcción)

Cuando el usuario te pida iniciar, ejecuta en este orden:

- **Fase 1 (Cimientos y Docs):** Inicializa la estructura de carpetas, redacta `docs/30X_BRAND_DNA.md`, `docs/ARCHITECTURE.md`, `.env.example` y el esquema de base de datos.

- **Fase 2 (Motores de Ingesta y Cerebro JEV):** Construye los conectores de `src/lib/sources/` (YouTube API, Social SERP, Public URL Reader) y el analizador estructurado de Gemini en `src/lib/intelligence/`.

- **Fase 3 (API Routes y Plug & Play):** Implementa `/api/discover`, `/api/analyze-url` (Sensor de Comunidad) y `/api/export-30x` (Webhook a Slack/Notion).

- **Fase 4 (Interfaz Dinámica y Filtrable):** Construye la UI en `src/app/page.tsx` con buscador en vivo por nicho/red, barra de filtros multicriterio en tiempo real, tarjetas con las 5 variables del "por qué funcionó" y botones de envío directo al ecosistema de 30X.

- **Fase 5 (Auditoría y README):** Verifica que no existan errores de compilación y actualiza el `README.md` final para el jurado del hackathon.

## 7. Estado de Construcción (lo mantiene el agente)

- [x] Fase 1 — Cimientos y Docs
- [x] Fase 2 — Motores de Ingesta y Cerebro JEV
- [x] Fase 3 — API Routes y Plug & Play
- [x] Fase 4 — Interfaz Dinámica y Filtrable
- [x] Fase 5 — Auditoría y README final

Ver `docs/CHANGELOG.md` para el detalle de cada entrega.
