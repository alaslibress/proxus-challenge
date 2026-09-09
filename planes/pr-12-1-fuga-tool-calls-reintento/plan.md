# PR-12.1 — La fuga sigue: señal fiable y reintento acotado

- **Rama**: `fix/fuga-tool-calls-reintento`
- **Depende de**: PR-12 (`74b6ea9`, ya mergeado). Este PR **corrige el PR-12**, no lo
  repite.
- **Orden de ejecución**: **el siguiente.** El bug sigue vivo.
- **Conflicto conocido**: toca `gemini.ts` (el mismo fichero que el PR-12), las dos skills
  y el prompt del harness. **El PR-11 §Paso 3 también reescribe las descripciones y los
  cuerpos de las skills**: este PR se le adelanta en una línea concreta y el thinker
  actualizará el PR-11 tras el merge.
- **Estado**: mergeado — la fuga ya no llega al usuario, pero **el agente sigue sin completar la tarea**. Continúa en el PR-12.2
- **Contiene LLM**: sí. Cambia prompt, skills y la política de reintento contra Gemini.
- **Origen**: el PR-12 no cerró el bug. Log de reproducción del 7 de septiembre de 2026,
  22:29.

> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.

---

## Problema

El PR-12 acertó la causa raíz y aun así el bug sigue. El log de reproducción lo demuestra:

```
[22:29:04.648] INFO (#13): gemini.response {
  finishReason: 'MALFORMED_FUNCTION_CALL',
  totalTokens: 787,
  partCount: 2,
  functionCallParts: 0,
  thoughtParts: 0,
  textPreview: 'Tool call load_skill: {"name":"create-study-artifacts"}'
}
[22:29:04.650] INFO (#13): agent.step { step: 1, toolCalls: [], toolResults: 0, ... }
{ "role": "assistant", "content": "Tool call load_skill: {\"name\":\"create-study-artifacts\"}" }
```

Lo que el log confirma, y no es poco:

- **La observabilidad del PR-12 funciona.** Sin ella este análisis sería imposible.
- **La causa raíz era la correcta.** El texto fugado es, carácter por carácter, el formato
  que produce nuestro propio `renderMessage` (`session.ts:167-172`):
  `Tool call ${name}: ${JSON.stringify(input)}`. El modelo copia lo que ve en el
  historial. Ya no es una hipótesis.
- **Gemini nos lo está diciendo con todas las letras**: `MALFORMED_FUNCTION_CALL`. La API
  intentó emitir una function call, no pudo serializarla y devolvió el intento como texto.

### Fallo 1 — El patrón de detección no puede casar. Error del plan PR-12, no del doer

`gemini.ts:268-272`, implementado exactamente como lo pedía el PR-12 §Paso 6:

```ts
return new RegExp(`(?:default_api[.:]\\s*)?\\b(${escaped})\\b\\s*[({]`, "i");
```

Contra el texto real:

```
Tool call load_skill: {"name":"create-study-artifacts"}
                    ^^ aquí
```

Tras `load_skill` viene `:` y **luego** el `{`. El patrón exige `\s*[({]` inmediatamente
después del nombre. **No casa.** El texto pasa de largo por
`gemini.ts:296-299` y se publica como respuesta del asistente.

Lo irónico: **el módulo ya contiene la expresión correcta**. `gemini.ts:130`:

```ts
const TOOL_CALL_RE = /^Tool call (\w+): (\{[\s\S]*\}|\[[\s\S]*\])$/;
```

Se usa para traducir el historial hacia Gemini, y es exactamente la forma que había que
detectar en el sentido contrario.

### Fallo 2 — Aunque hubiera casado, la recuperación muere en el sitio equivocado

Este es el fallo de diseño serio, y también es del PR-12.

Cuando la detección salta, `toResponseParts` devuelve una **parte de texto** con la
corrección. Pero esa parte vuelve a `session.ts`, donde:

```ts
      if (response.toolResults.length === 0) {
        const output = response.text.length > 0 ? response.text : lastToolResult;
        yield* appendMessage(AgentMessage.assistant(output));
        return { output, newMessages, messages: allMessages() };
      }
```

Sin tool results, **el turno termina** y el texto se emite como respuesta del asistente.
O sea: en el mejor de los casos el PR-12 cambiaba una fuga por otra, y el alumno leería
*"Your previous turn wrote a tool call as plain text…"*. La corrección está escrita para
el modelo pero se le entrega al usuario, y el modelo nunca la ve.

### Fallo 3 — Le estamos enseñando la sintaxis en texto, tres veces

Además del historial, hay dos sitios que enseñan al modelo a escribir llamadas en prosa, y
uno de ellos entró en contexto **en el paso justo anterior al fallo**. Está en el propio
log, dentro del `tool-result` de `load_skill`:

```
Workflow:
1. If you do not know the material id, call `cli({ "input": "materials list" })`.
```

Y el prompt del harness (`harness/harness.ts:52-62`) hace lo mismo:

```
When a task matches a skill description, call the load_skill tool with the skill name, for example { "name": "use-uploaded-materials" }.
```

El modelo carga la skill, lee una llamada escrita como texto, y en el turno siguiente
escribe una llamada como texto. La secuencia del log es exactamente esa.

## Objetivo

Que un `MALFORMED_FUNCTION_CALL` se reintente una vez dentro del adaptador y nunca llegue
al alumno, ni como fuga ni como mensaje de sistema.

## Fuera de alcance

- Volver a tocar `promptContents`. La traducción a partes nativas del PR-12 es correcta y
  se queda.
- El contrato NDJSON, `maxSteps` y el inventario de materiales (PR-11).
- La Opción B de la Fase 3 del PR-12 (llevar la estructura hasta `AgentMessage`). Sigue
  siendo la deuda que cierra esto del todo, y sigue asignada al PR-05.

## Pasos

### Paso 1 — `finishReason` como señal primaria

La API nos da un dato determinista. Usarlo, en vez de adivinar con una regex.

1. [ ] Pasar el `finishReason` del candidato a `toResponseParts`, que hoy sólo recibe
       `parts` y `tools` (`gemini.ts:274-277`). El valor ya se decodifica
       (`gemini.ts:24`) y ya se registra (`:370-374`); sólo hay que hacerlo llegar.
2. [ ] Tratar como paso malformado, en este orden de prioridad:
   1. `finishReason === "MALFORMED_FUNCTION_CALL"` — señal dura, no hace falta mirar el
      texto.
   2. no hay ninguna parte `functionCall` **y** el texto casa con el patrón de fuga.
3. [ ] La regex deja de ser la señal principal y pasa a ser la red secundaria.

### Paso 2 — Arreglar el patrón

1. [ ] Sustituir `buildLeakPattern` por una comprobación con dos formas, ambas ancladas a
       los nombres de tools realmente declarados:

   ```ts
   const buildLeakPattern = (tools: LanguageModel.ProviderOptions["tools"]): RegExp | null => {
     if (tools.length === 0) return null;
     const escaped = tools.map((t) => t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
     //  a) nuestro propio formato de historial:  Tool call load_skill: {...}
     //  b) llamada narrada:                      default_api.load_skill({...}) / cli({...})
     return new RegExp(
       `(?:^|\\n)\\s*Tool call\\s+(?:${escaped})\\s*:` +
       `|(?:default_api[.:]\\s*)?\\b(?:${escaped})\\b\\s*[:(\\{]`,
       "i"
     );
   };
   ```

2. [ ] Dejar un comentario que ate esta expresión a `renderMessage`
       (`harness/session.ts:167-172`) y a `TOOL_CALL_RE` (`gemini.ts:130`): **las tres
       describen el mismo formato y se desincronizan solas.**
3. [ ] Comprobar el patrón contra estas cinco cadenas antes de seguir. Las tres primeras
       deben casar; las dos últimas **no**:
   - `Tool call load_skill: {"name":"create-study-artifacts"}`
   - `default_api:load_skill{name:create-study-artifacts}`
   - `cli({"input": "materials list"})`
   - `Voy a listar tus materiales y luego preparo el quiz.`
   - `Una API por defecto es la que se usa cuando no especificas otra.`

### Paso 3 — Reintento dentro del adaptador, no en el bucle

La corrección tiene que llegarle **al modelo**, y eso obliga a otra petición. Se hace en
`gemini.ts`, donde vive la llamada HTTP, para que no consuma un paso de `maxSteps` ni sea
visible en el historial del chat.

1. [ ] Extraer el `fetch` + decode + `toResponseParts` a una función interna
       `callGemini(body)`.
2. [ ] En `generateText`, si el resultado es un paso malformado, **reintentar una sola
       vez** con el mismo body más un turno correctivo al final de `contents`:

   ```ts
   {
     role: "user",
     parts: [{ text: "Your last reply wrote a function call as text. Emit it as a real function call, or answer in plain language. Do not write the words \"Tool call\"." }]
   }
   ```

3. [ ] **Un reintento, no más.** Un bucle aquí es un bucle de facturación.
4. [ ] Si el reintento vuelve a salir malformado, devolver una parte de texto **para el
       usuario**, redactada y sin tripas:

   ```
   No he podido completar esa acción. Vuelve a pedírmelo con otras palabras, por favor.
   ```

   Nunca el texto fugado, nunca el mensaje interno de corrección.
5. [ ] Logs: `agent.tool_call_leak` en la primera detección (ya existe) y
       `agent.tool_call_retry` con el resultado del reintento — `recovered` u `bailed`.
6. [ ] **La corrección interna deja de emitirse como parte de texto de la respuesta.** Esa
       era la vía por la que se colaba al alumno.

### Paso 4 — Quitar la sintaxis en texto de todo lo que el modelo lee

1. [ ] `skills/use-uploaded-materials.ts`, paso 1 del *Workflow*: eliminar
       ``call `cli({ "input": "materials list" })` ``. Redactarlo sin sintaxis:
       *"1. If you do not know the material id, list the materials first."*
2. [ ] Revisar el resto del cuerpo de las dos skills y quitar **cualquier** llamada
       escrita como código. Las listas de comandos disponibles (`materials view <id>
       <pages>`) se quedan: son argumentos del CLI, no llamadas a tools.
3. [ ] `harness/harness.ts:52-62`: quitar el ejemplo
       `for example { "name": "use-uploaded-materials" }`. Sustituir por:
       *"When a task matches a skill description, load that skill by name before doing the
       work."*
   **Ojo**: este fichero lo comparten los agentes `math` y `sum`. El cambio es de
   redacción y no les afecta funcionalmente, pero hay que decirlo en el cuerpo del PR.
4. [ ] `create-study-artifacts.ts` mantiene sus ejemplos de `artifacts create '<json>'`:
       eso es entrada del CLI y el modelo la necesita literal.

### Paso 5 — Verificación

1. [ ] Reproducir cinco veces el caso exacto del log:

   ```bash
   pnpm --filter @proxus/server run agent:tutor "lista mis materiales y luego créame un quiz corto con ellos"
   ```

2. [ ] Anotar en el post-mortem, por ejecución: si hubo `MALFORMED_FUNCTION_CALL`, si el
       reintento se recuperó, y si el quiz se creó.
3. [ ] **Es un comportamiento no determinista**: una sola pasada limpia no prueba nada, y
       cinco tampoco garantizan. El criterio es que **ninguna** de las cinco enseñe texto
       de tool call al usuario, aunque alguna dispare el reintento.

### Paso 6 — Cerrar el post-mortem

1. [ ] `documentacion/post-mortem-01-fuga-tool-calls.md` ya existe (PR-12). **Actualizarlo,
       no crear otro.**
   - §6 Causa raíz: pasa de hipótesis a **confirmada**, citando el log del 7-sep 22:29 y
     el `MALFORMED_FUNCTION_CALL`.
   - §7 Solución: separar lo que el PR-12 arregló (traducción a partes nativas,
     observabilidad, timeouts) de lo que no cerró, y añadir lo de este PR.
   - §10 Lecciones: **la lección real es que una regex escrita a ojo en un plan se
     implementó tal cual y nadie la probó contra la cadena real.** Los patrones de
     detección se validan contra ejemplos antes de darlos por buenos — de ahí el Paso 2.3.
2. [ ] Entrada del PR-12.1 en `documentacion/dificultades.md`.

## Criterio de aceptación

- [ ] Cinco ejecuciones del caso del log: en ninguna aparece texto de tool call, ni en el
      chat, ni en la salida del CLI.
- [ ] Cuando salta `MALFORMED_FUNCTION_CALL`, el log muestra `agent.tool_call_retry` y el
      resultado del reintento.
- [ ] Un paso malformado que no se recupera produce la frase de usuario redactada, y el
      turno **no** termina con un mensaje de sistema.
- [ ] El reintento está acotado a uno: dos malformados seguidos no producen tres llamadas.
- [ ] El patrón de fuga casa con las tres cadenas malas del Paso 2.3 y con ninguna de las
      dos buenas.
- [ ] Ni las skills ni el prompt del harness contienen llamadas a tools escritas como
      código.
- [ ] El quiz se sigue creando de punta a punta, y `eval:tutor:artifact-authoring` pasa.
- [ ] El post-mortem tiene la causa raíz confirmada, con el log citado.

## Checks

```bash
pnpm run typecheck
pnpm --filter @proxus/web run build

for i in 1 2 3 4 5; do
  pnpm --filter @proxus/server run agent:tutor \
    "lista mis materiales y luego créame un quiz corto con ellos" 2>&1 \
    | tee /tmp/fuga121-$i.log
done

grep -ci "Tool call " /tmp/fuga121-*.log        # 0 en la salida de usuario
grep -c "MALFORMED_FUNCTION_CALL" /tmp/fuga121-*.log
grep -c "agent.tool_call_retry" /tmp/fuga121-*.log

# la sintaxis en texto no vuelve a las skills
grep -rn 'cli({\|load_skill({\|call `cli' packages/server/src/domain/agents/academic-tutor/skills/ packages/server/src/domain/agents/harness/harness.ts   # 0

pnpm --filter @proxus/server run eval:tutor:artifact-authoring
```

## Riesgos y decisiones

- **El reintento cuesta una llamada a Gemini.** Sólo se paga cuando el paso viene
  malformado, que es un caso de fallo. Acotado a uno para que un modelo empeñado en
  equivocarse no dispare la factura.

- **El reintento es invisible en el historial del chat.** Es deliberado: el alumno no tiene
  por qué ver que el modelo se equivocó de formato. Queda en el log, que es donde sirve.

- **`MALFORMED_FUNCTION_CALL` puede aparecer por causas ajenas a la fuga** — un esquema de
  parámetros que el modelo no sabe rellenar, por ejemplo. Recuérdese que
  `gemini.ts:124-154` mapea los esquemas **a mano por nombre de tool**, con un `default` de
  `{a, b}` heredado del agente de sumas. Si el reintento falla mucho y el log no muestra
  texto con forma de llamada, **sospechar del esquema antes que del prompt**.

- **Tres sitios describen el mismo formato de texto**: `renderMessage`, `TOOL_CALL_RE` y
  el patrón de fuga. Se desincronizarán. La única cura de verdad es la Opción B (estructura
  en `AgentMessage`), que sigue asignada al PR-05. Mientras tanto, el comentario del
  Paso 2.2 es lo que hay.

- **Quitar los ejemplos de sintaxis puede empeorar el uso del CLI.** El modelo ya no ve
  `cli({ "input": "..." })` escrito en ninguna parte. La declaración de la tool sigue
  describiendo su parámetro (`harness.ts:14-22`), que es de donde debería salir. Si el eval
  de autoría empeora, **para y notifica**: habría que reintroducir el ejemplo en la
  descripción de la tool, no en texto libre.

## Historial

- **Resultado tras el merge (log del 8-sep 00:53).** Lo que funcionó: la detección salta,
  el reintento se ejecuta, y la purga de sintaxis de las skills hizo que el paso 0 emita
  una `functionCall` correcta sin `load_skill` previo. Lo que no: el paso 1 sigue
  devolviendo prosa con `finishReason: STOP` (o sea, el modelo *elige* escribirla), el
  reintento con texto correctivo salió **peor** (`MALFORMED_FUNCTION_CALL`), y la frase de
  bail termina el turno tirando una respuesta que ya era buena: el agente tenía la lista de
  materiales cuando se rindió.
- **Dos textos de este plan quedan bajo sospecha**: el mensaje de reintento incluye la
  cadena `"Tool call"` justo antes de generar, y el system prompt del PR-12 afirma que el
  historial lleva tool calls en texto, cosa que dejó de ser cierta con la traducción a
  partes nativas. Ambos son míos. Se verifican y se quitan en el PR-12.2.
  Continúa en [`../pr-12-2-tool-calls-estructural/plan.md`](../pr-12-2-tool-calls-estructural/plan.md).

- *(vacío)*
