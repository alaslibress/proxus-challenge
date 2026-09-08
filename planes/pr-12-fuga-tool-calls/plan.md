# PR-12 — Fuga de sintaxis de tool call como texto del asistente

- **Rama**: `fix/fuga-tool-calls`
- **Depende de**: PR-01. No depende de PR-1.5 ni PR-09 (ya mergeados).
- **Orden de ejecución**: **el siguiente.** Antes de PR-10 y PR-11. Es un bug vivo en
  `main` y contamina cualquier QA de los planes que vienen detrás.
- **Conflicto conocido**: **sí, con el PR-11.** El PR-11 §Paso 2 reescribe el system
  prompt del tutor y §Paso 4 baja `maxSteps`. Este PR toca el mismo prompt y el mismo
  bucle. **Se implementa antes**, y el thinker fusionará las reglas de este PR en el Paso 2
  del PR-11 tras el merge.
- **Estado**: mergeado (`28db32e`) — **no cerró el bug**, continúa en el PR-12.1
- **Contiene LLM**: sí. Cambia el prompt del tutor y el formato del historial que ve el
  modelo. Todo lo de aquí es no determinista: la verificación es empírica.
- **Origen**: incidente reportado en producción local.

> Normas de trabajo en [`../plan.md`](../plan.md). Sistema visual obligatorio en
> [`../../documentacion/design-system.md`](../../documentacion/design-system.md).
> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.

---

## Problema

### El síntoma

Tras dos tool calls correctas, aparece una burbuja de asistente con el texto literal:

```
Tool call default_api:load_skill{name:create-study-artifacts}
```

No se ejecuta nada, y el turno termina ahí.

### Las tres hipótesis del reporte, descartadas con evidencia

Las tres son razonables y las tres son falsas. Vale la pena descartarlas por escrito para
que nadie vuelva a perseguirlas:

1. **«Estrangulamiento por `maxSteps: 8`».** No. El camino de agotamiento de pasos está en
   `harness/session.ts:115-119` y produce **otro** texto: el último tool result
   stringificado, o la frase `"Agent stopped after reaching the maximum number of steps."`.
   Además el incidente ocurre en el **tercer** paso, con cinco de margen.
   **Subir `maxSteps` a 16 no arregla esto y probablemente lo empeora** — ver §Fase 1.
2. **«Cierre prematuro del stream NDJSON».** No. El frame llega **completo y bien
   formado**: `packages/web/src/domain/tutor/stream.ts` decodifica con
   `Schema.decodeUnknownSync`, que **lanza** ante una línea truncada. Si el stream se
   hubiera cortado a medias no veríamos una burbuja, veríamos una excepción y el chat
   muerto. Lo que llega es un `{"type":"message","message":{"role":"assistant",...}}`
   perfectamente válido: el servidor **quiso** mandar ese texto.
3. **«Fallo silencioso de una herramienta anterior».** No, y el propio reporte lo
   descarta: `load_skill` y `cli(materials list)` se ejecutaron bien. Además la tool `cli`
   se declara con `failureMode: "return"` (`harness/harness.ts:14-22`), así que sus errores
   vuelven al modelo como texto de resultado, no como fallo del stream.

### La causa raíz, visible en el código

**El harness le habla a Gemini en prosa sobre las herramientas, y luego se sorprende de
que Gemini le conteste en prosa sobre las herramientas.**

`harness/session.ts:155-172`, `renderMessage`:

```ts
    case "tool-call":
      return {
        role: "assistant",
        content: `Tool call ${message.name}: ${JSON.stringify(message.input)}`
      };
```

y el resultado vuelve como mensaje de **usuario** (`:192-196`):

```ts
      return {
        role: "user",
        content: `Tool result ${message.name}${message.isFailure ? " failure" : ""}: ${formatToolResult(message.result)}`
      };
```

Y en `gemini.ts:110-119`, `promptContents` sólo sabe mandar `{ role, parts:[{text}] }`.
**Los tipos nativos `functionCall` y `functionResponse` de la API de Gemini no se usan
nunca en la petición.**

Consecuencia, y encaja exactamente con el síntoma: en el paso 3 el historial que ve el
modelo contiene **dos turnos de asistente cuyo contenido entero es una tool call escrita en
texto**. Eso es un patrón few-shot de manual. El modelo hace lo que se le ha enseñado y
escribe la tercera igual. El prefijo `default_api:` es la pista que lo confirma: es el
espacio de nombres con el que los modelos de Google verbalizan una función declarada
cuando la narran en lugar de emitirla.

**Y el adaptador no tiene ninguna defensa.** `gemini.ts:218-226`:

```ts
  const functionCall = firstFunctionCall(parts);

  if (functionCall?.name === undefined) {
    return parts.flatMap((part) => part.text === undefined ? [] : [Response.makePart("text", { text: part.text })]);
  }
```

Sin parte `functionCall`, **todo texto pasa a ser respuesta del asistente, sin mirarlo**.
Y como no hay `toolResults`, `session.ts:106-113` da el turno por terminado.

### Por qué no lo vimos venir: no hay observabilidad

Verificado con `grep`:

- **Cero logs en la ruta HTTP.** Todos los `console.log`/`Console.log` del servidor están
  en los scripts de demo de CLI (`domain/agents/index.ts`, `academic-tutor.ts`,
  `math.ts`). `session.ts`, `gemini.ts`, `tutor-chat-service.ts` y `handlers.ts` **no
  registran absolutamente nada**.
- **`finishReason` no se decodifica siquiera.** El schema de respuesta
  (`gemini.ts:21-27`) es:

  ```ts
  const GeminiResponse = Schema.Struct({
    candidates: Schema.optional(Schema.Array(Schema.Struct({
      content: Schema.optional(Schema.Struct({
        parts: Schema.optional(Schema.Array(GeminiPart))
      }))
    })))
  });
  ```

  No hay `finishReason`, ni `usageMetadata`, ni `promptFeedback`. Y `Schema.Struct`
  descarta las claves desconocidas en silencio: **un `MAX_TOKENS` o un `SAFETY` llegan y se
  tiran sin dejar rastro.**
- **Cero timeouts en todo `packages/server`.** `grep -rn "timeout" packages/server/src` no
  devuelve nada.

Por eso este plan empieza por instrumentar y no por parchear.

## Objetivo

Que una tool call sea siempre una tool call estructurada, y que si el modelo la escribe
como texto el sistema lo detecte, lo registre y se recupere, en vez de enseñárselo al
alumno.

## Fuera de alcance

- **Streaming de tokens.** Sigue siendo `Stream.empty` (decisión cerrada, ADR-02 §1).
- **Tool calls en paralelo.** `toResponseParts` seguirá honrando una por turno.
- **Añadir tools nuevas.** Obligaría a tocar el `switch` hardcodeado de
  `gemini.ts:124-154`.
- **Cambiar el contrato NDJSON.** Mover frames es PR-05.
- **El inventario de materiales en el prompt y bajar `maxSteps`.** Es el PR-11.
- **Reintentos automáticos con backoff contra la API de Gemini.**

## Contratos afectados

Ninguno en `packages/shared` **si se elige la Opción A** de la Fase 3. La Opción B sí
tocaría `AgentMessage`; ver ahí.

---

## Pasos

### FASE 0 — Observabilidad primero. No se toca lógica todavía.

#### Paso 1 — Decodificar lo que Gemini ya nos manda y estamos tirando

En `packages/server/src/domain/agents/gemini.ts`, ampliar los schemas:

```ts
const GeminiPart = Schema.Struct({
  text: Schema.optional(Schema.String),
  thought: Schema.optional(Schema.Boolean),
  functionCall: Schema.optional(FunctionCall)
});

const GeminiResponse = Schema.Struct({
  candidates: Schema.optional(Schema.Array(Schema.Struct({
    finishReason: Schema.optional(Schema.String),
    content: Schema.optional(Schema.Struct({
      parts: Schema.optional(Schema.Array(GeminiPart))
    }))
  }))),
  usageMetadata: Schema.optional(Schema.Struct({
    promptTokenCount: Schema.optional(Schema.Number),
    candidatesTokenCount: Schema.optional(Schema.Number),
    thoughtsTokenCount: Schema.optional(Schema.Number),
    totalTokenCount: Schema.optional(Schema.Number)
  })),
  promptFeedback: Schema.optional(Schema.Struct({
    blockReason: Schema.optional(Schema.String)
  }))
});
```

1. [ ] `thought` se añade **a propósito**: `gemini-2.5-flash` es un modelo de razonamiento
       y, si alguna vez se activan los resúmenes de pensamiento, sus partes vienen con
       `thought: true` y con el schema actual serían indistinguibles de una respuesta. Hoy
       no deberían llegar (no se pide `includeThoughts`), así que **si el log muestra
       `thought: true`, ese es el bug y hay que decirlo**.
2. [ ] `finishReason` es el dato que pide la Fase 1. Valores a vigilar: `STOP` (normal),
       `MAX_TOKENS` (truncamiento — confirmaría la hipótesis 2 en su versión buena),
       `SAFETY`, `RECITATION`, `MALFORMED_FUNCTION_CALL` (**si sale este, es la
       confirmación directa de la causa raíz**).

#### Paso 2 — Un log por paso del agente

En `harness/session.ts`, dentro del bucle (`:80-113`), tras recibir la respuesta:

```ts
      yield* Effect.log("agent.step").pipe(
        Effect.annotateLogs({
          step,
          maxSteps,
          textParts: response.text.length,
          toolCalls: response.toolCalls.map((c) => c.name),
          toolResults: response.toolResults.length,
          textPreview: response.text.slice(0, 200)
        })
      );
```

1. [ ] Verificar la API de logging de `effect@4.0.0-beta.83`: `Effect.log` y
       `Effect.annotateLogs` deberían existir. **Si no, para y notifica**; no improvisar
       con `console.log` dentro del dominio.
2. [ ] En `gemini.ts`, tras `decodeGeminiResponse`, un log equivalente con
       `finishReason`, `usageMetadata`, número de partes, cuántas traen `functionCall`,
       cuántas traen `thought`, y los primeros 200 caracteres del texto.
3. [ ] **`textPreview` truncado a 200 caracteres, siempre.** Los prompts llevan páginas de
       PDF en base64; un log sin recortar tumba la terminal.
4. [ ] Activar el nivel de log en desarrollo si hiciera falta, sin tocar producción.

#### Paso 3 — Reproducir con la instrumentación puesta

1. [ ] Reproducir el incidente por CLI, que es donde se ve el historial completo:

   ```bash
   pnpm --filter @proxus/server run agent:tutor "lista mis materiales y luego créame un quiz corto con ellos"
   ```

   Ese prompt fuerza la secuencia del reporte: `load_skill` → `cli materials list` → tercer
   paso.
2. [ ] Guardar la salida entera en `/tmp/fuga-<fecha>.log`. **Ese log es el entregable de
       la Fase 0** y va citado en el post-mortem.
3. [ ] Rellenar esta tabla en el post-mortem antes de seguir:

   | Paso | `finishReason` | ¿parte `functionCall`? | ¿parte `thought`? | Primeros 200 car. del texto |
   |---|---|---|---|---|
   | 1 | | | | |
   | 2 | | | | |
   | 3 | | | | |

4. [ ] **Regla de parada**: si `finishReason` del paso 3 es `MAX_TOKENS`, la causa raíz es
       truncamiento y no el envenenamiento del historial. **Para y notifica**: cambia el
       plan (haría falta `maxOutputTokens` en `generationConfig`, que hoy no se envía).

### FASE 1 — Los experimentos, para falsar hipótesis

Cada experimento tiene una predicción. Anotar el resultado real aunque contradiga la
predicción — sobre todo si la contradice.

#### Paso 4 — Experimento A: `maxSteps` a 16

1. [ ] En `packages/web/src/components/Chat.tsx:40`, cambiar `maxSteps: 8` por
       `maxSteps: 16`. **Es un cambio temporal de diagnóstico; no se commitea.**
2. [ ] Repetir el caso del Paso 3 desde la interfaz.
3. [ ] **Predicción**: no arregla nada, y la fuga aparece **antes o igual de pronto**. El
       razonamiento: cada paso añade al historial otro turno de asistente con una tool call
       en texto, así que más pasos significan más ejemplos del patrón malo. Además
       `renderPrompt` (`session.ts:83`) reconstruye el prompt entero en cada iteración y
       reenvía todas las imágenes de páginas ya renderizadas, con lo que subir el techo
       multiplica tokens y acerca el `MAX_TOKENS`.
4. [ ] Si la predicción falla y con 16 pasos deja de ocurrir, **para y notifica**: la causa
       raíz sería otra y este plan hay que rehacerlo.
5. [ ] **Revertir el cambio.** El PR-11 baja este número a 4, no lo sube. Dejarlo en 16
       sería ir en dirección contraria.

#### Paso 5 — Experimento B: historial limpio

1. [ ] Con el servidor instrumentado, mandar directamente la tercera petición sin las dos
       anteriores en el historial:

   ```bash
   pnpm --filter @proxus/server run agent:tutor "créame un quiz corto con mis materiales"
   ```

2. [ ] **Predicción**: sin los dos turnos de tool call en texto en el historial, el modelo
       emite una `functionCall` estructurada y no hay fuga.
3. [ ] **Este experimento es el que confirma o tumba la causa raíz.** Si con historial
       limpio también fuga, el problema está en el prompt o en el modelo, no en
       `renderMessage`, y hay que decirlo en el post-mortem.

### FASE 2 — Refuerzo: detectar, registrar y recuperarse

Esto se implementa aunque la Fase 3 arregle la causa raíz: es la red de seguridad.

#### Paso 6 — El adaptador deja de publicar tool calls en texto

En `gemini.ts`, dentro de `toResponseParts`, en la rama sin `functionCall`:

1. [ ] Detectar el patrón antes de devolver texto:

   ```ts
   const TOOL_CALL_LEAK = /(?:default_api[.:]\s*)?\b(load_skill|cli)\b\s*[({]/i;
   ```

   La detección se limita a **los nombres de tools realmente declarados** (`tools` ya llega
   como argumento): buscar `default_api` a secas daría falsos positivos si el alumno
   pregunta por APIs.
2. [ ] Si el texto casa y **no** hay ninguna parte `functionCall`, no se emite ese texto.
       En su lugar se emite una parte de texto **de recuperación**, dirigida al modelo, no
       al alumno:

   ```
   Your previous turn wrote a tool call as plain text instead of emitting it. Emit it as a real function call, or answer the user directly.
   ```

   y se registra un log `agent.tool_call_leak` con el texto original truncado.
3. [ ] **Nunca lanzar una excepción aquí.** El `Effect.tryPromise` de
       `gemini.ts:266-283` la convertiría en `AiError`, y `session.ts:87-92` la
       convertiría en el mensaje sintético *"I hit an internal model/tool-routing error…"*
       que el alumno tampoco debería ver.
4. [ ] **Decisión explícita: no se parsea el texto para reconstruir la llamada.** Sería
       ejecutar una acción a partir de una cadena que el modelo escribió mal, con
       comillas ausentes y argumentos ambiguos (`{name:create-study-artifacts}` no es JSON
       válido). Se prefiere pedirle que la repita bien. Está en *Riesgos y decisiones*.

#### Paso 7 — Reglas en el system prompt

En `packages/server/src/domain/agents/academic-tutor.ts`, añadir al final del `name`,
antes de lo que añada el PR-11:

```
## Tool call format — non-negotiable

- A tool call is a structured function call. Never write one as text.
- Never write `default_api`, `print(...)`, `tool_code`, or any prose that describes a call
  you are about to make. Either emit the call, or answer.
- The conversation history shows earlier tool calls rendered as text. That is a transcript
  for your reference, not a format to imitate.
- If you cannot emit a structured call, say what you need in plain language instead. Do
  not fake it.
```

1. [ ] La tercera regla es la importante mientras la Fase 3 no esté hecha: **le dice
       explícitamente al modelo que no imite lo que ve en el historial.**
2. [ ] Va en la persona del tutor, no en `harness/harness.ts:52-62`: esa plantilla la
       comparten los agentes `math` y `sum`.

#### Paso 8 — Que una tool lenta no cuelgue el turno

Hoy no hay ni un timeout en `packages/server`, y `PopplerPdfService.renderPage`
(`infra/materials/poppler-pdf-service.ts:41-70`) lanza `pdftoppm` sin límite de tiempo.
Un PDF patológico deja el turno colgado hasta que el navegador se rinde, sin `tool_result`
y sin frame terminal.

1. [ ] Envolver los dos handlers de tools en `harness/harness.ts:67-72` con un límite de
       tiempo que **devuelva un resultado**, no que falle:

   ```ts
   const TOOL_TIMEOUT = "30 seconds";

   cli: ({ input }) => AgentCli.execute(commands, input).pipe(
     Effect.mapError(AgentCli.renderError),
     Effect.timeoutTo({
       duration: TOOL_TIMEOUT,
       onTimeout: () => `Tool timed out after 30 seconds: ${input}. Tell the user the material could not be processed and continue without it.`,
       onSuccess: (value) => value
     })
   )
   ```

   **Verificar la API real de timeout en `effect@4.0.0-beta.83`** (`Effect.timeout`,
   `Effect.timeoutTo`, `Effect.timeoutOption`): la forma exacta puede diferir. Si ninguna
   encaja, para y notifica.
2. [ ] El texto de timeout es **para el modelo**: le dice qué pasó y qué hacer, para que
       redacte una respuesta útil en vez de reintentar en bucle.
3. [ ] Un timeout más corto y propio en `PdfService.renderPage`, 20 s, por debajo del de la
       tool, para que el error concreto gane al genérico.
4. [ ] `spawner.exitCode` en `poppler-pdf-service.ts:48-63` **se espera pero su valor nunca
       se compara con 0**: un `pdftoppm` que falla se manifiesta después, como un
       `readFile` de un fichero que no existe. Comprobar el código de salida y fallar con
       un `PdfServiceError` que diga la verdad.
5. [ ] Log `agent.tool_timeout` con el nombre de la tool y su entrada.

### FASE 3 — La causa raíz: hablarle a Gemini en su formato

**Antes de empezar esta fase, la Fase 1 tiene que haber confirmado el diagnóstico.**
Si el Experimento B no reprodujo la mejora esperada, esta fase no se hace.

Dos opciones. **La recomendada es la A.**

#### Paso 9 — Opción A: partes nativas sólo en el adaptador

`AgentMessage` no cambia; el harness sigue igual; la traducción ocurre donde debe estar,
en `gemini.ts`.

1. [ ] En `promptContents` (`gemini.ts:110-119`), reconocer los dos formatos que hoy se
       serializan como prosa y traducirlos a partes nativas:
   - un mensaje de asistente cuyo contenido case con `^Tool call (\w+): (\{.*\})$` →
     `{ role: "model", parts: [{ functionCall: { name, args } }] }`
   - un mensaje de usuario que case con `^Tool result (\w+)( failure)?: ` →
     `{ role: "user", parts: [{ functionResponse: { name, response: { result } } }] }`
2. [ ] **Esto es un parche de reconocimiento por regex, y hay que reconocerlo como tal en
       el PR.** Es feo, pero es local, no toca el harness ni los schemas compartidos, y se
       puede borrar entero el día que `AgentMessage` lleve la información estructurada.
3. [ ] El `role` de `functionResponse` en la API de Gemini es `user` (o `function` según
       versión). **Verificar contra la API real** con una petición de prueba antes de
       darlo por bueno.

#### Paso 10 — Opción B: no se hace en este PR

Llevar el id, nombre y argumentos estructurados hasta `gemini.ts` sin regex exige tocar
`AgentMessage` — que está **declarado dos veces** (`shared/src/schemas/agent-message.ts` y
`server/src/domain/agents/harness/message.ts`) — más `renderMessage`, más el `switch`
exhaustivo de `session.ts` bajo `noFallthroughCasesInSwitch`, más el contrato NDJSON que
el cliente decodifica en estricto. Son cuatro sitios y un cambio de protocolo.

1. [ ] **No se implementa aquí.** Queda anotado como la deuda que cierra este bug del todo,
       y encaja de forma natural con el PR-05, que ya va a mover el contrato de frames.

### FASE 4 — Post-mortem

#### Paso 11 — El documento

1. [ ] Crear `documentacion/post-mortem-01-fuga-tool-calls.md` con **exactamente** esta
       plantilla, rellenando lo que la Fase 0 y la Fase 1 hayan demostrado. Los campos que
       no se hayan podido verificar se dejan escritos como *"no verificado"*, nunca se
       rellenan a ojo:

   ```markdown
   # Post-mortem 01 — Fuga de sintaxis de tool call como texto

   - **Fecha del incidente**:
   - **Detectado por**:
   - **Severidad**: alta — el alumno ve tripas del sistema y el turno termina sin respuesta.
   - **Estado**: investigando | causa confirmada | resuelto
   - **PR**: PR-12 (`fix/fuga-tool-calls`)

   ## 1. Descripción del bug

   Qué vio el usuario, literal. Incluir la burbuja tal cual apareció y la secuencia de
   pasos previos.

   ## 2. Impacto

   Cuántos turnos afectados, si se perdió trabajo del alumno, si el chat quedó usable.

   ## 3. Cronología

   | Momento | Hecho |
   |---|---|
   | | |

   ## 4. Evidencia recogida

   Log de la Fase 0 (`/tmp/fuga-<fecha>.log`) y la tabla por paso:

   | Paso | `finishReason` | ¿parte `functionCall`? | ¿parte `thought`? | Primeros 200 car. |
   |---|---|---|---|---|
   | 1 | | | | |
   | 2 | | | | |
   | 3 | | | | |

   ## 5. Hipótesis evaluadas

   | Hipótesis | Veredicto | Evidencia que lo decide |
   |---|---|---|
   | Estrangulamiento por `maxSteps` | | Experimento A |
   | Cierre prematuro del stream NDJSON | | |
   | Fallo silencioso de una tool previa | | |
   | Envenenamiento del historial por `renderMessage` | | Experimento B |

   ## 6. Causa raíz

   *(A rellenar tras la verificación. Una causa, con ruta y línea. Si la evidencia no
   alcanza para una sola, decirlo y enumerar las candidatas que siguen vivas.)*

   ## 7. Solución implementada

   Qué se cambió, fichero a fichero, y qué hace cada cambio. Distinguir entre lo que
   **arregla** la causa raíz y lo que sólo **contiene** el síntoma.

   ## 8. Lo que no se arregló

   Deuda que queda abierta y por qué se decidió dejarla.

   ## 9. Medidas de prevención

   | Medida | Dónde vive | Cómo se comprueba que sigue puesta |
   |---|---|---|
   | | | |

   ## 10. Lecciones

   Qué nos impidió verlo antes. Sobre observabilidad, no sobre personas.
   ```

2. [ ] Añadir la entrada correspondiente a `documentacion/dificultades.md`, con el formato
       Síntoma / Causa / Solución / Descartado que fija el PR-09.
3. [ ] `documentacion/funcionamiento-actual.md` §3 y §6: documentar que el historial se
       traduce a partes nativas y que el adaptador ya decodifica `finishReason`.

## Criterio de aceptación

- [ ] El log del servidor muestra, por cada paso del agente, el número de paso,
      `finishReason`, si hubo `functionCall` y un extracto de 200 caracteres del texto.
- [ ] El `finishReason` de Gemini queda registrado en los tres pasos del caso reproducido.
- [ ] El caso de reproducción del Paso 3 se ejecuta de punta a punta **sin que aparezca
      ninguna burbuja con `default_api`, `Tool call` ni `tool_code`**.
- [ ] Si el modelo escribe una tool call como texto, el alumno **no la ve**: queda un log
      `agent.tool_call_leak` y el modelo recibe la corrección.
- [ ] Ese caso de recuperación se puede provocar a mano (ver *Checks*) y se comporta así.
- [ ] Una tool que tarda más de 30 s devuelve un `tool-result` con el mensaje de timeout, y
      el stream **termina normal** con su frame `done`.
- [ ] Un `pdftoppm` que sale con código distinto de 0 falla con un `PdfServiceError` que lo
      dice, no con un `readFile` de un fichero inexistente.
- [ ] El experimento A está documentado con su resultado real, y `maxSteps` **sigue en 8**
      en `Chat.tsx` al cerrar el PR.
- [ ] `documentacion/post-mortem-01-fuga-tool-calls.md` existe, con la causa raíz rellenada
      o con la razón por la que no se pudo determinar.
- [ ] Ningún log del servidor vuelca base64 de páginas de PDF.
- [ ] `pnpm run typecheck` y el build de web en verde.

## Checks

```bash
pnpm run typecheck
pnpm --filter @proxus/web run build

# reproducción instrumentada (requiere API key y un PDF en .data)
pnpm --filter @proxus/server run agent:tutor \
  "lista mis materiales y luego créame un quiz corto con ellos" 2>&1 | tee /tmp/fuga-$(date +%F).log

grep -c "agent.step" /tmp/fuga-*.log            # ≥ 3
grep "finishReason" /tmp/fuga-*.log
grep -c "agent.tool_call_leak" /tmp/fuga-*.log  # 0 tras el arreglo

# la fuga no llega al cliente
curl -N -X POST http://localhost:3000/api/tutor/chat/stream \
  -H 'content-type: application/json' \
  -d '{"input":"lista mis materiales y luego créame un quiz corto","messages":[]}' \
  | grep -ciE 'default_api|tool_code|Tool call '     # 0

# la red de seguridad funciona: forzar la fuga a mano
# (temporalmente, devolver texto con "default_api:load_skill{...}" desde toResponseParts)

# no quedan restos del experimento A
grep -n "maxSteps" packages/web/src/components/Chat.tsx    # maxSteps: 8

# el eval de autoría no se rompió
pnpm --filter @proxus/server run eval:tutor:artifact-authoring
```

## QA manual

1. Con el servidor instrumentado y un PDF subido, pedir en el chat: *"lista mis materiales
   y luego créame un quiz corto con ellos"*.
2. Seguir el log en paralelo: tienen que verse tres `agent.step` con su `finishReason`.
3. En la conversación no puede aparecer ninguna burbuja con sintaxis de llamada. El quiz
   se crea y aparece en el sidebar.
4. Repetir tres veces: es un comportamiento no determinista y una sola pasada no prueba
   nada.
5. Provocar un timeout: renombrar `pdftoppm` a algo inexistente, o usar un PDF muy grande,
   y pedir *"resume la página 2"*. Debe salir un mensaje legible y el stream cerrar
   normal, no quedarse colgado.
6. Comprobar que el log no contiene bloques enormes de base64.

## Riesgos y decisiones

- **La causa raíz es una hipótesis hasta que la Fase 1 la confirme.** Todo el plan está
  ordenado para que el Experimento B la decida antes de tocar `promptContents`. Si sale que
  no, la Fase 3 no se hace y las Fases 0 y 2 valen igual: instrumentación y red de
  seguridad se quedan.

- **No se parsea el texto fugado para reconstruir la llamada.** Sería ejecutar una acción
  a partir de una cadena mal formada que el propio modelo se inventó
  (`{name:create-study-artifacts}` ni siquiera es JSON). El coste de decidir mal ahí es
  ejecutar la tool equivocada con argumentos inventados. Se prefiere pedirle que la repita
  bien, aunque cueste un round-trip.

- **La detección por regex tiene falsos positivos.** Un alumno puede preguntar
  legítimamente *"¿qué es una API por defecto?"*. Se acota exigiendo un nombre de tool
  realmente declarado seguido de `(` o `{`, y aun así conviene revisar el contador de
  `agent.tool_call_leak`: si sube sin que haya fuga, el patrón es demasiado ancho.

- **La Opción A de la Fase 3 es un reconocimiento por regex de nuestro propio formato.**
  Es deuda declarada: la serialización a texto y el reconocimiento viven en ficheros
  distintos, así que se pueden desincronizar. Se acepta porque la alternativa toca cuatro
  sitios y el contrato NDJSON, y porque se borra entera cuando el PR-05 mueva los frames.
  **Si el doer ve que las dos regex y `renderMessage` se separan, lo dice.**

- **Subir `maxSteps` a 16 empeora esto.** Va como experimento de falsación y se revierte.
  El PR-11 lo baja a 4 por razones de latencia, y ese cambio también reduce la superficie
  de este bug: menos pasos, menos ejemplos del patrón malo en el historial.

- **Los logs pueden filtrar contenido del alumno.** Por eso todo extracto va truncado a
  200 caracteres y nunca se registran las partes `file`. Es una demo local sin usuarios,
  pero el hábito importa: un log que vuelca prompts enteros es una fuga de datos esperando
  a que la app tenga usuarios.

- **Este PR toca el prompt, igual que el PR-11.** Fusionar las reglas es trabajo del
  thinker tras el merge, no del doer.

## Historial

- **Reabierto tras el merge.** El log del 7-sep 22:29 confirma la causa raíz
  (`finishReason: MALFORMED_FUNCTION_CALL`, texto fugado idéntico al formato de
  `renderMessage`), pero el bug persiste por dos fallos **de este plan**, no de la
  implementación:
  1. El patrón del §Paso 6 exige `\s*[({]` tras el nombre de la tool, y el texto real trae
     `load_skill: {` — con `:` de por medio. No podía casar nunca.
  2. La parte de texto correctiva del §Paso 6.2 vuelve a `session.ts:106-113`, que sin
     tool results **termina el turno** y la publica como respuesta del asistente. La
     corrección se le entregaba al alumno en vez de al modelo.
  Continúa en [`../pr-12-1-fuga-tool-calls-reintento/plan.md`](../pr-12-1-fuga-tool-calls-reintento/plan.md).

- *(vacío)*
