# ADN de Marca 30X — Reglas de estilo y Matriz JEV

> **Este archivo es configuración viva.** `src/lib/intelligence/bilbao-adapter.ts` y `jev-scorer.ts` lo leen en tiempo de ejecución y lo inyectan en el prompt de Gemini. Si el equipo de Media cambia una regla aquí, el siguiente guion ya sale con la regla nueva — sin desplegar código.
>
> Las reglas parten del brief del reto (§4.C de `CLAUDE.md`). Las marcadas con ✏️ son supuestos razonables que el equipo de 30X debe validar o corregir.

---

## 1. Audiencia objetivo (la "J-E-V")

**Ejecutivos, líderes y equipos de Latinoamérica que están aprendiendo a usar IA en su negocio.**

- Fundadores, C-levels, gerentes y líderes de área de empresas LatAm (pymes a corporativos).
- No son ingenieros de ML. Quieren saber **qué hacer el lunes** con su equipo actual.
- Hablan español neutro latinoamericano; leen inglés técnico, pero consumen en español.
- Dolor recurrente: "veo que todos hablan de IA y no sé por dónde empezar sin contratar un equipo de 20 personas".

---

## 2. Matriz JEV (`jev_latam_score`, 0-100)

Gemini puntúa cada criterio de 0 a 100 con su justificación. **El score final lo calcula el código** con estas ponderaciones:

| Criterio | Peso | Pregunta que responde | 90-100 | 0-30 |
|---|---|---|---|---|
| **Impacto en negocio / ROI** | **0.40** | ¿Mueve una métrica que le importa a un ejecutivo (ingresos, costos, tiempo, riesgo)? | Ahorro o ingreso cuantificable y cercano. | Curiosidad técnica sin impacto en la operación. |
| **Aplicabilidad práctica** | **0.35** | ¿Un equipo LatAm sin 20 ingenieros puede ejecutarlo esta semana? | Herramienta accesible, pasos claros, costo bajo, disponible en LatAm. | Requiere infraestructura propia, GPUs, datos que no tienen o herramientas no disponibles en la región. |
| **Claridad ejecutiva** | **0.25** | ¿Se entiende en 30 segundos sin jerga? | Idea única, ejemplo concreto, lenguaje de negocio. | Jerga de papers, múltiples ideas mezcladas, depende de contexto previo. |

```
jev_latam_score = round(0.40 · impacto + 0.35 · aplicabilidad + 0.25 · claridad)
```

**Banderas rojas** (el modelo las lista y restan credibilidad, no puntos automáticos):
- Promesas de ingreso pasivo / "hazte rico con IA".
- Herramientas bloqueadas o sin soporte en LatAm.
- Contenido que solo funciona en EE. UU. (regulación, pagos, mercado).
- Afirmaciones sin fuente verificable.

**Umbral de adaptación:** `JEV_ADAPT_THRESHOLD = 55`. Debajo de este score no se generan guiones (se ahorra costo de IA).

---

## 3. @andresbilbao — Instagram / TikTok (Reel)

**Voz:** fundador que ya construyó empresas grandes hablándole de tú a otro líder. Directo, pragmático, sin humo.

**Ejes temáticos:**
1. Liderazgo en la era de la IA: qué cambia en el rol del CEO / líder.
2. Mentalidad y empresas **AI-Native**: rediseñar procesos, no "agregar un chatbot".
3. Velocidad de ejecución: probar esta semana, medir, decidir.

**Reglas de guion:**
- **Gancho en ≤ 3 s / ≤ 12 palabras**, en primera persona o como afirmación contundente. Nada de "Hola, hoy les voy a contar…".
- Una sola idea por Reel. Duración objetivo **30-60 s**.
- Estructura: **Gancho → Tensión (el error común) → Insight (lo que hacen las empresas AI-Native) → Acción concreta → CTA**.
- Ejemplos reales y cifras cuando existan en la fuente; **nunca inventar datos**. Si la fuente no trae cifra, se dice sin cifra.
- Lenguaje: español neutro LatAm, frases cortas, verbos de acción. Cero anglicismos innecesarios (✏️ se aceptan: *prompt*, *AI-Native*, *startup*).
- Texto en pantalla: máximo 6 palabras por bloque, refuerza la idea, no la repite.
- CTA de conversación ("¿Tu equipo ya hace esto? Cuéntame") o de guardado; ✏️ nunca venta directa en el Reel.

---

## 4. @30x — Instagram / LinkedIn (Carrusel táctico)

**Voz:** la escuela. Clara, estructurada, útil para que un equipo lo implemente.

**Reglas de carrusel:**
- **6-9 slides.** Slide 1 = promesa concreta ("5 automatizaciones que tu equipo de ventas puede montar hoy"). Última slide = CTA.
- Cada slide: **titular ≤ 8 palabras + cuerpo ≤ 30 palabras**.
- Formato preferido: paso a paso, comparativo (antes / después, manual / con IA), checklist o plantilla.
- Siempre al menos una slide con **herramienta o prompt concreto** que se pueda copiar.
- Caption para LinkedIn: 3-5 líneas, primera línea = gancho, cierre con pregunta. Máximo 3 hashtags (✏️ `#IA #Liderazgo #30X`).
- Paleta visual de referencia: Crema `#F7F4EF`, Beige `#EFECE6`, Dorado `#E5A93C`, Negro Carbón `#18181B`.

---

## 5. Reglas por etapa de tendencia

| Etapa | Instrucción al adaptador |
|---|---|
| 🌱 `emerging` | Ser los primeros en español: explicar qué es y por qué importa ahora. Ventana sugerida: publicar en ≤ 72 h. |
| 🚀 `peaking` | Momento ideal. Aportar el ángulo LatAm (caso local, herramienta disponible, costo en la región). |
| 🔥 `saturated` | **Obligatorio `contrarian_angle`**: qué está diciendo todo el mundo y por qué está incompleto o equivocado. Si no hay ángulo defendible, recomendar descartar. |

---

## 6. Prohibiciones de marca

- No copiar texto literal de la pieza referente: se adapta la **mecánica** (gancho, formato, tesis), no las palabras.
- No mencionar a la pieza o autor original en el guion salvo para citar un dato con fuente.
- No prometer resultados garantizados.
- No usar miedo ("la IA te va a reemplazar") como gancho principal; sí urgencia basada en oportunidad.

---

## 7. Semillas del Radar semanal

Consultas con las que el Radar barre las redes cada semana. Van en pares **español + inglés** para poder detectar temas que aceleran en inglés antes de llegar al español. Una semilla por línea; el equipo puede editarlas (✏️ propuesta inicial).

- agentes de IA para empresas
- AI agents for business
- IA generativa en ventas y marketing
- generative AI for sales and marketing
- liderazgo y adopción de IA en equipos
- AI adoption leadership teams
- automatización con IA para pymes
- AI automation for small business
