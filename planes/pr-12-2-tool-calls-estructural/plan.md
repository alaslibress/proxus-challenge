# PR-12.2 — Quitar la prosa del contrato de tool calls

- **Rama**: `fix/tool-calls-estructural`
- **Depende de**: PR-12 (`74b6ea9`) y PR-12.1, ambos mergeados.
- **Orden de ejecución**: **el siguiente.**
- **Estado**: borrador
- **Contiene LLM**: sí.
- **Origen**: log de reproducción del 8 de septiembre de 2026, 00:53. Tercera iteración
  sobre el mismo bug, y la última: **este plan no parchea, quita la causa.**

> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.

---

## Problema

Tras el PR-12.1 la fuga ya no llega al usuario, pero el agente sigue sin poder trabajar:

```
[00:53:57] gemini.response { finishReason: 'STOP', functionCallParts: 1 }   ← paso 0 OK
[00:53:59] gemini.response { finishReason: 'STOP', functionCallParts: 0,
             textPreview: 'Tool call cli: {"input":"materials view alejandropozoperezproxus 1"}' }
[00:53:59] agent.tool_call_leak
[00:54:17] gemini.response { finishReason: 'MALFORMED_FUNCTION_CALL', retry: true }
[00:54:17] agent.tool_call_retry { outcome: 'bailed' }
{ "role": "assistant", "content": "No he podido completar esa acción. …" }
```

Cuatro problemas, y cada uno tiene su paso en este plan:

1. **El formato canónico interno de una tool call es una cadena de texto.**
   `renderMessage` (`harness/session.ts:155-197`) serializa a
   `Tool call ${name}: ${JSON.stringify(input)}`, y `gemini.ts` deshace eso con expresiones
   regulares. Hay tres patrones que describen el mismo formato y que **hay que mantener
   sincronizados a mano** — el propio código lo advierte en un comentario
   (`gemini.ts:126-131`). Dos iteraciones han fallado por ahí. Mientras el formato canónico
   sea texto, esto vuelve.
2. **Regañar al modelo en texto empeora el resultado.** El reintento del PR-12.1 añade un
   turno que dice *"Do not write the words `Tool call`"* y tardó 18 s en devolver
   `MALFORMED_FUNCTION_CALL`. El intento sin esa frase había salido sólo `STOP`.
3. **El system prompt afirma algo falso** (`academic-tutor.ts:29`): *"The conversation
   history shows earlier tool calls rendered as text."* Desde el PR-12 el historial se
   traduce a partes nativas. Le estamos describiendo al modelo un formato de texto que ya
   no está en su contexto.
4. **Rendirse tira una respuesta que ya era buena.** En el log, el agente **tenía la lista
   de materiales** cuando emitió la frase enlatada y terminó el turno. El alumno preguntó
   dos cosas y no recibió ninguna, pudiendo haber recibido una.

### El hallazgo que hace barato el arreglo de verdad

El PR-12 y el PR-12.1 aplazaron el cambio estructural dando por hecho que obligaba a tocar
`AgentMessage`, `packages/shared` y el contrato NDJSON. **Eso es falso**, verificado en
`effect@4.0.0-beta.83`:

- `Prompt.ToolCallPartEncoded` existe (`Prompt.ts:543`): `{ type: "tool-call", id, name,
  params, providerExecuted? }`.
- `Prompt.ToolResultPartEncoded` existe (`Prompt.ts:660`): `{ type: "tool-result", id,
  name, isFailure, result }`.
- Hay un rol `"tool"` propio: `Prompt.ToolMessageEncoded` (`Prompt.ts:1584`), y
  `Prompt.MessageEncoded` es la unión `system | user | assistant | tool` (`:1662-1666`).

O sea: **el tipo que `renderMessage` ya devuelve admite tool calls estructuradas**. Nunca
hizo falta la prosa. El cambio vive entero en dos ficheros de `packages/server`, no cruza
paquetes y no toca el protocolo del chat.

## Objetivo

Que una tool call viaje estructurada desde el harness hasta Gemini, sin pasar por texto en
ningún punto, y que un fallo del modelo degrade en vez de terminar el turno.

## Fuera de alcance

- `AgentMessage`, `packages/shared`, el contrato NDJSON y `packages/web`. **No se tocan**:
  el hallazgo de arriba los saca del alcance.
- `maxSteps`, inventario de materiales y latencia: PR-11.
- Tool calls en paralelo: `toResponseParts` sigue honrando una por turno.

## Pasos

### Paso 1 — `renderMessage` deja de serializar a texto

En `harness/session.ts`:

1. [ ] `tool-call` pasa a devolver:

   ```ts
   {
     role: "assistant",
     content: [{ type: "tool-call", id, name: message.name, params: message.input }]
   }
   ```

2. [ ] `tool-result` pasa a devolver:

   ```ts
   {
     role: "tool",
     content: [{ type: "tool-result", id, name: message.name, isFailure: message.isFailure, result: message.result }]
   }
   ```

3. [ ] **El `id`.** `ToolCallPartEncoded` y `ToolResultPartEncoded` lo exigen, y
       `AgentMessage` no lo tiene. Se sintetiza emparejando por orden: el n-ésimo
       `tool-call` y el n-ésimo `tool-result` comparten `call_${n}`. Es el mismo supuesto
       FIFO que ya hace la web (`domain/tutor/invalidation.ts` + `Chat.tsx`) y es válido
       porque el bucle es estrictamente secuencial y `gemini.ts` honra una sola function
       call por turno.
4. [ ] Eso obliga a que `renderPrompt` (`session.ts:144-153`) deje de ser un `.map` suelto:
       necesita llevar un contador a lo largo de la lista. Convertirlo en un `reduce` o en
       un bucle con índice. **No usar un contador de módulo**: `renderPrompt` se llama en
       cada iteración y tiene que dar el mismo resultado siempre.
5. [ ] **El caso multimodal se queda como está.** Un `tool-result` de `MaterialPageImages`
       (`session.ts:173-190`) sigue emitiendo un mensaje de **usuario** con partes `file`:
       `ToolMessagePartEncoded` sólo admite `tool-result` y `tool-approval-response`, **no
       admite `file`**. Para no perder ni la estructura ni las imágenes: emitir primero el
       mensaje `tool` con un `result` textual corto (`"rendered pages 3, 4 from …"`) y a
       continuación el mensaje de usuario con las imágenes. Son dos mensajes para un solo
       `AgentMessage`, así que este caso también necesita que el paso 4 permita devolver
       más de un mensaje por entrada.
6. [ ] `noFallthroughCasesInSwitch` sigue activo: el `switch` de `renderMessage` no gana
       ramas, sólo cambia lo que devuelve.

### Paso 2 — `gemini.ts` consume partes, no cadenas

1. [ ] En `promptContents`, tratar los nuevos roles y partes:
   - parte `tool-call` → `{ functionCall: { name, args: params } }` en un turno
     `role: "model"`.
   - parte `tool-result` → `{ functionResponse: { name, response: { result } } }` en un
     turno `role: "user"`.
   - el rol `"tool"` de Effect **no existe en Gemini**: se mapea a `"user"`.
     **Verificar contra la API** si `v1beta` acepta también `role: "function"`; si acepta
     los dos, quedarse con `"user"`, que es lo que ya funciona hoy.
2. [ ] **Borrar `TOOL_CALL_RE`, `TOOL_RESULT_RE` y su comentario de sincronización**
       (`gemini.ts:126-133`). Ya no hay nada que reconocer.
3. [ ] **Borrar `buildLeakPattern`** y su uso. La detección de fuga se queda apoyada en dos
       señales que no se desincronizan con nada:
   - `finishReason === "MALFORMED_FUNCTION_CALL"`, y
   - no hay ninguna parte `functionCall` en una respuesta que tampoco trae texto útil.
   Si tras la verificación se ve que hace falta una red adicional, se discute entonces; no
   se reintroduce una regex "por si acaso".
4. [ ] `isFailure` se pierde en la traducción a `functionResponse` (Gemini no tiene ese
       campo). Conservarlo dentro del `response`: `{ result, isFailure }`. Es información
       que el modelo necesita para saber que una tool falló.

### Paso 3 — El reintento fuerza la llamada en vez de regañar

1. [ ] Sustituir el turno de texto correctivo (`gemini.ts:444-454`) por un reenvío del
       mismo body con `toolConfig: { functionCallingConfig: { mode: "ANY" } }`. Con ese
       modo el texto **deja de ser una salida posible**.
2. [ ] Construirlo donde se construye el resto (`toolChoiceConfig` / `toolConfig`), no en
       línea. Verificar si ya contempla `ANY`; si no, añadirlo ahí.
3. [ ] **Eliminar por completo** la frase `Do not write the words "Tool call"`. Nombrar el
       token que no quieres que escriba lo pone en su contexto justo antes de generar, y el
       log muestra que el reintento con esa frase salió peor que el intento sin ella.
4. [ ] `mode: "ANY"` **sólo en el reintento**. En la llamada normal forzaría una tool call
       también cuando lo correcto es contestar, que es justo lo que el PR-11 quiere evitar.
5. [ ] Un reintento, no más.

### Paso 4 — Rendirse deja de terminar el turno

1. [ ] El adaptador deja de devolver la frase `"No he podido completar esa acción…"`. Esa
       decisión no le corresponde: `gemini.ts` no sabe qué se ha conseguido ya.
2. [ ] En su lugar señala al bucle que el paso salió malformado — un flag en el resultado, o
       una parte vacía más el log que ya existe.
3. [ ] En `harness/session.ts`, un paso malformado **no sale del bucle**. Se añade a
       `newMessages` un mensaje de usuario sintético y se continúa una iteración:

   ```
   The tool call could not be completed. Answer the user now, in their language, using only what you already know from this conversation. Say plainly what you could not do.
   ```

4. [ ] Ese mensaje sintético **no se emite al cliente**: `appendMessage` publica en el
       stream. Añadirlo a `newMessages` sin pasar por `emit`, o el alumno lo verá.
5. [ ] Si el bucle se agota igual, sigue valiendo la degradación actual
       (`session.ts:115-119`).
6. [ ] Resultado esperado en el caso del log: *"Tus materiales son: alejandropozoperezproxus
       (1 página). No he podido abrir el PDF para generar el quiz."*

### Paso 5 — El prompt deja de describir el formato que prohíbe

En `academic-tutor.ts:25-30`, sustituir el bloque `## Tool call format — non-negotiable`
entero por:

```
## Tools

- Use the provided functions to act. Calling a function is a structured action, never
  something you describe or announce in your reply.
- If you cannot perform an action, say so in plain language and continue with what you know.
```

1. [ ] Fuera la frase sobre el historial: **es falsa** desde el PR-12, y tras el Paso 1 lo
       es del todo.
2. [ ] Fuera la lista de tokens prohibidos (`default_api`, `print(...)`, `tool_code`).

### Paso 6 — Log del request, para poder afirmar que quedó arreglado

Toda la observabilidad de hoy es del lado de la respuesta. Sin esto no se puede demostrar
que el historial viaja estructurado.

1. [ ] Antes del `fetch`, un log `gemini.request` con la **forma**, nunca el contenido:

   ```ts
   yield* Effect.log("gemini.request").pipe(Effect.annotateLogs({
     systemInstructionChars: /* longitud */,
     contents: body.contents.map((c) => ({
       role: c.role,
       parts: c.parts.map((p) =>
         "functionCall" in p ? `functionCall:${p.functionCall.name}`
         : "functionResponse" in p ? `functionResponse:${p.functionResponse.name}`
         : "inlineData" in p ? "inlineData"
         : `text:${String(p.text).slice(0, 60)}`
       )
     })),
     toolConfigMode: /* el mode enviado, o "none" */
   }));
   ```

2. [ ] **Nunca volcar `inlineData`**: son páginas de PDF en base64.
3. [ ] En el paso 1 del caso de reproducción, el turno `model` del historial tiene que salir
       como `functionCall:cli` y el siguiente como `functionResponse:cli`. **Si sale
       `text:Tool call cli: …`, el Paso 1 no está bien hecho: para y revísalo.**

### Paso 7 — Verificación y cierre

1. [ ] Cinco ejecuciones del caso del log, guardando cada una.
2. [ ] Por ejecución: pasos, `finishReason`, si hubo `agent.tool_call_leak`, si el reintento
       se recuperó, y **si la tarea se completó** (lista + quiz creado).
3. [ ] `pnpm --filter @proxus/server run eval:tutor:artifact-authoring`.
4. [ ] Cerrar `documentacion/post-mortem-01-fuga-tool-calls.md`. Es el mismo incidente,
       tercera iteración:
   - §6 Causa raíz: el formato de prosa en el contrato interno, con la corrección de que
     `Prompt` ya soportaba partes estructuradas desde el principio.
   - §7 Solución: qué aportó cada iteración. El PR-12 la observabilidad y la traducción; el
     PR-12.1 la contención de la fuga y la purga de las skills; este PR la eliminación de
     la causa.
   - §9 Prevención: `renderMessage` no vuelve a serializar tool calls a texto, y no quedan
     regex que sincronizar.
   - §10 Lecciones, las tres: una regex escrita a ojo se implementó sin probarla contra la
     cadena real; se aplazó dos veces el arreglo estructural por suponer un coste que nunca
     se verificó; y las instrucciones negativas que nombran el token prohibido lo hacen más
     probable.
5. [ ] Entrada del PR-12.2 en `documentacion/dificultades.md`.

## Criterio de aceptación

- [ ] `grep -n "Tool call " packages/server/src/domain/agents/harness/session.ts` → **0**.
      La prosa desaparece del contrato.
- [ ] `TOOL_CALL_RE`, `TOOL_RESULT_RE` y `buildLeakPattern` ya no existen en `gemini.ts`.
- [ ] El log `gemini.request` muestra, en el paso 1, `functionCall:cli` seguido de
      `functionResponse:cli`. Ningún `text:Tool call …` en ningún turno.
- [ ] En cinco ejecuciones, ninguna muestra sintaxis de tool call al usuario.
- [ ] En cinco ejecuciones, **al menos cuatro** completan la tarea: listan el material y
      crean el quiz.
- [ ] Cuando el modelo falla, la respuesta dice **qué sí se pudo hacer**. La frase
      `"No he podido completar esa acción"` ya no existe en el código.
- [ ] Un paso malformado no termina el turno: el bucle continúa una iteración, y el mensaje
      sintético **no aparece en el chat**.
- [ ] El reintento usa `mode: "ANY"`, sigue acotado a uno, y no manda texto correctivo.
- [ ] El system prompt no contiene `default_api`, `tool_code` ni `Tool call`.
- [ ] Las páginas de PDF siguen llegando al modelo como imágenes: pedir *"resume la página
      1"* sigue funcionando.
- [ ] `eval:tutor:artifact-authoring` pasa.
- [ ] `pnpm run typecheck` en verde y **sin tocar `packages/shared` ni `packages/web`**.

## Checks

```bash
pnpm run typecheck
git diff --name-only main | grep -E "packages/(shared|web)/"   # vacío

grep -n "Tool call \|TOOL_CALL_RE\|TOOL_RESULT_RE\|buildLeakPattern" \
  packages/server/src/domain/agents/harness/session.ts \
  packages/server/src/domain/agents/gemini.ts                  # 0
grep -n "default_api\|tool_code\|Tool call" packages/server/src/domain/agents/academic-tutor.ts   # 0
grep -n "No he podido completar" packages/server/src                                              # 0

for i in 1 2 3 4 5; do
  pnpm --filter @proxus/server run agent:tutor \
    "lista mis materiales y luego créame un quiz corto con ellos" 2>&1 | tee /tmp/pr122-$i.log
done

grep -h "gemini.request" -A 8 /tmp/pr122-1.log | head -40
grep -c "functionResponse:cli" /tmp/pr122-1.log        # ≥ 1
grep -ci "Tool call " /tmp/pr122-*.log                 # 0
grep -c "outcome: 'bailed'" /tmp/pr122-*.log

pnpm --filter @proxus/server run agent:tutor "resume la página 1 de mis apuntes"
pnpm --filter @proxus/server run eval:tutor:artifact-authoring
```

## QA manual

1. Desde el chat: *"lista mis materiales y luego créame un quiz corto con ellos"*. Lista y
   crea el quiz, y el quiz aparece en el sidebar. Repetir tres veces: es no determinista.
2. *"resume la página 1 de mis apuntes"*: la ruta multimodal sigue viva. **Este caso es el
   que más riesgo tiene con el Paso 1.5**; si se rompe, se rompe en silencio.
3. Renombrar `pdftoppm` para forzar un fallo y comprobar que la respuesta dice qué
   materiales hay y qué no se pudo hacer, en vez de una frase genérica.
4. Comprobar que ningún log contiene base64.

## Riesgos y decisiones

- **El `id` sintético asume que no hay tool calls en paralelo.** Es cierto hoy por
  construcción: `gemini.ts` honra una sola function call por turno y el bucle es
  secuencial. Si algún día se admiten llamadas paralelas, este emparejamiento por orden es
  lo primero que se rompe. Dejarlo escrito en un comentario, en el sitio.

- **El caso multimodal es el riesgo real de este PR.** `ToolMessagePartEncoded` no admite
  partes `file`, así que hay que partir ese `AgentMessage` en dos mensajes. Es el único
  sitio donde el Paso 1 puede romper algo que hoy funciona, y no lo caza el compilador: lo
  caza la QA manual, caso 2.

- **`mode: "ANY"` fuerza una llamada aunque lo correcto fuera contestar.** Sólo en el
  reintento, donde ya sabemos por el intento anterior que el modelo quería llamar.

- **Continuar el bucle tras un paso malformado gasta un paso.** Con `maxSteps: 8` sobra;
  con el 4 que propone el PR-11, aprieta. **El thinker revisará ese número tras este PR.**

- **Se borran las tres regex sin dejar red de sustitución.** Es deliberado: mantenerlas
  "por si acaso" conserva justo el acoplamiento que ha causado dos iteraciones fallidas. La
  detección se queda en `finishReason`, que lo da la API y no depende de ningún formato
  nuestro.

- **Esto tenía que haberse hecho en el PR-12.** El coste que lo aplazó dos veces —tocar
  `AgentMessage`, `shared` y el contrato NDJSON— era una suposición mía que nadie
  comprobó, y resultó falsa: `Prompt` ya traía `ToolCallPart` y `ToolResultPart`. La
  lección va al post-mortem §10, porque es más útil que el arreglo.

## Historial

- **Reescrito el 8-sep-2026, antes de implementarse.** La versión anterior era un plan de
  investigación que dejaba el arreglo estructural como Paso 4 condicional. Al verificar
  `effect@4.0.0-beta.83` se comprobó que ese arreglo es local a `packages/server` y
  barato — `Prompt.ToolCallPartEncoded` (`Prompt.ts:543`),
  `Prompt.ToolResultPartEncoded` (`:660`) y el rol `"tool"` (`:1584`) ya existen. Con eso,
  investigar antes de arreglar dejó de tener sentido: el plan pasa a resolver.
