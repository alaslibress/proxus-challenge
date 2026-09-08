# Funcionamiento actual del proyecto

Mapa de cómo funciona `proxus-challenge` **hoy**, verificado leyendo el código. Todas
las afirmaciones llevan ruta y línea. Sirve para dos cosas: que cualquiera entienda el
sistema antes de tocarlo, y que quede claro qué da por hecho la
[Tech Spec](./tech-spec.md) que en realidad no existe todavía.

---

## 1. Forma del monorepo

Cuatro paquetes pnpm. La dependencia va `web → shared ← server → ai-google`.

| Paquete | Qué es |
|---|---|
| `packages/shared` | Capa de contratos: definición `HttpApi` (`ProxusApi`) y schemas Effect. No importa ni server ni web. |
| `packages/server` | Node + Effect, en capas `transport → domain ← infra`. |
| `packages/web` | React 19 + Vite + Tailwind v4 + `@effect/atom-react`. |
| `packages/ai-google` | Copia vendorizada de `@effect/ai-google`. **Declarada como dependencia del server pero nadie la importa.** Peso muerto hoy. |

Effect v4 **beta**, `4.0.0-beta.83` pineado exacto en los cuatro paquetes, sin rangos.
`Schema` se importa del barrel raíz (`import { Schema } from "effect"`), no de
`effect/unstable/schema`. **No hay Zod en ninguna parte del repo.**

`tsconfig.json` raíz: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
`noUnusedLocals`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax` y
`rewriteRelativeImportExtensions`. Esto último obliga a que **todo import relativo lleve
la extensión `.ts`/`.tsx`**; se cumple al 100% en el código existente.

**Test runner**: `vitest@5` en `packages/server` (39 tests) y `packages/web` (10 tests). Suites:
- Server: `message.ts` constructores (7), `session.ts` funciones puras (7), `gemini.ts` encode/decode thoughtSignature (8), `tutor-chat-service.ts` buildMaterialsContext (5), `material.ts` saneado y colisión de nombres de fichero (12).
- Web: `stream.ts` `isAbortError` predicado (7), `resolveStreamFailure` parada vs fallo (3).
El gate sigue siendo `pnpm run typecheck`; los tests son la segunda capa.

---

## 2. Flujo de una petición de chat

```
Chat.tsx ──fetch POST /api/tutor/chat/stream──► server.ts (HttpRouter manual)
                                                    │
                                              TutorChatService.streamMessage
                                                    │
                                              AgentSession.execute  ← bucle de tools
                                                    │
                                              LanguageModel.generateText (Gemini)
                                                    │
   NDJSON ◄── Stream.map(encodeNdjson) ◄── Queue ◄──┘
```

- La ruta de streaming está **fuera** de `HttpApiBuilder`: es un `HttpRouter.add` a mano
  en `packages/server/src/transport/http/server.ts:30-48`, con el prefijo `/api`
  escrito literalmente porque el `.prefix("/api")` del `HttpApi` no le aplica.
  Consecuencia: no aparece en OpenAPI ni en `/docs`, y el cliente web la llama con
  `fetch` crudo en vez de con el `HttpApiClient` tipado.
- Los frames se producen en `server.ts:25-28`: `Schema.encodeSync` → `JSON.stringify` →
  `\n`. La unión de frames es de **solo dos miembros** hoy
  (`packages/shared/src/api/tutor.ts:19-28`):
  `{type:"message", message: AgentMessage}` y `{type:"done"}`.
- El consumidor genérico está en `packages/web/src/lib/ndjson.ts` (`readNdjson`, PR-05):
  buffer + `split("\n")` + `TextDecoder({stream:true})`, correcto con líneas partidas y
  UTF-8 partido. Cada línea se decodifica dentro de un `try/catch`: si una línea no
  encaja en la unión, se hace `console.warn` con la línea y **se continúa con la
  siguiente**, en vez de reventar el generador. `packages/web/src/domain/tutor/stream.ts`
  lo usa para el chat; el consumidor del streaming de intentos (Paso 6 de PR-05) queda
  pendiente porque ese paso quedó desactualizado tras el PR-10 y requiere que el thinker
  lo reescriba primero.
- **`AbortSignal` (PR-10)**: el cliente cancela la petición con `AbortController`. **El servidor sí cancela**, verificado midiendo: al cortar el cliente a los 7 s, el `http.span` cierra en ese instante, la llamada a Gemini en vuelo se queda sin respuesta y no se registra un `agent.step` más — igual por la ruta directa que a través del proxy de Vite. La cadena es `NodeHttpServer.ts:195-197` (interrumpe el fiber al cerrarse la conexión) → `Stream.callback` en `harness/session.ts:51` (ata el bucle al scope del stream) → `gemini.ts:335-341` (pasa el `signal` al `fetch`). `Stop` conserva los mensajes ya recibidos y **no** repuebla el input: es una parada limpia, no un deshacer (ver §7).

---

## 3. El harness del agente: exactamente dos tools

El modelo **no** ve el backend. Ve dos funciones (`domain/agents/harness/harness.ts:6-24`):

- `load_skill({ name })` → devuelve el texto completo de una skill.
- `cli({ input })` → ejecuta una cadena contra un parser CLI escrito a mano.

El system prompt (`harness.ts:52-62`) lista solo **nombres y descripciones de una línea**
de las skills; el contenido se expande bajo demanda. Las skills son texto, no tools.

**PR-11 (perf/agente-cortocircuito)**: el prompt del tutor se construye **por petición**, no una vez al levantar el layer. Cada llamada a `sendMessage`/`streamMessage` invoca `materialRepository.list()` y construye una sección `## Uploaded materials` con id, título y páginas de cada PDF. Si `list()` falla, el prompt indica que no hay materiales (el chat no cae). El prompt incluye reglas explícitas: responder directamente sin tool call cuando la pregunta es de conocimiento general, saludo, o la información ya está en la conversación; llamar a `materials view` solo con ids del inventario; **nunca** llamar a `materials list`. Esto elimina los dos round-trips innecesarios previos (load_skill + materials list) para preguntas directas. `maxSteps` bajó de 8 a 4 en el tutor (suficiente para `load_skill` + `artifacts create` + respuesta + margen).

El CLI (`harness/cli.ts`, 389 líneas) es un parser propio con `--help`, subcomandos,
tokenización con comillas y **argumentos posicionales por orden de clave** (no hay
flags). Los errores del CLI se devuelven al modelo como texto, no como fallo.

Comandos hoy:

```txt
materials list
materials view <materialId> <pages>        # 10, 13-20, 10,13-20
artifacts list [note|quiz|test]
artifacts show <artifactId>
artifacts create '<json>'
artifacts submit '<json>'
artifacts attempts [artifactId]
artifacts grade <attemptId>
```

**Añadir una capacidad = añadir un comando CLI o una skill, nunca una tool nueva.** El
motivo es duro: `gemini.ts:124-154` mapea los esquemas JSON de parámetros por nombre de
tool a mano, y el `default` es `{a: number, b: number}` (resto del agente de sumas de
ejemplo). Una tool nueva se anunciaría a Gemini con un esquema falso.

El bucle (`harness/session.ts:62-127`) es estrictamente secuencial, `maxSteps` por
defecto 8, y **usa `generateText` incluso en la ruta de streaming**: lo que se emite son
mensajes completos, no tokens. Termina cuando un paso no produce tool results.

Cada paso del bucle emite un log `agent.step` con el número de paso, las tool calls
invocadas, el número de tool results y los primeros 200 caracteres del texto de respuesta
(`session.ts:95-103`). Cada llamada a la API de Gemini emite un log `gemini.response` con
`finishReason`, tokens usados y los primeros 200 caracteres del texto de respuesta
(`gemini.ts`). Ningún log vuelca partes `file` (base64 de páginas de PDF).

Los dos tool handlers tienen timeout de 30 s (`harness.ts`): si se agota, el handler
devuelve un mensaje de texto al modelo en lugar de dejar el turno colgado.

**PR-12.2 (fix/tool-calls-estructural)**: `renderMessage` ya no existe. Las tool calls viajan como partes estructuradas a través de todo el pipeline:

- `renderPrompt` emite `{ role: "assistant", content: [{ type: "tool-call", id, name, params }] }` y `{ role: "tool", content: [{ type: "tool-result", id, name, isFailure, result }] }` (tipos `Prompt.ToolCallPartEncoded` / `Prompt.ToolResultPartEncoded` de Effect v4 beta).
- `messageParts` en `gemini.ts` los convierte directamente a `{ functionCall: { name, args } }` / `{ functionResponse: { name, response } }`. No hay regex de sincronización.
- `ToolCallMessage` guarda el `id` del tool call (`id?: string`). El id codifica la `thoughtSignature` de Gemini como `call_uuid||base64sig` para que sobreviva el transporte opaco de Effect y pueda inyectarse de vuelta en el historial (requerido por Gemini 2.5 Flash / gemini-3.6-flash). Ver `dificultades.md §PR-12.2 — Gemini exige thoughtSignature`.

La causa raíz del bug PR-12 está eliminada. La red de seguridad (`MALFORMED_FUNCTION_CALL` → reintento con `mode:ANY`) sigue activa.

Si el modelo falla, no se propaga: `session.ts:89-93` lo convierte en un mensaje de
asistente sintético ("I hit an internal model/tool-routing error…") y el stream termina
normal. El HTTP ya devolvió 200 y las cabeceras ya se enviaron.

`AgentMessage` está **declarado dos veces**: como schema en
`packages/shared/src/schemas/agent-message.ts:3-36` y como interfaces a mano en
`packages/server/src/domain/agents/harness/message.ts:1-28`. Además `renderMessage`
(`session.ts:155-197`) es un `switch` exhaustivo sin `default` bajo
`noFallthroughCasesInSwitch`. Añadir una variante toca tres sitios y rompe la
compilación en el cuarto. **Los eventos nuevos deben ir en la unión de frames
(`TutorChatStreamEvent`, discriminada por `type`), no en `AgentMessage`.**

---

## 4. El pipeline de PDF: imágenes y texto por página

`PdfService` tiene **tres métodos** (`domain/materials/pdf-service.ts`): `pageCount`,
`renderPage` y `extractPageText`. La implementación Poppler
(`infra/materials/poppler-pdf-service.ts`) exige `pdfinfo`, `pdftoppm` y `pdftotext` al
arrancar. Renderiza cada página con `pdftoppm -singlefile -f N -l N -r 144 -png`,
devolviendo un data-URL base64, y extrae texto con
`pdftotext -f N -l N -enc UTF-8 <path> -` (sin `-layout`, en orden de lectura).

Ese PNG viaja al prompt como parte `file` gracias al único caso multimodal del harness
(`session.ts:173-190`), que olfatea si un tool result es `MaterialPageImages`. El texto
viaja como tool result normal (`MaterialPageTexts`), sin necesitar ese caso multimodal.

**Extracción de texto sin RAG.** `pdftotext` da texto literal por página, pero no hay
chunking, embeddings, índice vectorial ni búsqueda: **sigue sin haber RAG**. La unidad de
evidencia es la página completa, no un chunk. Si la página es un escaneo sin capa de
texto, `pdftotext` devuelve vacío y el tutor debe caer a `materials view`.

`domain/materials/citation.ts` añade un verificador puro (`verifyQuote`,
`verifyCitations`) que comprueba si una cita del modelo aparece literalmente (tras
normalizar acentos, guiones de corte y espacios) en el texto de una página, con un
mínimo de 12 caracteres para evitar falsos positivos triviales.

Los PDFs viven en `packages/server/.data/materials/pdfs/`, y el id y el título salen del
nombre de fichero. `FileMaterialRepository` re-ejecuta `pdfinfo` por cada fichero en
**cada** `list`/`get`/`renderPages`/`extractText`.

---

## 5. Artifacts, intentos y corrección

Tres tipos de artifact: `note` (markdown), `quiz` (multiple-choice y true-false) y
`test` (añade `short-answer`). Un *attempt* es una unión de 4 miembros por
`artifactKind` × `status` (`ungraded` | `graded`); corregir es una transición de estado
que produce un objeto nuevo.

**La corrección base sigue siendo determinista y sin LLM** (`gradeAttempt` en
`packages/server/src/domain/artifacts/artifact.ts` nunca añade `LanguageModel` a su canal
`R`, así que la nota siempre existe aunque Gemini esté caído):

- Multiple-choice: `selectedOptionId === correctOptionId`.
- True-false: `answer === correctAnswer`.
- El "feedback" es el campo `explanation` que escribió el autor de la pregunta.
- Short-answer: igualdad exacta de strings tras `trim().toLowerCase()`
  (`correctQuestion`/`normalizeAnswer` en `artifact.ts`).

**Desde PR-04, short-answer ya no se queda ahí.** `POST /api/artifacts/:id/submit`
encadena, tras `gradeAttempt`, un `EvaluationEngineService`
(`packages/server/src/domain/evaluation/engine.ts`) que ejecuta un panel de tres agentes
Gemini —Profe Bueno, Profe Malo y Juez— en paralelo (`Effect.all({ mode: "result" })`,
nunca `Promise.all`) sobre el texto real de la página del PDF (`sourcePage` de la
pregunta, o todas las páginas del material si no hay `sourcePage`). El Juez devuelve
`FinalFeedbackSchema` (JSON estructurado con `citas_pdf`), y cada cita se verifica contra
el texto original con `verifyCitations` (PR-02). El veredicto del panel **solo sube** la
nota de una respuesta corta cuando hay al menos una cita `verified: true`; nunca la baja.
Sin evidencia (sin página, sin texto extraíble, o si el LLM falla) se conserva
íntegra la corrección `===` determinista — es la ruta de reserva declarada, una
desviación consciente del ADR-01 documentada en `planes/pr-04-evaluation-engine/plan.md`.
`reviewGradedAttempt` (`domain/evaluation/review.ts`) nunca falla: cualquier error del
panel se traga y el attempt determinista queda intacto. Multiple-choice y true-false no
pasan por el panel: siguen siendo 100% deterministas y sin latencia añadida.

**Desde PR-06, cada corrección de una short-answer deja traza en disco.** El motor
(`engine.ts`) devuelve, junto al veredicto, un borrador de `EvaluationTraceEntry`
(`domain/evaluation/trace.ts`) con el texto de cada profe o su motivo de fallo y el JSON
crudo del Juez; `review.ts` lo completa con la nota determinista, la nota final y si el
panel la modificó, y llama a `EvaluationTrace.record`. La implementación
(`infra/evaluation/file-evaluation-trace.ts`) formatea la entrada en Markdown legible
(`domain/evaluation/trace-format.ts`, función pura sin Effect) y la escribe en
`.data/sessions/<attemptId>.md` — un fichero por intento, una sección por pregunta.
`record` no tiene canal de error y escribe en un fiber desligado (`Effect.forkDetach`,
el único fork que existe en Effect v4 para esto: `forkChild`/`forkScoped` atarían la
escritura al scope de la petición HTTP), así que un directorio sin permisos o un fallo de
formateo nunca afecta a la corrección del alumno ni le añade latencia perceptible.

Se persiste en `.data/artifacts/attempts/<id>.json` desde
`infra/artifacts/file-artifact-repository.ts:149-155`.

Superficie HTTP:
- `GET /api/materials/` — lista materiales
- `GET /api/materials/:id` — obtiene un material
- `POST /api/materials` — sube un PDF (`multipart/form-data`, campo `file`, máx. 25 MB). Devuelve 200 con el `PdfMaterial`, o 400 tipado (`{"_tag":"InvalidPdf","message":"..."}`) si no es un PDF legible. El fichero se valida con `pdfinfo` **sobre el temporal, antes** de moverlo al directorio: un PDF ilegible dentro rompería `list`/`get`/`renderPages` para todos los materiales, no solo para él. El nombre se sanea (sin componentes de directorio, sin caracteres que el sistema de ficheros rechace) y las colisiones se resuelven con sufijo (`apuntes-2.pdf`), nunca sobrescribiendo
- `DELETE /api/materials/:id` — borra el PDF del disco (**PR-13**). Devuelve 204 si existe, 404 tipado (`{"_tag":"MaterialNotFound","materialId":"..."}`) si no. La ruta se resuelve por listing del repositorio, no por concatenación directa del id: path traversal imposible.
- `GET /api/artifacts/` — lista artifacts
- `GET /api/artifacts/:id` — obtiene un artifact
- `POST /api/artifacts/:id/submit` — encadena crear intento + corregir

**No hay endpoint de creación de artifacts**: crear artifacts solo se puede desde el agente.

El upload consume el multipart **como stream** (`asMultipartStream`), no bufferizado, y
`transport/http/upload.ts` escribe el temporal con un nombre propio. El motivo es
concreto: el decodificador bufferizado persiste el temporal con el nombre original del
cliente, así que un nombre con `: ? * " < > |` reventaba en Windows con un 500 antes de
que el saneado pudiera actuar — medido con `Tema 1: variables.pdf` y `Que es?.pdf`. Con el
stream, el nombre del cliente no toca nunca el sistema de ficheros: solo se usa, ya
saneado, para elegir el nombre definitivo dentro del directorio de materiales. El
directorio temporal se borra con `Effect.ensuring`, tanto si la subida acaba bien como si
no.

Los handlers de materiales usan `Effect.catchTag("MaterialRepositoryError", e => Effect.die(e))` para errores de infraestructura y `Effect.fail({...})` para errores de dominio tipados (404). Los demás handlers terminan en `Effect.orDie`: 500 sin canal tipado.

**Los artifacts no guardan de qué material salieron**: no hay `materialId` ni páginas de
origen. Sin ese enlace, nada puede saber qué texto habría que citar para justificar
una corrección.

Los schemas de artifacts (`Artifact`, `QuizQuestion`, `ArtifactAttempt`, etc.) viven
exclusivamente en `packages/shared/src/schemas/artifact.ts` (SSOT desde PR-01).
`packages/server/src/domain/artifacts/artifact.ts` contiene solo errores de dominio,
el puerto `ArtifactRepository` y las funciones `makeArtifact`, `gradeAttempt`, etc.
`AgentMessage` sigue declarado dos veces (schema en `shared` + interfaces en el harness) —
deuda conocida, fuera del alcance de PR-01.

---

## 6. Gemini

Adaptador escrito a mano, sin SDK: `fetch` contra
`generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
(`domain/agents/gemini.ts`). Modelo por defecto `gemini-3.6-flash` (**actualizado en sesión 8-sep-2026**; antes `gemini-2.5-flash`),
configurable con `GEMINI_MODEL`. Sin `GOOGLE_GENERATIVE_AI_API_KEY` el server no arranca.

El adaptador decodifica ahora `finishReason`, `usageMetadata` y `promptFeedback` de la
respuesta de Gemini. Valores a vigilar: `STOP` (normal), `MAX_TOKENS`, `SAFETY`,
`RECITATION`, `MALFORMED_FUNCTION_CALL`. Si aparece `thought: true` en alguna parte, el
modelo está devolviendo resúmenes de razonamiento (no esperado sin `includeThoughts`).

Tres límites que condicionan cualquier diseño:

1. **`streamText: () => Stream.empty`** (`:285`). El streaming a nivel de proveedor no
   existe. Lo que llega a la UI son mensajes completos del bucle del agente.
2. **Salida estructurada (PR-03).** El adaptador ahora honra `options.responseFormat`: si
   es `{ type: "json", schema, ... }`, `requestBody` añade
   `generationConfig: { responseMimeType: "application/json", responseSchema }`, con
   `responseSchema` derivado de `Schema.toJsonSchemaDocument` y saneado para el subconjunto
   OpenAPI que acepta Gemini (`resolveAllRefs` + `toGeminiResponseSchema` en
   `gemini-schema.ts`). En modo texto (`responseFormat.type === "text"`) el helper devuelve
   `undefined` y el cuerpo de la petición es idéntico al de antes del PR.
3. Solo se honra la **primera** function call de la respuesta, y si viene una function
   call se **descartan las partes de texto** que la acompañen (`:212-258`). Si el modelo
   inventa un nombre de función, se reinterpreta como `load_skill` con ese nombre.

---

## 7. Frontend

925 líneas en total, sin router y sin tests. Layout de una sola rejilla en `App.tsx`,
cuya tercera columna de 420px se la lleva el chat.

**Sistema visual** (PR-1.5, `feat/sistema-visual`): la UI tiene un sistema de tokens centralizado en
`packages/web/src/styles.input.css` (bloque `@theme` de Tailwind v4). El tema es **claro**
(fondo `#FBFAFE`, texto `#14102A`). Fuentes: Geist y Geist Mono desde Google Fonts.
El sidebar mide 252 px. Ningún componente usa clases de color literal de Tailwind;
todo el color viene de tokens del design system. Ver `documentacion/design-system.md`.

**PR-13 (fix/tool-calls-estructural, sesión 8-sep-2026)**:
- **Nombre del producto**: `My Favorite Teacher` (pestaña del navegador, logo M, sidebar). Los paquetes siguen siendo `@proxus/*`.
- **Borrado de materiales**: cada fila del sidebar tiene un botón `×` (siempre visible). El primer clic cambia a `Confirm`; el segundo borra. `Escape` o un clic fuera cancelan. La fila queda a `opacity-50` mientras la petición está en vuelo. Un error se muestra bajo la lista en `text-danger`.
- **Subida de PDFs**: `PdfUploader` aparece siempre al final de la sección de materiales, independientemente de cuántos PDFs haya ya. (Fix 95e1ef6 — la reescritura del PR-13 lo había eliminado accidentalmente.)
- **Cerrar artefacto**: `ArtifactWorkspace` tiene un botón `Close` en una cabecera *sticky*. `Escape` también cierra (excepto si el foco está en un `<input>` o `<textarea>`). Pulsar de nuevo el artefacto seleccionado en el sidebar lo cierra (toggle). La conversación del chat no se pierde.
- `deleteMaterialAction` usa `apiRuntime.fn` con `reactivityKeys: ["materials"]` — el mismo patrón que `submitArtifactAttemptAction`.

**El estado del chat vive en el hook `useTutorChat`** (PR-10, `domain/tutor/use-tutor-chat.ts`). El hook expone `messages`, `input`, `status` (`"idle"|"sending"`), `error`, `canRetry`, y las acciones `submit`, `stop`, `retry`, `clear`, `setInput`. `Chat.tsx` es pura presentación: no contiene lógica de red. `domain/tutor/atoms.ts` contiene un único action que apunta al endpoint **no** streaming y **no tiene ni un call site**: código muerto.

Los atoms que sí se usan son los de datos: `materialsQuery`, `artifactsQuery`,
`artifactQuery(id)` y `submitArtifactAttemptAction`, todos con
`Atom.withReactivity`. Cuando llega un tool result de `artifacts create|submit|grade` o
`materials import|delete|index`, `domain/tutor/invalidation.ts` dispara un refresh, emparejando call y result con una cola FIFO que asume que no hay tool calls en paralelo.

**Ciclo de vida del input (PR-10)**:
- `setInput("")` ocurre **antes** del primer `await` (en el mismo frame que `submit`), no tras el bucle.
- El textarea queda `disabled` durante la generación (`aria-busy`), con cursor `not-allowed` y placeholder *"Waiting for the tutor…"*.
- El botón conmuta entre `Send` (idle) y `Stop` (sending). `Stop` nunca va `disabled`.
- Un aborto (`Stop`) **conserva** los mensajes ya recibidos, deja el textarea vacío y no ofrece `Retry`: la parada es deliberada, no un fallo. Un fallo real sí revierte. La decisión vive en `resolveStreamFailure` (`domain/tutor/stream.ts`), una función pura testeada; el turno detenido se marca con una línea *"Stopped"* bajo el último mensaje.
- Un fallo deshace los mensajes parciales (vuelve al historial previo al envío) y restaura el texto. Si `canRetry` es `true`, aparece un botón `Retry`.
- `Enter` envía; `Shift+Enter` inserta salto de línea. Guard de IME (`isComposing`).
- Mientras `status === "sending"` y el último mensaje no es `assistant`, se muestra una burbuja de puntos animados (`animate-pulse`).
- El hook registra un `useEffect` de desmontaje con `abortRef.current?.abort()`.
- El contador de pasos, temporizador y auto-scroll son del PR-07.

**PR-07 (feat/ui-observabilidad): el workspace consume el streaming NDJSON del PR-05.**
`ExerciseSolver` (`ArtifactWorkspace.tsx`) ya no guarda `attempt`/`error`/`isSubmitting`
en `useState`: viven en `evaluationRunAtom(artifactId)`
(`domain/artifacts/evaluation-atoms.ts`), un `Atom.family` con las fases
`idle | running | done | error`. `answers` sigue siendo `useState`: es buffer de
formulario, no estado de razonamiento a observar. Al enviar, `submit()` consume
`streamAttemptSubmission` (PR-05, `domain/artifacts/attempt-stream.ts`) con un
`AbortController` propio; los frames `status` acumulan `activeStages` (Profe Bueno y
Profe Malo activos a la vez, sustituidos por el Juez en `deliberating`), `done` pasa a
`phase: "done"` y dispara `useAtomRefresh(artifactsQuery)` a mano —el `fetch` crudo del
streaming no lleva `reactivityKeys`, a diferencia de `submitArtifactAttemptAction`—, y
`error` pasa a `phase: "error"`. Si el `fetch` falla antes del primer frame (streaming
caído), cae a `submitArtifactAttemptAction` (modo promesa) como red de seguridad. El
panel en curso se pinta con `EvaluationProgress`
(`components/evaluation/EvaluationProgress.tsx`): tres filas fijas, `aria-live="polite"`,
sin porcentajes ni tiempos, y un botón Cancelar que aborta el stream y vuelve a `idle`.
El feedback del Juez se pinta con `ShortAnswerDetails`/`CitationList`
(`components/evaluation/CitationList.tsx`): las citas `verified: false` no llevan página
y se distinguen visualmente (color e icono distintos) de las verificadas, y si ninguna
cita quedó verificada se avisa que la nota es la automática. Multiple-choice y
true-false no cambian: no pasan por `review`.

El flujo de resolver un ejercicio está en `ArtifactWorkspace.tsx`: respuestas
en estado local, `submit` vía el streaming (con fallback a `submitArtifactAttemptAction`
en modo promesa), y al volver `graded` se pintan badges, explicaciones por pregunta,
feedback del Juez y citas, más un resumen de nota.

Gotcha de build: `vite.config.ts` tiene `root: "src"`, así que un directorio
`src/api/` se serviría como estático y **taparía el proxy `^/api(?:/|$)`**. Por eso el
cliente vive en `src/api-client/`. Tailwind v4 sí es plugin de Vite
(`@tailwindcss/vite`): `main.tsx` importa `styles.input.css` y no hay paso de CSS
aparte. Antes lo generaba el CLI en un segundo proceso orquestado con `sh -c`, lo que
rompía `pnpm run dev` en Windows (pnpm ejecuta los scripts con `cmd.exe`, que no tiene
`sh`); el plugin elimina ese proceso.

---

## 8. Evals

Hay **dos niveles**, y sólo el segundo cuesta dinero.

### 8.1 Suite determinista con vitest (sin API key, sin red)

`vitest ^5.0.0` es devDependency de `packages/server` y de `packages/web`, cada uno con su
`vitest.config.ts` (`environment: "node"`, `include: ["src/**/*.test.ts"]`) y sus scripts
`test` / `test:watch`. Desde la raíz: `pnpm run test` (alias de `pnpm -r test`). Hoy son
**15 ficheros y 137 tests**, todos deterministas y sin ninguna llamada de red.

El modelo falso vive aquí: `domain/evaluation/__tests__/engine.test.ts:16-51`
(`makeFakeLanguageModel`, con `generateText`, `generateObject`, `streamText` y fallos
guionizados por rol), y el `MaterialRepository` de fixtures en `review.test.ts:29-53`.
Cubren el motor de evaluación, la verificación de citas, la traza, el purgado de schemas
para Gemini, el lector NDJSON del navegador y el stream de evaluación.

Lo que **no** miden: la calidad de los prompts. Garantizan que ante una respuesta X del
Juez el sistema hace Y; para saber si el Juez es bueno hay que ir al nivel 2.

### 8.2 Eval con LLM real (requiere API key)

`evals/artifact-authoring.eval.ts` (504 líneas) es un script Effect a mano que se ejecuta
con `pnpm --filter @proxus/server run eval:tutor:artifact-authoring` y sale con código
distinto de cero si falla algún caso. **No hay flag para ejecutar un solo caso**: hay que
filtrar `dataset.cases` en el fichero.

Usa repositorios en memoria con ids deterministas, pero **llama a Gemini de verdad**
(`makeEvalLayer` mete `GeminiModel` en `:319-322`): **esta eval concreta no usa modelo
falso**; el modelo falso vive en la suite vitest (`engine.test.ts:16-51`). Tres criterios,
todos obligatorios: que se cree el artifact esperado con el número de preguntas esperado,
que la respuesta lo mencione (regex bilingüe y deliberadamente laxa) y que no haya tool
results fallidos.

En el mismo nivel 2, y también con API key, hay dos scripts sueltos:
`domain/evaluation/panel.check.ts` (`pnpm --filter @proxus/server run panel:check
<respuestaAlumno> <respuestaEsperada> <materialId> <página>`), que corre el panel entero
sobre un PDF real e imprime las dos críticas y el JSON del Juez —es lo **único** que mide
si los prompts son buenos—, y `domain/agents/structured-output.check.ts`
(`structured-output:check`), que comprueba `generateObject` contra Gemini. Ninguno de los
dos está automatizado; con una key de *free tier* chocan contra el límite diario
(`429 RESOURCE_EXHAUSTED`, limit 20). Anotado en `docs/testing.md`.

Los tres casos del dataset **no usan materiales**. Su repositorio falso **sí** tiene canal
de texto: `extractText` lee `MaterialPageFixture.text` (`:289-303`). El disfraz PNG afecta
**sólo a `renderPages`** (`:268-283`), que codifica ese mismo texto en base64 y lo hace
pasar por una imagen porque el canal de render espera un PNG.

---

## 9. Tabla de límites duros

Lo que la Tech Spec da por hecho y no existe:

| La spec asume | La realidad |
|---|---|
| `citas_pdf` con extractos literales | Conectado desde PR-04: el Juez del `EvaluationEngineService` (`domain/evaluation/engine.ts`) devuelve `citas_pdf` y cada una se verifica contra el texto de página real con `verifyCitations` (`domain/materials/citation.ts`). |
| "Contexto RAG del PDF", "chunks" | Sigue sin haber RAG: ni chunking, ni embeddings, ni índice, ni búsqueda. La unidad de evidencia es la página completa. |
| Refactorizar `TutorChatService` para el trío | En el chat no hay "correcciones" que citar. Las correcciones están en `artifact.ts`. |
| Zod / `@effect/schema` | Ni Zod ni `@effect/schema`: `Schema` del barrel `effect` v4 beta. |
| `packages/client/` | No existe. Es `packages/web/`. |
| "Actualizar los Effect Atom" del chat | Sigue siendo cierto para el chat: vive en cinco `useState` dentro de `domain/tutor/use-tutor-chat.ts`, no en `Chat.tsx` y no en atoms. **Ya no es cierto para el workspace** (PR-07): el estado de la evaluación vive en `evaluationRunAtom` (`Atom.family`), aunque `answers` sigue en `useState` a propósito. |
| Streaming de razonamiento | `streamText` es `Stream.empty`. Solo hay eventos de mensaje completo. |

Y dos cosas más que hay que saber antes de probar nada:

- **`packages/server/.data/` no existe en un checkout limpio.** Hay que colocar un PDF en
  `packages/server/.data/materials/pdfs/` antes de que la QA manual signifique algo.
- ~~Todo lo que toque el protocolo NDJSON debe cambiar server y web en el mismo PR~~
  **Eliminado desde PR-05**: `readNdjson` salta las líneas que no decodifican en vez de
  reventar, así que un frame nuevo que el cliente todavía no conoce ya no rompe el stream.
