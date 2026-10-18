# Guion de demo — Lunes AI

Demo de **5 minutos** pensada para los 5 criterios de evaluación del Hackathon 30X. Cada bloque dice qué mostrar, qué decir y qué criterio cubre. Las diapositivas que acompañan este guion están en [`docs/pitch/Lunes-AI-pitch.pptx`](pitch/Lunes-AI-pitch.pptx) (con notas del orador).

---

## Antes de la presentación (checklist)

| Cuándo | Qué hacer | Por qué |
|---|---|---|
| La víspera | `npm run doctor` | Confirma que Gemini, YouTube y Tavily responden (no muestra claves). |
| La mañana de la demo | `npm run demo:prepare` (y `-- --all` si quieres también las 4 redes) | Deja el radar de LinkedIn guardado: la demo abre con resultados al instante y no depende de la cuota ni de la latencia en vivo. |
| La mañana de la demo | No correr más pruebas con IA | El plan gratuito de Gemini permite 20 solicitudes al día; cada radar usa 3. |
| 10 min antes | `npm run build && npm start`, abrir http://localhost:3000 en **modo oscuro** | Producción es más rápido que desarrollo; el modo oscuro se ve mejor en proyector. |
| 10 min antes | Tener a mano un enlace de LinkedIn público con su texto copiado | Para mostrar el Sensor de Comunidad en vivo (2 solicitudes). |
| Si la URL es pública | Seguir [`docs/DEPLOY.md`](DEPLOY.md) y definir `DEMO_ACCESS_CODE` | Nadie puede gastar la cuota sin el código. Abrir la URL la víspera (Supabase gratis pausa proyectos inactivos). |

**Plan B:** si Gemini responde "alta demanda" o se agota la cuota, el radar precargado y sus guiones ya están guardados: la demo completa funciona sin llamar a la IA. Solo el Sensor en vivo la necesita.

---

## El guion (5 minutos)

### 0:00 — El problema (30 s) · *Impacto en el reto*

> "Hoy 30X paga miles de dólares al año en scraping que solo trae datos. No dice **por qué** algo funcionó, si es una tendencia que **empieza** o una que **todos copiaron**, ni si le sirve a **su audiencia**. Por eso construimos **Lunes AI**: responde las tres preguntas, con fuentes abiertas, y deja la semana de contenido resuelta antes del lunes."

### 0:30 — La respuesta al entregable (90 s) · *Impacto en el reto*

Pantalla principal: **"Los N temas que más crecen esta semana"**, perfil 30X, radar de LinkedIn ya cargado. El título muestra cuántos temas tienen evidencia suficiente (al menos 2 piezas en las dos semanas medidas): *"si solo 7 temas tienen evidencia, mostramos 7; no rellenamos para llegar a 10"*.

1. Señalar los tres pasos de "Cómo funciona": busca en vivo, explica por qué, adapta a tu marca.
2. Leer la nota de cobertura: *"LinkedIn: el índice llega hasta el 13 de octubre; esta semana se mide hasta esa fecha"*. **Esto es honestidad metodológica:** los buscadores tardan días en indexar LinkedIn, y medir contra "hoy" haría que todo pareciera caer.
3. Abrir el **tema #1** (ejemplo real de la corrida de preparación):
   - **Automatización operativa para pymes:** 5 piezas esta semana frente a 3 la anterior, 🚀 despegando, **JEV 90**.
   - **Por qué funcionó (5 variables):** gancho *"Where small businesses actually save time with AI (not the hype version)"*, mecanismo *desmitificación pragmática*, formato *post de texto estructurado*, mérito del contenido y no del autor.
   - **Cómo lo adaptamos:** Reel para @andresbilbao, *"La IA útil para pymes es aburrida, no futurista."*; carrusel para @30x, *"Automatización con IA para pymes sin humo"*. Ambos con guion completo para copiar.
4. Clic en **Enviar a Slack** (o Notion): "esto ya está en el flujo del equipo".

### 2:00 — Lo que lo hace distinto (60 s) · *Innovación*

- **La IA se usa con intención:** las cifras (crecimiento, Outlier, etapa, ponderación del JEV) las calcula el **código**, de forma reproducible. Gemini solo interpreta y redacta, siempre con salida estructurada validada. Abrir el **"?" del JEV** para mostrarlo.
- **Detección temprana real:** cada tema se busca en español **e inglés**. "Emergente" significa que acelera en inglés y casi no existe en español: la ventana para llegar primero.
- **Datos que nadie ve:** la fecha exacta de cada post de LinkedIn, TikTok e Instagram se **decodifica del ID público de la URL**, sin descargar la página.
- **Comunidad como sensor:** pegar un enlace que vio el equipo (con su texto) → autopsia y guiones en segundos.

### 3:00 — Funciona de verdad (45 s) · *Viabilidad técnica*

- Mostrar el **Sensor** en vivo con el enlace preparado.
- Mencionar las pruebas: `npm run check` corre TypeScript estricto, la prueba de humo (crecimiento, privacidad, perfiles, filtros, retención) y el build de producción. Las migraciones se validaron en **PostgreSQL 17 real**. Se probó con datos reales: **400+ piezas, 4 redes**.
- Resiliencia: si Gemini se satura, reintenta; si se agota la cuota, lo explica con la hora de renovación; si fallan los guiones, la autopsia se conserva.

### 3:45 — 30X puede adoptarlo mañana (45 s) · *Viabilidad de implementación*

- **Costo:** en el uso previsto (un radar semanal más el uso del equipo) cabe en los planes gratuitos: Gemini (3 solicitudes por radar), YouTube (~8 % de la cuota diaria por radar), Tavily (~8 créditos).
- **Legal:** solo APIs oficiales, índices de búsqueda, oEmbed y la comunidad. **Nunca** logins, cookies ni descarga de páginas de LinkedIn, Instagram o TikTok. **Nada de datos personales:** no se guardan nombres, handles, correos ni miniaturas.
- **Plug & Play:** Slack, Notion (lee la base y llena las columnas que existan) y Make. Supabase para la nube con un cambio de variables.
- **Cambiar de perfil** en la cabecera (por ejemplo, "Fintech Andina"): "hecho para 30X, útil para cualquier marca, medio o creador", como dice el planteamiento del reto.

### 4:30 — Cierre (30 s) · *Presentación*

> "No le entregamos a 30X un tablero para interpretar: le entregamos el lunes. Eso es Lunes AI. Qué tema crece, por qué funciona, si le sirve a su audiencia y el guion listo para grabar, en una pantalla y con fuentes legales."

---

## Preguntas probables del jurado

**¿Qué es el JEV?**
Un puntaje 0-100 de qué tanto le sirve una pieza a la audiencia del perfil. Pondera impacto en negocio (40 %), aplicabilidad sin un gran equipo técnico (35 %) y claridad (25 %). Gemini argumenta cada criterio y el código aplica los pesos, así que es auditable. Desde 55 se generan guiones. *Si 30X tiene su propia definición de las siglas JEV, se ajusta en el ADN del perfil sin tocar código.*

**¿Cómo saben que algo "empieza a crecer"?**
Dos señales medidas en código: (1) piezas de esta semana frente a la anterior en cada tema; (2) proporción en español frente a inglés y frescura de la cohorte. Emergente = acelera en inglés con casi nada en español.

**¿Esto viola los términos de LinkedIn o Meta?**
No. LinkedIn, Instagram y TikTok se consultan a través de índices de búsqueda (Tavily) y oEmbed oficial. No usamos cuentas, cookies ni descargamos páginas, ni directo ni a través de terceros: esto se auditó y se corrigió durante el desarrollo (está en `docs/ARCHITECTURE.md`, sección de cumplimiento).

**¿Y los datos personales?**
El motor analiza piezas, no personas. No se guardan nombres, handles, perfiles, miniaturas, correos ni teléfonos (se limpian de los textos). "Autor vs. contenido" se resuelve con cifras agregadas, sin identidad. Los datos de YouTube se borran a los 30 días, como piden sus políticas.

**¿Por qué no hay vistas de LinkedIn?**
Porque no se pueden obtener legalmente sin scraping. Preferimos dejarlas vacías antes que inventarlas; para esas redes la prioridad se apoya en JEV, etapa y recencia.

**¿Cuánto cuesta operarlo?**
En el uso previsto, cabe en los planes gratuitos. Si el uso crece, todo es pago por uso (sin licencias), muy lejos de los miles de dólares anuales del scraping actual.

**¿Por qué Gemini 3.8 Flash y no 2.5?**
2.5 Flash ya no está disponible para cuentas nuevas (lo detectamos en la primera prueba real). 3.8 Flash es el Flash vigente y se verificó con salida estructurada.

**¿Qué pasa si se cae una fuente?**
Cada fuente informa su estado (conectada, sin conectar o con error) y el resto sigue funcionando. `npm run doctor` diagnostica todo sin exponer claves.

**¿Cuáles son los límites?**
Los índices tardan días en cubrir LinkedIn (por eso anclamos la semana a su cobertura); las redes cerradas no exponen alcance; el plan gratuito de Gemini limita a 20 solicitudes diarias (el análisis en lote lo hace suficiente). Está todo documentado, no escondido.
