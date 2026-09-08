# PR-11 — Cortocircuito de herramientas y latencia percibida

- **Rama**: `perf/agente-cortocircuito`
- **Depende de**: PR-09 (el inventario de materiales sólo es interesante si se pueden
  subir) y PR-10 (la señal de "pensando" ya existe en la UI).
- **Orden de ejecución**: después del PR-10 y **antes del PR-02**.
- **Conflicto conocido**: toca `academic-tutor.ts`, `tutor-chat-service.ts` y las dos
  skills. El PR-04 añade prompts nuevos en `domain/evaluation/`, un módulo distinto: no
  colisiona. **Ningún PR del roadmap toca estos ficheros.**
- **Bloquea a**: nada.
- **Estado**: borrador
- **Contiene LLM**: **sí, y es el núcleo del PR.** Cambia el system prompt del tutor y las
  descripciones de las dos skills. Todo cambio aquí es no determinista: ver *Checks*.
- **Origen**: hallazgo de latencia. No sale de los ADR.

> Normas de trabajo en [`../plan.md`](../plan.md). Contexto técnico obligatorio en
> [`../../documentacion/contexto-repo.md`](../../documentacion/contexto-repo.md) y
> [`../../documentacion/funcionamiento-actual.md`](../../documentacion/funcionamiento-actual.md).
> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.

---

## Problema

Una pregunta directa tarda decenas de segundos porque el agente encadena
`load_skill` → `cli materials list` → `cli artifacts list` → … antes de contestar. La
causa no es el transporte. Es aritmética del bucle.

### Lo que sí está roto

**1. Cada tool call cuesta una llamada completa al modelo.** El bucle
(`harness/session.ts:80-113`) es estrictamente secuencial y usa `LanguageModel.generateText`,
no streaming. Además `gemini.ts:218-258` (`toResponseParts`) honra **sólo la primera**
function call de cada respuesta. Resultado: *N* tool calls = *N+1* peticiones HTTP a
`generateContent`, una detrás de otra. Con `maxSteps` a 8, el techo son 8 round-trips.

**2. El prompt empuja a cargar skills, y nunca dice cuándo no hacerlo.** El system prompt
completo son dos trozos concatenados, y no hay más en todo el repo:

- `academic-tutor.ts:20-23` — la persona (4 líneas).
- `harness/harness.ts:52-62` — la plantilla del harness, que incluye literalmente:
  *"When a task matches a skill description, call the load_skill tool with the skill
  name"*.

No hay una sola frase sobre responder directamente.

**3. Las descripciones de las skills enganchan con casi todo.** Son lo único que el
modelo ve antes de decidir (`harness.ts:81-82`, `skillsHelp`):

```
- use-uploaded-materials: Use uploaded PDF materials by listing them and rendering exact page ranges as images before answering material-specific questions.
- create-study-artifacts: Create and manage study artifacts: markdown notes, quizzes, tests, submissions, and graded attempts.
```

*"notes, slides, readings"* casa con cualquier pregunta de estudio. Y el cuerpo de la
skill refuerza el bucle: `use-uploaded-materials.ts` §Workflow paso 1 dice *"If you do not
know the material id, call `cli({ "input": "materials list" })`"*, y
`create-study-artifacts.ts:37` dice *"For artifacts based on uploaded materials, inspect
the uploaded material first."*

**4. El agente no puede saber si hay materiales sin gastar dos round-trips.** El prompt no
lleva ningún dato de materiales: `AgentHarness.make` (`harness.ts:39-78`) sólo recibe
`name`, `skills` y `commands`; los repositorios quedan capturados dentro de los handlers
del CLI, nunca se leen al construir el prompt. Para descubrir que hay cero PDFs, el modelo
tiene que hacer `load_skill` → `cli materials list` → leer `"No PDF materials found."`
(`material-commands.ts:30`). **Dos llamadas a Gemini para averiguar un dato que la web ya
tiene en el sidebar** (`Sidebar.tsx:12`, `GET /api/materials`).

**5. Coste que crece con los pasos.** `renderPrompt` (`session.ts:144-153`) reconstruye el
prompt entero en cada iteración con `allMessages()`. Cuando se han renderizado páginas,
cada paso reenvía **todas** las imágenes base64 anteriores (`session.ts:173-190` →
`gemini.ts:82-100`). Más pasos no es sólo más latencia: es más tokens por paso.

### Lo que NO está roto — corrección del diagnóstico

El diagnóstico original incluía *"asegurar que los eventos NDJSON lleguen de forma
inmediata"*. **Ya llegan.** Verificado extremo a extremo:

- `session.ts:77` emite el eco del mensaje del usuario **antes** del primer
  `generateText`, así que la primera línea NDJSON se escribe nada más parsear el body.
- `HttpServerResponse.stream` escribe cabeceras al empezar y hace `write()` por elemento,
  con backpressure por latch (`@effect/platform-node/src/NodeHttpServer.ts:598-623`). Sin
  `Content-Length`, transfer-encoding chunked.
- La ruta ya manda `cache-control: no-cache` y `x-accel-buffering: no`
  (`server.ts:41-44`), y el proxy de Vite no bufferiza.
- El lector del cliente (`stream.ts:26-53`) es incremental y correcto.

**No hay buffering que quitar.** Lo que hay es granularidad: entre el eco del usuario y la
respuesta no se emite nada porque `streamText` de Gemini es `Stream.empty`
(`gemini.ts:285`) y el bucle sólo publica mensajes completos. La latencia percibida se
ataca con menos round-trips —este PR— y con estados visibles —el PR-07—, no tocando el
transporte.

## Objetivo

Que una pregunta que no necesita mirar un PDF se conteste en **una sola** llamada al
modelo, y que el agente sepa qué materiales existen sin preguntar.

## Fuera de alcance

- **Streaming de tokens.** Decisión cerrada (`plan.md` §6, decisión 6; ADR-02 §1).
  `gemini.ts:285` seguirá siendo `Stream.empty`.
- **Tool calls en paralelo.** Exigiría reescribir `toResponseParts`
  (`gemini.ts:218-258`), que hoy descarta todas las function calls menos la primera.
- **Frames NDJSON nuevos.** Cambiar la unión mueve server y web a la vez (límite duro de
  `plan.md` §9) y pisa el PR-05. Los estados de fase son del PR-05/PR-07.
- **Caché de `pdfinfo`.** Ver *Riesgos y decisiones*.
- **Tools nuevas.** El repo tiene dos y añadir una obliga a tocar el `switch` hardcodeado
  de `gemini.ts:124-154`. No hace falta ninguna.
- **Reducir el reenvío de imágenes entre pasos.** Deuda anotada, no se toca aquí.

## Contratos afectados

**Ninguno en `packages/shared`.** Este PR es prompt, orden de construcción del harness y
un default numérico.

Cambio de firma interno del servidor:

```ts
// domain/agents/academic-tutor.ts — antes
export const makeAcademicTutorHarness = (
  materialRepository: MaterialRepository,
  artifactRepository: ArtifactRepository
) => AgentHarness.make({ ... })

// después
export const makeAcademicTutorHarness = (
  materialRepository: MaterialRepository,
  artifactRepository: ArtifactRepository,
  materialsContext: string
) => AgentHarness.make({ ... })
```

## Pasos

### Paso 0 — Comprobación previa

1. [ ] `git switch -c perf/agente-cortocircuito` sobre la rama con el PR-10 dentro.
2. [ ] **Medir antes de tocar nada.** Con al menos un PDF subido y `GOOGLE_GENERATIVE_AI_API_KEY`
       puesta, ejecutar y anotar el tiempo y el número de `tool-call` de cada una:

   ```bash
   time pnpm --filter @proxus/server run agent:tutor "¿qué es una derivada?"
   time pnpm --filter @proxus/server run agent:tutor "hola, ¿qué puedes hacer?"
   time pnpm --filter @proxus/server run agent:tutor "resume la página 3 de mis apuntes"
   ```

   Estos tres números son la línea base y **van en el cuerpo del PR**. Sin ellos no hay
   forma de afirmar que el PR mejora algo.
3. [ ] Repetir la misma medición al final. Si no mejora, **para y notifica**: el problema
       está en otro sitio.

### Paso 1 — Inventario de materiales en el prompt

El harness se construye **una vez**, al levantar el layer (`tutor-chat-service.ts:26-28`),
así que hoy el prompt es estático. Hay que construirlo por petición.

En `packages/server/src/domain/agents/academic-tutor/tutor-chat-service.ts`:

1. [ ] Sacar `makeAcademicTutorHarness` y `AgentSession.make` del cuerpo del
       `Layer.effect` y meterlos en un helper por petición:

   ```ts
   const materialsContext = Effect.gen(function* () {
     const materials = yield* materialRepository.list().pipe(
       Effect.orElseSucceed(() => [] as const)
     );
     return materials.length === 0
       ? "No PDF materials have been uploaded yet."
       : materials
           .map((m) => `- ${m.id}: "${m.title}" (${m.pageCount} pages)`)
           .join("\n");
   });

   const makeSession = Effect.gen(function* () {
     const harness = makeAcademicTutorHarness(
       materialRepository,
       artifactRepository,
       yield* materialsContext
     );
     return { harness, session: AgentSession.make(harness) };
   });
   ```

2. [ ] `sendMessage`: `Effect.flatMap(makeSession, ({ harness, session }) => session.run(...).pipe(Effect.provide(harness.layer)))`.
3. [ ] `streamMessage`: como devuelve un `Stream`, envolver con `Stream.unwrap`:

   ```ts
   streamMessage: (input) => Stream.unwrap(
     Effect.map(makeSession, ({ harness, session }) =>
       session.stream(sessionInput(input)).pipe(
         Stream.map((message): TutorChatStreamEvent => ({ type: "message", message })),
         Stream.concat(Stream.succeed({ type: "done" as const })),
         Stream.provide(harness.layer)
       ))
   )
   ```

   **Verificar que `Stream.unwrap` existe en `effect@4.0.0-beta.83`** antes de usarlo. Si
   no está, `Stream.flatMap` sobre `Stream.fromEffect(makeSession)` es equivalente. **Si
   ninguna de las dos está, para y notifica.**
4. [ ] `list()` no puede tumbar el chat: el `Effect.orElseSucceed` del punto 1 no es
       opcional. Si el disco falla, el agente responde sin inventario, no con un 500.
5. [ ] `pnpm run typecheck`.

### Paso 2 — El system prompt del tutor

En `packages/server/src/domain/agents/academic-tutor.ts`, sustituir el `name` actual
(`:20-23`) por este texto **exacto**. Va en inglés porque el resto del prompt y de las
skills lo está, y mezclar idiomas en un system prompt empeora el seguimiento de
instrucciones.

```ts
  name: `You are an academic tutor agent.

You help students understand academic material, especially their uploaded PDF materials.
Be precise, pedagogical, and honest about what you can infer from the available materials.

## Answer directly, without any tool call, when

- The question can be answered from general academic knowledge: definitions, worked
  examples, explanations, study techniques.
- The user is greeting you, thanking you, or asking what you can do.
- No PDF materials are uploaded (see the inventory below) and the user is not asking you
  to create, list, or grade an artifact.
- The information you need is already in this conversation, including results of tool
  calls from earlier turns.

Answering directly is the default. A tool call must earn its place.

## Use a tool only when

- \`cli({"input": "materials view <id> <pages>"})\`: the answer depends on what a specific
  PDF actually says, and the inventory below already tells you the id exists.
- \`cli({"input": "artifacts ..."})\`: the user asked you to create, list, show, submit or
  grade a note, quiz or test.
- \`load_skill\`: immediately before performing the workflow that skill describes. Never
  load a skill to decide whether to answer.

## Hard rules

- Never call \`materials list\`. The inventory below is current for this turn.
- Never chain a second tool call unless the first result told you something you still
  need.
- If a tool fails, say so plainly in one line and answer with what you know.
- Each tool call costs the student several seconds of waiting. Spend them deliberately.

## Uploaded materials

${materialsContext}`,
```

1. [ ] Interpolar el tercer parámetro `materialsContext` justo ahí, al final.
2. [ ] **No tocar `harness/harness.ts`.** Su plantilla (`:52-62`) es genérica y la
       comparten los agentes `math` y `sum`. Las reglas del tutor van en la persona del
       tutor. Nótese que la plantilla genérica concatena **después** su párrafo de
       skills, así que el prompt final termina con el bloque del harness; es aceptable y
       evita tocar tres agentes.
3. [ ] `pnpm run typecheck`.

### Paso 3 — Descripciones de skills que no enganchen de más

Las descripciones son lo único visible antes de cargar la skill, así que son el filtro
real.

1. [ ] `skills/use-uploaded-materials.ts:5`, sustituir:

   - Antes: `"Use uploaded PDF materials by listing them and rendering exact page ranges as images before answering material-specific questions."`
   - Después: `"Render exact page ranges of an already-identified uploaded PDF as images. Only for questions that depend on what a specific PDF says."`

2. [ ] `skills/use-uploaded-materials.ts`, cuerpo: eliminar el paso 1 del *Workflow*
       (*"If you do not know the material id, call `cli({ "input": "materials list" }`"*)
       y sustituirlo por: `"1. Take the material id from the inventory in your system prompt."`
       Renumerar el resto. Quitar también la línea `- \`materials list\`: ...` de la lista
       de comandos disponibles de la skill.
       **El comando `materials list` sigue existiendo en el CLI**
       (`material-commands.ts:22-41`): no se borra, sólo se deja de anunciar. Es la red de
       seguridad si el inventario falla.

3. [ ] `skills/create-study-artifacts.ts:5`, sustituir:

   - Antes: `"Create and manage study artifacts: markdown notes, quizzes, tests, submissions, and graded attempts."`
   - Después: `"Create, list, submit or grade study artifacts (notes, quizzes, tests). Only when the user asks for one of those actions."`

4. [ ] `skills/create-study-artifacts.ts:37`, sustituir el paso 1 del *Workflow*:

   - Antes: `"1. For artifacts based on uploaded materials, inspect the uploaded material first."`
   - Después: `"1. If the user asks for an artifact about a specific uploaded PDF, render the relevant pages first. If they ask for one about a general topic, write it from your own knowledge."`

   Motivo: la frase actual obliga a inspeccionar material aunque el usuario haya pedido
   *"un quiz de derivadas"* sin mencionar ningún PDF.

### Paso 4 — Bajar el techo de pasos

1. [ ] `tutor-chat-service.ts:33`: `maxSteps: input.maxSteps ?? 4`.
2. [ ] `harness/session.ts:80`: dejar el `?? 8` como está. Es el default del harness
       genérico y lo comparten los agentes de demo; el tutor ya pasa el suyo.
3. [ ] El cliente ya no manda `maxSteps` desde el PR-10 §Paso 2.4. Verificar con
       `grep -rn "maxSteps" packages/web/src` → 0 aciertos.
4. [ ] `academic-tutor.ts:54` (el runner de CLI) baja también a 4, para que la medición
       del Paso 0 sea comparable con lo que hace la web.

   Justificación del 4: crear un artifact es el caso más largo y necesita
   `load_skill` + `artifacts create` + respuesta = 3 pasos. Cuatro deja un paso de margen.
   Ocho sólo permitía que un agente perdido gastara ocho llamadas antes de rendirse, y en
   ese caso `session.ts:116-119` devuelve el último tool result crudo como si fuera la
   respuesta del tutor, que es peor que fallar.

### Paso 5 — Verificar que no se rompe la autoría de artifacts

1. [ ] `pnpm --filter @proxus/server run eval:tutor:artifact-authoring` (necesita API key).
       Es el único eval que existe hoy y ejercita justo el camino que este PR desincentiva:
       crear artifacts. **Tiene que seguir pasando.**
2. [ ] Si falla por falta de pasos, subir el default a 5 y volver a medir. **No** relajar
       las reglas del prompt: el eval es la señal de que el cortocircuito se pasó de
       frenada, y el número de pasos es la palanca menos invasiva.
3. [ ] Si no hay API key, **decirlo explícitamente en el cuerpo del PR**: `docs/testing.md`
       lo exige.

### Paso 6 — Documentación

1. [ ] `docs/ai-agent.md`: documentar el bloque de inventario y las reglas de
       cortocircuito, y que el prompt del tutor pasa a construirse por petición.
2. [ ] `documentacion/funcionamiento-actual.md` §3 y §5: la afirmación de que el prompt es
       estático y de que el agente no tiene contexto de materiales deja de ser cierta.
3. [ ] En el cuerpo del PR, la tabla de medición antes/después del Paso 0.
4. [ ] **`documentacion/dificultades.md`** — entrada del PR-11 con el formato del PR-09
       §Paso 9. Candidatas: el harness construido una sola vez en el layer, `Stream.unwrap`,
       el modelo ignorando la regla de no llamar a `materials list`, el eval de artifacts
       rompiéndose por `maxSteps`.

## Criterio de aceptación

- [ ] *"¿qué es una derivada?"* se responde **sin ningún `tool-call`** y en una sola
      llamada al modelo.
- [ ] *"hola, ¿qué puedes hacer?"* se responde sin ningún `tool-call`.
- [ ] Con cero PDFs subidos, *"¿tengo materiales?"* se responde sin `tool-call`, y la
      respuesta dice que no hay ninguno.
- [ ] Con un PDF subido, *"¿qué materiales tengo?"* se responde sin `tool-call`, citando
      el título y el número de páginas correctos.
- [ ] *"resume la página 3 de mis apuntes"* hace **un** `materials view`, sin
      `materials list` previo.
- [ ] Un PDF subido durante la sesión aparece en el inventario del **siguiente** mensaje,
      sin reiniciar el servidor.
- [ ] El tiempo del caso *"¿qué es una derivada?"* baja de forma medible respecto a la
      línea base del Paso 0, y los tres tiempos van en el cuerpo del PR.
- [ ] `eval:tutor:artifact-authoring` sigue pasando (o se declara que no se pudo ejecutar
      por falta de API key).
- [ ] Crear un quiz desde el chat sigue funcionando de punta a punta.
- [ ] `grep -rn "maxSteps" packages/web/src` → 0 aciertos.
- [ ] El fallo de `materialRepository.list()` no tumba el chat.
- [ ] `documentacion/dificultades.md` tiene al menos una entrada del PR-11.

## Checks

```bash
pnpm run typecheck
pnpm --filter @proxus/web run build

# requieren GOOGLE_GENERATIVE_AI_API_KEY
time pnpm --filter @proxus/server run agent:tutor "¿qué es una derivada?"
time pnpm --filter @proxus/server run agent:tutor "hola, ¿qué puedes hacer?"
time pnpm --filter @proxus/server run agent:tutor "resume la página 3 de mis apuntes"
pnpm --filter @proxus/server run eval:tutor:artifact-authoring

# el prompt lleva el inventario y los frames salen de uno en uno
curl -N -X POST http://localhost:3000/api/tutor/chat/stream \
  -H 'content-type: application/json' \
  -d '{"input":"¿qué materiales tengo?","messages":[]}'
```

En el `curl -N`, contar las líneas `"role":"tool-call"`: el criterio de aceptación es
**cero** para esa pregunta.

## QA manual

1. Con `.data/materials/pdfs` **vacío** y el server levantado, preguntar en el chat
   *"¿tengo materiales?"*. No debe aparecer ninguna fila de tool call en la conversación.
2. Subir un PDF con el uploader del PR-09. Sin recargar, preguntar *"¿qué materiales
   tengo?"*: responde con el título y las páginas, otra vez sin tool calls.
3. Preguntar *"resume la página 2"*: una sola fila `Tool call: cli` con
   `materials view`, sin `materials list`.
4. Pedir *"crea un quiz de 3 preguntas sobre derivadas"*: se crea y aparece en el sidebar.
5. Pedir *"crea un quiz sobre la página 2 de mis apuntes"*: renderiza la página y crea el
   quiz dentro del techo de 4 pasos.
6. Comparar a ojo la espera del caso 1 con la de antes del PR: debe ser una sola llamada.

## Riesgos y decisiones

- **Un prompt no es un contrato.** Nada garantiza que Gemini obedezca *"never call
  materials list"*. Por eso el PR no borra el comando ni cambia el harness: si el modelo
  desobedece, funciona igual, sólo más lento. Las reglas son incentivos, y el eval más las
  tres mediciones son la única verificación posible.

- **El inventario cuesta un `pdfinfo` por PDF y por mensaje.** `FileMaterialRepository.list()`
  vuelve a lanzar `pdfinfo` por cada fichero en cada llamada
  (`file-material-repository.ts:26-53`). Con menos de 20 PDFs son decenas de milisegundos
  contra los segundos de un round-trip a Gemini: el cambio sale a cuenta con mucho margen.
  **Decisión: se acepta y se anota.** La caché por `mtime` es un PR aparte y no bloquea
  éste. Si alguien mete cientos de PDFs, esto se nota y hay que hacerla.

- **Construir el harness por petición.** Es un objeto con closures y un `Toolkit.toLayer`;
  su coste es despreciable frente a la llamada al modelo. A cambio, el prompt puede llevar
  estado fresco. Nótese que `Stream.provide(harness.layer)` ya se ejecutaba por petición
  (`tutor-chat-service.ts:43`): lo único que se mueve es la construcción del prompt.

- **`maxSteps: 4` puede quedarse corto en flujos que aún no existen.** Si el PR-04 añade
  un camino que necesite más pasos desde el chat, subirlo es una línea. Se prefiere
  empezar apretado: hoy agotar el techo produce una respuesta **peor** que fallar, porque
  `session.ts:116-119` devuelve el último tool result stringificado como respuesta del
  tutor.

- **Prompt en inglés con usuarios en español.** El system prompt ya está en inglés y el
  modelo responde en el idioma del usuario. Traducirlo sería un cambio grande sin
  evidencia de mejora.

- **No se toca el transporte.** Explicado en *Problema*: no hay buffering. Cualquier
  cambio en `server.ts:30-47` sería trabajo sin efecto y pisaría el PR-05.

- **Deuda anotada, no resuelta aquí**: cada paso del bucle reenvía todas las imágenes
  base64 anteriores (`session.ts:83` + `:173-190`). Reducir pasos mitiga el síntoma; el
  arreglo real es no reenviar los adjuntos ya consumidos, y eso toca `renderPrompt`, que
  es territorio del harness.

## Historial

- **Tras el PR-12**: el PR-12 (`fix/fuga-tool-calls`) se implementa antes y añade al
  system prompt del tutor un bloque de reglas sobre el formato de las tool calls. **El
  Paso 2 de este plan debe fusionarse con ese bloque, no sustituirlo.** El thinker lo
  reescribe tras el merge del PR-12.

- *(vacío)*
