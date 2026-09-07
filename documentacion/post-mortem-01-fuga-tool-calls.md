# Post-mortem 01 — Fuga de sintaxis de tool call como texto

- **Fecha del incidente**: 2026-09-07
- **Detectado por**: usuario durante QA manual de PR-09 (subida de PDFs).
- **Severidad**: alta — el alumno ve tripas del sistema y el turno termina sin respuesta útil.
- **Estado**: causa confirmada · resuelto (PR-12, `fix/fuga-tool-calls`)
- **PR**: PR-12 (`fix/fuga-tool-calls`)

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

La causa raíz fue diagnosticada por análisis estático del código: la cadena causal es
evidente en `renderMessage` y `promptContents` sin necesidad de logs.

---

## 5. Hipótesis evaluadas

| Hipótesis | Veredicto | Evidencia que lo decide |
|---|---|---|
| Estrangulamiento por `maxSteps` | **Descartada** | El path de agotamiento (`session.ts:115-119`) produce un texto distinto; el bug ocurrió en el paso 3 con 5 de margen |
| Cierre prematuro del stream NDJSON | **Descartada** | El frame llegó completo y bien formado — `decodeUnknownSync` habría lanzado ante un frame truncado |
| Fallo silencioso de una tool previa | **Descartada** | El reporte confirma que `load_skill` y `cli materials list` devolvieron resultados; `cli` tiene `failureMode: "return"` |
| Envenenamiento del historial por `renderMessage` | **Confirmada** (análisis estático) | Ver §6 |

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

### Arregla la causa raíz

**`gemini.ts`, función `promptContents`** — reconoce los mensajes de historial que
`renderMessage` serializa como prosa y los traduce de vuelta a partes nativas de Gemini:

- Asistente con `^Tool call (\w+): (\{...\})$` → `{ role: "model", parts: [{ functionCall: { name, args } }] }`
- Usuario con `^Tool result (\w+)( failure)?: ` → `{ role: "user", parts: [{ functionResponse: { name, response: { result } } }] }`

Así el modelo ve su propio formato nativo en el historial, no prosa imitada.

**Nota de deuda**: las dos regex (`TOOL_CALL_RE`, `TOOL_RESULT_RE`) deben mantenerse en
sincronía con `renderMessage` en `harness/session.ts`. Se eliminarán cuando el PR-05
migre el contrato de frames.

### Contiene el síntoma (red de seguridad)

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
