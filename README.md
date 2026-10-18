# 30X Trend Intelligence Engine

**Qué está despegando hoy en LinkedIn, Instagram, TikTok y YouTube, por qué funcionó, si le sirve a un ejecutivo de Latinoamérica y el guion listo para grabar en @andresbilbao y @30x.**

Construido para el equipo de Media de **30X**, la escuela de IA para líderes, fundadores y equipos de Latinoamérica.

---

## El problema

El equipo de contenido de 30X compite por la atención de ejecutivos que ya ven demasiada IA en su feed. Hoy, para saber qué publicar, alguien revisa redes a mano, intuye qué está funcionando, adivina por qué y lo reescribe en la voz de la marca. Eso cuesta horas, llega tarde y depende del olfato de una persona.

## La ecuación de valor

| Palanca | Antes | Con el motor |
|---|---|---|
| **Resultado** | Ideas sueltas | Guion de Reel y carrusel listos, en el ADN de 30X |
| **Probabilidad de acierto** | Intuición | Outlier Score real, etapa de la tendencia y score JEV con evidencia |
| **Tiempo de espera** | Días revisando feeds | Una búsqueda en vivo |
| **Esfuerzo** | Investigar, analizar, redactar | Copiar o enviar a Slack / Notion en un clic |

Es **el hueco, no el taladro**: el equipo no recibe un dashboard para interpretar, recibe la respuesta a las tres preguntas del reto para cada pieza.

| Pregunta del reto | Qué entrega el motor |
|---|---|
| **¿Qué está despegando y en qué etapa?** | Outlier Score (cuántas veces superó el promedio de su propio canal), velocidad, peso del autor y etapa 🌱 emergente · 🚀 despegando · 🔥 saturada, con las cifras que la justifican. |
| **¿Por qué funcionó?** | Autopsia de 5 variables: **Gancho, Formato, Tema, Momento y Autor vs. contenido**. |
| **¿Le sirve a 30X y cómo lo adapto?** | Score JEV 0-100 para ejecutivos LatAm, Reel por segundos para @andresbilbao, carrusel por slides para @30x y ángulo contrarian obligatorio si el tema ya está saturado. |

---

## Recorrido de 2 minutos

1. **Busca un tema**: "¿Qué está despegando sobre *agentes de IA para ventas*?" en YouTube, LinkedIn, Instagram y TikTok, últimos 7 días.
2. El motor busca **en vivo y también en inglés**, guarda todo y analiza las 5 piezas con más potencial.
3. **Filtra** el ranking: solo 🌱 emergentes, JEV ≥ 70, outlier ×5+, formato carrusel. La URL guarda los filtros para compartir la vista.
4. **Abre una pieza**: por qué está en esa etapa, las 5 variables, la Matriz JEV con sus pesos y el guion listo para copiar.
5. **Envíala** a Slack, Notion o Make con un clic.
6. ¿Alguien del equipo vio algo funcionando? Lo pega en el **Sensor de Comunidad** y recibe la misma autopsia.

---

## Datos abiertos y cumplimiento de ToS

| Fuente | Para qué | Por qué es legal |
|---|---|---|
| **YouTube Data API v3** | Vistas, suscriptores y promedio del canal → Outlier Score | API oficial con clave propia |
| **Tavily** (Google Programmable Search como respaldo) | Publicaciones públicas indexadas de LinkedIn, Instagram y TikTok | Índices de búsqueda públicos: nunca se visita la red social |
| **oEmbed** (YouTube, TikTok, Instagram) | Metadatos de los enlaces que pega el equipo | Protocolo oficial de embebido |
| **Jina Reader** | Texto de artículos de la **web abierta** (blogs, medios, documentación) | Solo sitios públicos sin restricción. **Nunca** se usa sobre LinkedIn, Instagram ni TikTok |
| **Comunidad 30X** | Enlace + texto de la publicación que la persona vio y pega a mano | Es un humano compartiendo contenido público, no un robot |
| **Google Gemini 2.5 Flash** | Autopsia, JEV y guiones | Solo Structured Outputs validados |

**Nunca se usan** logins, cookies, cuentas de terceros, datos privados ni descargas de páginas de LinkedIn, Instagram o TikTok, ni directas ni a través de lectores o proxies de terceros: que lo haga otro servicio no lo vuelve legítimo. Cuando una red no expone una métrica de forma legal, el motor la deja vacía en lugar de inventarla.

**Políticas de YouTube API:** los datos de YouTube se borran si no se refrescan en 30 días, la interfaz atribuye los datos a YouTube y enlaza sus Términos y la Política de privacidad de Google, y las métricas propias (Outlier, velocidad, etapa, JEV) se presentan como cálculos de 30X, no como métricas de YouTube.

La auditoría completa, red por red, está en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (sección "Cumplimiento de reglas") y se verifica en cada `npm run smoke`.

---

## Cómo funciona

```mermaid
flowchart LR
    Q["Tema + redes + ventana"] --> X["Traducción ES ⇄ EN<br/>(Gemini)"]
    X --> YT["YouTube API<br/>Outlier Score"] & SERP["Índices públicos<br/>LinkedIn · IG · TikTok"]
    URL["Enlace + texto de la comunidad 30X"] --> PR["oEmbed + índice de búsqueda<br/>(Jina solo web abierta)"]
    YT & SERP --> ST["Etapa de la cohorte<br/>idioma + frescura + outlier"]
    ST & PR --> DB[("Supabase<br/>o SQLite local")]
    DB --> AI["Autopsia 5D ∥ Matriz JEV<br/>→ Guiones ADN si JEV ≥ 55"]
    AI --> DB --> UI["Ranking filtrable"] --> OUT["Slack · Notion · Make"]
```

### Las métricas se calculan, no se adivinan

Gemini interpreta y redacta. Todo lo que es número lo calcula el código, de forma reproducible:

**Outlier Score (YouTube)**
```
outlier       = vistas del video / (vistas totales del canal / videos del canal)
author_weight = 1 − log10(outlier) / log10(50)        acotado a [0, 1]
```
×1 significa que el video rindió lo que el canal rinde siempre: lo explica la audiencia del autor. ×50 o más significa que el tema o el gancho multiplicó el rendimiento: el mérito es de la pieza. Ese mismo dato fija el veredicto "Autor vs. contenido" de la autopsia.

**Fecha de publicación en LinkedIn, TikTok e Instagram**: se decodifica del ID público de la URL (los IDs de estas redes llevan la hora de creación), así que es exacta aunque el buscador no la indexe.

**Etapa de la tendencia**: se mide sobre todas las piezas de la búsqueda, no sobre una sola.

| Etapa | Regla |
|---|---|
| 🌱 Emergente | Menos del 15 % en español y aceleración (≥ 40 % publicado en 72 h u outlier mediano ≥ ×3) |
| 🔥 Saturada | 40 % o más en español y volumen alto (≥ 15 piezas) o ya sin frescura |
| 🚀 Despegando | Todo lo demás: hay tracción y todavía hay hueco en español |

**Matriz JEV**: Gemini puntúa tres criterios y el código aplica los pesos.
```
JEV = 0.40 · impacto en negocio + 0.35 · aplicabilidad sin un equipo de 20 ingenieros + 0.25 · claridad ejecutiva
```

**Prioridad del Top 10**: `0.5 · JEV + 0.3 · outlier normalizado + 0.2 · peso de la etapa` (despegando 100, emergente 80, saturada 30).

### El ADN de marca es configuración, no código

Las reglas de voz de @andresbilbao, el formato de carrusel de @30x y la Matriz JEV viven en [`docs/30X_BRAND_DNA.md`](docs/30X_BRAND_DNA.md). El motor lo lee en cada análisis y el equipo puede editarlo desde **Conexiones** en la interfaz. El siguiente guion ya sale con la regla nueva.

---

## Plug & Play con el ecosistema 30X

| Destino | Qué llega | Configuración |
|---|---|---|
| **Slack** | Mensaje con etapa, JEV, outlier, las 5 variables, gancho del Reel y botón a la pieza | Incoming Webhook en `SLACK_WEBHOOK_URL` |
| **Notion** | Página en la base de contenidos con la autopsia, el desglose JEV y los dos guiones | `NOTION_API_KEY` + `NOTION_DATABASE_ID`. No hay que renombrar columnas: el conector lee la base y llena `Red`, `Etapa`, `Formato`, `JEV`, `Outlier`, `URL` y `Publicado` si existen |
| **Make / Zapier** | La tendencia completa en JSON | `MAKE_WEBHOOK_URL` |
| **Entrada desde Slack o Make** | Cualquier enlace que el equipo comparta | Webhook a `POST /api/analyze-url` con `Authorization: Bearer $INGEST_WEBHOOK_SECRET` |

Cada persona también puede pegar sus propios webhooks en **Conexiones**: se guardan solo en su navegador y, por seguridad, solo se aceptan dominios oficiales de Slack y Make.

---

## Levantar el entorno en 2 minutos

Requisitos: **Node.js 22.13 o superior**.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Completa en `.env.local` las claves que tengas. **Ninguna es obligatoria para arrancar**: cada fuente sin clave se desactiva y la interfaz dice cuál falta.

| Variable | Desbloquea | Dónde se obtiene |
|---|---|---|
| `GEMINI_API_KEY` | Autopsia, JEV, guiones y búsqueda bilingüe | aistudio.google.com |
| `YOUTUBE_API_KEY` | Outliers de YouTube | Google Cloud Console → YouTube Data API v3 |
| `TAVILY_API_KEY` | LinkedIn, Instagram y TikTok | app.tavily.com |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Base en la nube (si faltan, SQLite local en `.data/`) | supabase.com |

**Para operar con datos reales lo mínimo es Gemini + YouTube o Tavily.** Las tres tienen plan gratuito:

1. **Gemini**: entra a aistudio.google.com con tu cuenta de Google → *Get API key* → pégala en `GEMINI_API_KEY`.
2. **YouTube**: en console.cloud.google.com crea un proyecto → *APIs y servicios* → habilita **YouTube Data API v3** → *Credenciales* → *Crear clave de API* → `YOUTUBE_API_KEY` (10.000 unidades diarias gratis, unas 95 búsquedas).
3. **Tavily**: crea tu cuenta en app.tavily.com y copia la clave del panel → `TAVILY_API_KEY`.

Las claves van **solo** en `.env.local`, que git ignora. Comprueba que funcionan sin abrir la app:

```bash
npm run doctor
```

El diagnóstico prueba cada clave contra el servicio real con la llamada más barata posible y te dice cuál falta o qué error devolvió el proveedor, sin mostrar nunca las claves.

Si usas Supabase, aplica la migración [`supabase/migrations/001_trend_signals.sql`](supabase/migrations/001_trend_signals.sql) desde el SQL Editor o con `supabase db push`.

```bash
npm run dev
```

Abre http://localhost:3000.

Para verificar todo de una vez (tipos, prueba de humo y build de producción):

```bash
npm run check
```

---

## API

| Endpoint | Para qué |
|---|---|
| `POST /api/discover` | Busca en vivo (con variante en el otro idioma), guarda y analiza el Top N |
| `GET /api/discover` | Filtra lo guardado: red, etapa, formato, idioma, estado, ventana, JEV, outlier, texto y orden |
| `POST /api/analyze-url` | Sensor de Comunidad (`url`) o re-análisis de una pieza guardada (`id`) |
| `POST /api/export-30x` | Envía una tendencia a Slack, Notion y/o Make |
| `GET /api/status` | Qué fuentes y destinos están conectados (sin exponer claves) |
| `GET \| PUT /api/brand-dna` | Lee y edita el ADN de marca |

```bash
curl -X POST http://localhost:3000/api/discover -H "Content-Type: application/json" -d '{"query":"agentes de IA para ventas","networks":["youtube","linkedin"],"windowDays":7}'
```

Contratos completos, ejemplos de respuesta y códigos de error: [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md).

---

## Calidad y verificación

| Qué | Resultado |
|---|---|
| TypeScript estricto (`strict` + `noUncheckedIndexedAccess`) | Sin errores |
| `next build` de producción | Sin errores ni avisos |
| `npm audit` | 0 vulnerabilidades |
| Prueba de humo (`npm run smoke`) | Fórmulas, fechas desde IDs, etapas, filtros SQLite, payloads de Slack y Notion, anti-SSRF y degradación sin claves |
| Migración SQL | Aplicada en PostgreSQL 17 real (PGlite): idempotente, CHECKs, upsert que preserva análisis, búsqueda de texto y uso de índices |
| Endpoints en vivo | Códigos 200 / 400 / 401 / 404 / 503 según contrato, deduplicación de URLs, webhook real a Slack |
| Interfaz | Revisada en navegador, de escritorio a 375 px sin scroll horizontal; foco visible y `prefers-reduced-motion` |

**Pendiente de validar con claves reales**: ingesta de YouTube y Tavily, análisis de Gemini de punta a punta y la creación de páginas en Notion. El código y los contratos están listos; solo falta conectar las credenciales.

### Límites conocidos (y cómo se manejan)

- LinkedIn, Instagram y TikTok no publican vistas por vías legales: para esas redes el outlier queda vacío y la prioridad se apoya en JEV, etapa y recencia.
- La etapa de un enlace suelto del Sensor es provisional, porque no hay otras piezas del mismo tema con las cuales compararlo.
- En LinkedIn, Instagram y TikTok el Sensor solo cuenta con oEmbed, lo que el buscador tenga indexado y el texto que pegue la persona. Si una publicación no está indexada, pegar su texto da el análisis más completo.
- No hay login de usuarios: se recomienda desplegar en red privada o detrás de la protección del hosting.

Detalle técnico y decisiones de diseño: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · Historial: [`docs/CHANGELOG.md`](docs/CHANGELOG.md).

---

## Estructura

```
src/
├── app/
│   ├── page.tsx                  Buscador, filtros y ranking
│   └── api/                      discover · analyze-url · export-30x · status · brand-dna
├── components/                   ControlBar · TrendCard · CommunitySensor · PlugAndPlayConfig
├── lib/
│   ├── sources/                  youtube-outliers · social-serp · public-reader
│   ├── intelligence/             trend-stage · forensic-5d · jev-scorer · bilbao-adapter · query-expander
│   ├── export/                   slack · notion · make
│   └── db/supabase.ts            Supabase o SQLite con la misma interfaz
└── types/trends.ts               Contratos estrictos
supabase/migrations/              Esquema Postgres con índices por filtro
docs/                             Arquitectura, contratos, ADN de marca y changelog
```

**Stack**: Next.js 16 (App Router) · TypeScript estricto · Tailwind CSS 4 · Lucide · Supabase / SQLite nativo · Google Gemini 2.5 Flash (`@google/genai`, Structured Outputs) · Zod.
