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

No hay test runner. No hay eslint ni biome. El gate es `pnpm run typecheck`.

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
- El consumidor está en `packages/web/src/domain/tutor/stream.ts`: buffer + `split("\n")`
  + `TextDecoder({stream:true})`, correcto con líneas partidas y UTF-8 partido. Pero
  decodifica con **`Schema.decodeUnknownSync`**, que lanza: **un frame de tipo
  desconocido revienta el generador y mata el stream entero**. Server y web tienen que
  desplegarse juntos ante cualquier cambio de protocolo.
- No hay `AbortSignal`: no se puede cancelar una petición en curso.

---

## 3. El harness del agente: exactamente dos tools

El modelo **no** ve el backend. Ve dos funciones (`domain/agents/harness/harness.ts:6-24`):

- `load_skill({ name })` → devuelve el texto completo de una skill.
- `cli({ input })` → ejecuta una cadena contra un parser CLI escrito a mano.

El system prompt (`harness.ts:52-62`) lista solo **nombres y descripciones de una línea**
de las skills; el contenido se expande bajo demanda. Las skills son texto, no tools.

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

## 4. El pipeline de PDF: solo imágenes

`PdfService` tiene **dos métodos** (`domain/materials/pdf-service.ts:8-15`):
`pageCount` y `renderPage`. La implementación Poppler
(`infra/materials/poppler-pdf-service.ts`) exige `pdfinfo` y `pdftoppm` al arrancar y
renderiza cada página con `pdftoppm -singlefile -f N -l N -r 144 -png`, devolviendo un
data-URL base64.

Ese PNG viaja al prompt como parte `file` gracias al único caso multimodal del harness
(`session.ts:173-190`), que olfatea si un tool result es `MaterialPageImages`.

**No existe extracción de texto.** Ni `pdftotext`, ni `pdf-parse`, ni `pdfjs`, ni OCR.
Y por tanto tampoco hay chunking, embeddings, índice vectorial ni búsqueda: **no hay
RAG**. La "recuperación" consiste en que el modelo adivine un rango de páginas y pida
verlas como imagen.

Los PDFs viven en `packages/server/.data/materials/pdfs/`, y el id y el título salen del
nombre de fichero. `FileMaterialRepository` re-ejecuta `pdfinfo` por cada fichero en
**cada** `list`/`get`/`renderPages`.

---

## 5. Artifacts, intentos y corrección

Tres tipos de artifact: `note` (markdown), `quiz` (multiple-choice y true-false) y
`test` (añade `short-answer`). Un *attempt* es una unión de 4 miembros por
`artifactKind` × `status` (`ungraded` | `graded`); corregir es una transición de estado
que produce un objeto nuevo.

**La corrección de hoy es 100% determinista y sin LLM.** Vive en
`packages/server/src/domain/artifacts/artifact.ts`, entrando por `gradeAttempt` (`:90`):

- Multiple-choice: `selectedOptionId === correctOptionId`.
- True-false: `answer === correctAnswer`.
- El "feedback" es el campo `explanation` que escribió el autor de la pregunta.
- **Short-answer: igualdad exacta de strings tras `trim().toLowerCase()`** (`:207`, `:222`).
  Sin semántica, sin nota parcial, sin rúbrica, sin normalizar acentos ni puntuación.
  Es el agujero de producto más evidente del repo.

Se persiste en `.data/artifacts/attempts/<id>.json` desde
`infra/artifacts/file-artifact-repository.ts:149-155`.

Superficie HTTP: `GET /api/artifacts/`, `GET /api/artifacts/:id` y
`POST /api/artifacts/:id/submit` (que encadena crear intento + corregir). **No hay
endpoint de creación de artifacts ni de subida de materiales**: crear artifacts solo se
puede desde el agente. El repositorio de dominio es bastante más rico que la API.

Todos los handlers terminan en `Effect.orDie` (`transport/http/handlers.ts`): los errores
de dominio se convierten en defectos, o sea 500 sin canal de error tipado. Ningún
endpoint declara `error:` en su schema.

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
(`domain/agents/gemini.ts:121-122`). Modelo por defecto `gemini-2.5-flash`,
configurable con `GEMINI_MODEL`. Sin `GOOGLE_GENERATIVE_AI_API_KEY` el server no arranca.

Tres límites que condicionan cualquier diseño:

1. **`streamText: () => Stream.empty`** (`:285`). El streaming a nivel de proveedor no
   existe. Lo que llega a la UI son mensajes completos del bucle del agente.
2. **El cuerpo de la petición no incluye `generationConfig`** (`:205-210`): hoy es
   imposible pedir `responseMimeType: "application/json"` o `responseSchema`. **No hay
   salida estructurada.** (Irónicamente, la copia vendorizada sin usar de
   `packages/ai-google` sí los declara.)
3. Solo se honra la **primera** function call de la respuesta, y si viene una function
   call se **descartan las partes de texto** que la acompañen (`:212-258`). Si el modelo
   inventa un nombre de función, se reinterpreta como `load_skill` con ese nombre.

---

## 7. Frontend

925 líneas en total, sin router y sin tests. Layout de una sola rejilla en `App.tsx`,
cuya tercera columna de 420px se la lleva el chat.

**El estado del chat no está en atoms**: son cuatro `useState` dentro de
`Chat.tsx:18-24`. `domain/tutor/atoms.ts` contiene un único action que apunta al
endpoint **no** streaming y **no tiene ni un call site**: código muerto.

Los atoms que sí se usan son los de datos: `materialsQuery`, `artifactsQuery`,
`artifactQuery(id)` y `submitArtifactAttemptAction`, todos con
`Atom.withReactivity`. Cuando llega un tool result de `artifacts create|submit|grade` o
`materials import|delete|index`, `domain/tutor/invalidation.ts` dispara un refresh
(`Chat.tsx:49-61`), emparejando call y result con una cola FIFO que asume que no hay
tool calls en paralelo.

**Observabilidad del razonamiento hoy: prácticamente ninguna.** El botón de enviar
cambia a `"Thinking…"` (`Chat.tsx:135`) y aparecen filas `<details>` con volcados JSON
crudos de tool calls y results (`:142-154`), sin distinguir siquiera si el result fue un
fallo. No hay burbuja de pendiente, ni contador de pasos, ni temporizador, ni botón de
parar, ni auto-scroll.

El flujo de resolver un ejercicio está en `ArtifactWorkspace.tsx` (380 líneas): respuestas
en estado local, `submit` vía `submitArtifactAttemptAction` en modo promesa, y al volver
`graded` se pintan badges y explicaciones por pregunta más un resumen de nota.

Gotcha de build: `vite.config.ts` tiene `root: "src"`, así que un directorio
`src/api/` se serviría como estático y **taparía el proxy `^/api(?:/|$)`**. Por eso el
cliente vive en `src/api-client/`. Y Tailwind no es plugin de Vite: `styles.generated.css`
lo genera el CLI desde los scripts del paquete, y está en `.gitignore`.

---

## 8. Evals

No hay framework: `evals/artifact-authoring.eval.ts` (473 líneas) es un script Effect a
mano que se ejecuta con `pnpm --filter @proxus/server run eval:tutor:artifact-authoring`
y sale con código distinto de cero si falla algún caso. **No hay flag para ejecutar un
solo caso**: hay que filtrar `dataset.cases` en el fichero.

Usa repositorios en memoria con ids deterministas, pero **llama a Gemini de verdad**: no
existe un `LanguageModel` falso. Tres criterios, todos obligatorios: que se cree el
artifact esperado con el número de preguntas esperado, que la respuesta lo mencione
(regex bilingüe y deliberadamente laxa) y que no haya tool results fallidos.

Los tres casos del dataset **no usan materiales**. El schema de fixture ya contempla
`pages: {page, text}[]`, pero el repositorio falso codifica ese texto en base64 y lo
hace pasar por un PNG: finge el canal de imagen porque no hay canal de texto.

---

## 9. Tabla de límites duros

Lo que la Tech Spec da por hecho y no existe:

| La spec asume | La realidad |
|---|---|
| `citas_pdf` con extractos literales | No hay extracción de texto de PDF. Solo páginas rasterizadas. |
| "Contexto RAG del PDF", "chunks" | No hay RAG: ni chunking, ni embeddings, ni índice, ni búsqueda. |
| Refactorizar `TutorChatService` para el trío | En el chat no hay "correcciones" que citar. Las correcciones están en `artifact.ts`. |
| Zod / `@effect/schema` | Ni Zod ni `@effect/schema`: `Schema` del barrel `effect` v4 beta. |
| `packages/client/` | No existe. Es `packages/web/`. |
| "Actualizar los Effect Atom" del chat | El estado del chat no está en atoms, está en `useState`. |
| JSON estructurado del LLM | `gemini.ts` no envía `generationConfig`; `responseSchema` es inalcanzable. |
| Streaming de razonamiento | `streamText` es `Stream.empty`. Solo hay eventos de mensaje completo. |

Y dos cosas más que hay que saber antes de probar nada:

- **`packages/server/.data/` no existe en un checkout limpio.** Hay que colocar un PDF en
  `packages/server/.data/materials/pdfs/` antes de que la QA manual signifique algo.
- Todo lo que toque el protocolo NDJSON debe cambiar server y web **en el mismo PR**,
  porque el cliente decodifica de forma estricta y explota con un frame que no conoce.
