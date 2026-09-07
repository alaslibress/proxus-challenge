# Post-mortem 01 — Fuga de sintaxis de tool call como texto

- **Fecha del incidente**: 2026-09-07
- **Detectado por**: usuario durante QA manual de PR-09 (subida de PDFs).
- **Severidad**: alta — el alumno ve tripas del sistema y el turno termina sin respuesta útil.
- **Estado**: causa confirmada · resuelto (PR-12 + PR-12.1)
- **PR**: PR-12 (`fix/fuga-tool-calls`) + PR-12.1 (`fix/fuga-tool-calls-reintento`)

---

## 1. Descripción del bug

El usuario subió un PDF y preguntó sobre él. El asistente hizo correctamente dos tool calls
(`load_skill` y `cli materials list`). En el tercer paso, en lugar de emitir una
`functionCall` estructurada, la burbuja de asistente mostró el texto literal:

```
Tool call default_api:load_skill{name:create-study-artifacts}
```

El turno terminó ahí. No se ejecutó ninguna tool, no se generó ningún artifact.

---

## 2. Impacto

- Un turno perdido por conversación que llegara a tres pasos de razonamiento consecutivos.
- El alumno ve sintaxis interna del sistema.
- El chat quedaba usable (no se rompía el stream); el usuario podía reintentar.

---

## 3. Cronología

| Momento | Hecho |
|---|---|
| 2026-09-07 | Usuario sube PDF y hace una pregunta que fuerza 3 pasos de razonamiento |
| 2026-09-07 | Bug reportado con captura de pantalla |
| 2026-09-07 | Diagnóstico completado; causa raíz identificada en `renderMessage` + `promptContents` |
| 2026-09-07 | PR-12 implementado: Fases 0, 2 y 3; documentación y post-mortem |

---

## 4. Evidencia recogida

La reproducción instrumentada (Fase 0, Paso 3) y los experimentos (Fase 1) requieren
entorno con API key y PDF. Los resultados de los experimentos se actualizarán tras QA manual.

| Paso | `finishReason` | ¿parte `functionCall`? | ¿parte `thought`? | Primeros 200 car. |
|---|---|---|---|---|
| 1 | no verificado | no verificado | no verificado | no verificado |
| 2 | no verificado | no verificado | no verificado | no verificado |
| 3 | no verificado | no verificado | no verificado | no verificado |

La causa raíz fue **confirmada** por el log de reproducción del 2026-09-07 22:29:

```
[22:29:04.648] INFO (#13): gemini.response {
  finishReason: 'MALFORMED_FUNCTION_CALL',
  totalTokens: 787,
  partCount: 2,
  functionCallParts: 0,
  thoughtParts: 0,
  textPreview: 'Tool call load_skill: {"name":"create-study-artifacts"}'
}
```

El `finishReason: 'MALFORMED_FUNCTION_CALL'` confirma que la API intentó serializar una
function call, no pudo, y devolvió el intento como texto — exactamente el formato que
produce `renderMessage` (`session.ts`). El modelo copió lo que vio en el historial.

El PR-12 añadió los logs pero no cerró el bug por dos razones (ver §7).

---

## 5. Hipótesis evaluadas

| Hipótesis | Veredicto | Evidencia que lo decide |
|---|---|---|
| Estrangulamiento por `maxSteps` | **Descartada** | El path de agotamiento (`session.ts:115-119`) produce un texto distinto; el bug ocurrió en el paso 3 con 5 de margen |
| Cierre prematuro del stream NDJSON | **Descartada** | El frame llegó completo y bien formado — `decodeUnknownSync` habría lanzado ante un frame truncado |
| Fallo silencioso de una tool previa | **Descartada** | El reporte confirma que `load_skill` y `cli materials list` devolvieron resultados; `cli` tiene `failureMode: "return"` |
| Envenenamiento del historial por `renderMessage` | **Confirmada** (log 2026-09-07 22:29 + `MALFORMED_FUNCTION_CALL`) | Ver §6 |

---

## 6. Causa raíz

**`harness/session.ts`, función `renderMessage` (líneas 167-171):**

```ts
case "tool-call":
  return {
    role: "assistant",
    content: `Tool call ${message.name}: ${JSON.stringify(message.input)}`
  };
```

Las tool calls anteriores se serializan como texto plano en el historial. En la petición
a Gemini (`gemini.ts:113-119`, `promptContents`), ese historial se reenvía como partes
`{ text: "Tool call load_skill: {...}" }` — no como partes nativas `functionCall`.

Gemini ve dos turnos consecutivos donde el rol `model` contiene una tool call escrita en
prosa. Eso es un patrón few-shot de manual. En el tercer paso el modelo reproduce el
patrón: escribe la siguiente tool call como texto, con el prefijo `default_api:` que es
la verbalización de Gemini para una función declarada. Como no hay parte `functionCall`
en la respuesta, `toResponseParts` devuelve ese texto como respuesta del asistente, y
`session.ts:103-111` cierra el turno.

---

## 7. Solución implementada

### PR-12 — Lo que arregló y lo que no cerró

**Arregla la causa raíz (parcialmente)**:

**`gemini.ts`, función `promptContents`** — reconoce los mensajes de historial que
`renderMessage` serializa como prosa y los traduce de vuelta a partes nativas de Gemini:

- Asistente con `^Tool call (\w+): (\{...\})$` → `{ role: "model", parts: [{ functionCall: { name, args } }] }`
- Usuario con `^Tool result (\w+)( failure)?: ` → `{ role: "user", parts: [{ functionResponse: { name, response: { result } } }] }`

Así el modelo ve su propio formato nativo en el historial, no prosa imitada.

**Nota de deuda**: las dos regex (`TOOL_CALL_RE`, `TOOL_RESULT_RE`) deben mantenerse en
sincronía con `renderMessage` en `harness/session.ts`. Se eliminarán cuando el PR-05
migre el contrato de frames.

**Fallo del PR-12 — dos bugs que impedían el cierre**:

1. El patrón de detección `buildLeakPattern` usaba `\bload_skill\b\s*[({]` — exigía `(` o `{` inmediatamente después del nombre. El texto real tiene `: ` entre el nombre y los args (`Tool call load_skill: {...}`), así que no casaba.
2. La corrección se emitía como texto en `responseParts` y llegaba al alumno en vez de llegar al modelo. El turno se cerraba sin retry porque no había tool results.

### PR-12.1 — Cierre definitivo

**Señal primaria: `MALFORMED_FUNCTION_CALL`** — dato determinista de la API que no requiere regex.

**Patrón corregido** — dos formas, ambas validadas contra 5 cadenas de prueba antes de commitear:

```
a) Tool call load_skill: {...}   → patrón a: (?:^|\n)\s*Tool call\s+(?:names)\s*:
b) default_api:load_skill{...}  → patrón b: (?:default_api[.:])?\\b(?:names)\\b\\s*[:(\\{]
```

**Reintento interno en el adaptador** — cuando se detecta un paso malformado:
1. Se hace UNA petición de reintento con el mismo body + turno correctivo al final de `contents`.
2. El mensaje correctivo llega al modelo, no al alumno.
3. Si el reintento se recupera: log `agent.tool_call_retry {outcome: "recovered"}`.
4. Si también falla: log `{outcome: "bailed"}` + frase legible para el usuario. Nunca el texto fugado.

**Skills y harness saneados** — se eliminó toda la sintaxis de llamada en prosa de las skills y del prompt del harness (era el tercer vector de few-shot training).

### Contiene el síntoma (red de seguridad, ambos PRs)

**`gemini.ts`, función `toResponseParts`** — detecta si el modelo escribe una tool call
como texto aunque no haya `functionCall` nativa:

```ts
const TOOL_CALL_LEAK_PATTERN = /(?:default_api[.:])\s*\b(load_skill|cli)\b\s*[({]/i
```

Si se detecta la fuga, se suprime el texto (el alumno no lo ve) y se devuelve una
corrección al modelo: *"Your previous turn wrote a tool call as plain text…"*. Se registra
un log `agent.tool_call_leak`.

**`academic-tutor.ts`, system prompt** — reglas explícitas de formato de tool call, con
instrucción de no imitar lo que el modelo ve en el historial.

**`harness/harness.ts`** — timeout de 30 s en los dos handlers de tools. Devuelve un
mensaje útil al modelo en lugar de dejar el turno colgado.

**`poppler-pdf-service.ts`** — comprueba el exit code de `pdftoppm` (antes se ignoraba);
timeout de 20 s en `renderPage`.

### Observabilidad añadida

**`gemini.ts`** — log `gemini.response` por cada llamada a la API, con `finishReason`,
tokens, número de partes y los primeros 200 caracteres del texto.

**`session.ts`** — log `agent.step` por cada paso del bucle, con número de paso,
tool calls y los primeros 200 caracteres del texto de respuesta.

---

## 8. Lo que no se arregló

- **`renderMessage` sigue serializando como prosa.** La solución de la Fase 3 (Opción A)
  es un parche de reconocimiento por regex. La solución completa requiere llevar la
  información estructurada de tool call hasta `gemini.ts` sin regex, lo que exige cambiar
  `AgentMessage` (declarado dos veces), `renderMessage`, el contrato NDJSON y el cliente
  web. Encaja con el PR-05.
- **Experimento A (`maxSteps: 16`) y Experimento B (historial limpio)** no se ejecutaron
  aún. Pendiente de QA manual con entorno configurado.

---

## 9. Medidas de prevención

| Medida | Dónde vive | Cómo se comprueba que sigue puesta |
|---|---|---|
| Log `gemini.response` por llamada | `gemini.ts` | `grep "gemini.response" /tmp/fuga-*.log` devuelve ≥ 3 líneas |
| Log `agent.step` por paso | `session.ts` | `grep "agent.step" /tmp/fuga-*.log` devuelve ≥ 3 líneas |
| Detección de fuga en `toResponseParts` | `gemini.ts` | `grep "agent.tool_call_leak" ...` = 0 tras el arreglo |
| Reglas de formato en system prompt | `academic-tutor.ts` | El string `"Tool call format"` está en el prompt |
| Timeout 30 s en tool handlers | `harness.ts` | Sin cambio: `grep "TOOL_TIMEOUT" harness.ts` |
| Timeout 20 s + exit code en `renderPage` | `poppler-pdf-service.ts` | `grep "exitCode !== 0" poppler-pdf-service.ts` |
| Reintento acotado a 1 en `MALFORMED_FUNCTION_CALL` | `gemini.ts` | `grep "agent.tool_call_retry" log` muestra `recovered` o `bailed` |
| Patrón leak validado contra 5 cadenas | `gemini.ts:buildLeakPattern` | Node one-liner en PR-12.1 §Paso 2.3 |
| No hay sintaxis de tool call en skills/harness | skills + `harness.ts` | `grep -rn 'cli({\|load_skill({' ...` = 0 |

---

## 10. Lecciones

- **El harness renderizaba el historial en prosa porque nadie había añadido partes nativas
  a `promptContents`.** No era un bug introducido conscientemente; era el mínimo viable
  original. Sin logs en la ruta HTTP era imposible saber qué historial veía el modelo.
- **Cero logs en la ruta de producción** fue la razón por la que el bug no se detectó
  antes. Un log de 10 campos por paso habría mostrado el patrón en la primera ejecución.
- **Sin `finishReason`** en el schema, incluso un `MAX_TOKENS` o `SAFETY` habría pasado
  desapercibido. Decodificar solo los campos que uno cree necesitar es una forma de
  perder información crítica de forma silenciosa.
- **Una regex escrita a ojo en un plan e implementada tal cual sin probarse contra la cadena real.** El PR-12 §Paso 6 definía el patrón sin ejecutarlo. El PR-12.1 incluye una verificación explícita (Paso 2.3) contra 5 cadenas de prueba antes de commitear. Los patrones de detección se validan con datos reales.
- **Tres sitios distintos enseñaban al modelo a escribir tool calls en prosa**: el historial (renderMessage), las skills (paso 1 de use-uploaded-materials) y el prompt del harness (el ejemplo `{ "name": "..." }`). Eliminar solo el historial no fue suficiente.
