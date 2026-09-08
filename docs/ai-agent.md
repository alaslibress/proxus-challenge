# Tutor AI agent

## Objetivo

El tutor ayuda a estudiar usando materiales locales y creando artefactos de aprendizaje:

- `note`: apunte/explicación.
- `quiz`: ejercicio corto, cerrado y autocorregible.
- `test`: evaluación más completa; puede incluir respuesta corta.

## Archivos principales

- `packages/server/src/domain/agents/academic-tutor.ts`
- `packages/server/src/domain/agents/academic-tutor/tutor-chat-service.ts`
- `packages/server/src/domain/agents/harness/session.ts`
- `packages/server/src/domain/agents/gemini.ts`

Skills:

- `packages/server/src/domain/agents/academic-tutor/skills/use-uploaded-materials.ts`
- `packages/server/src/domain/agents/academic-tutor/skills/create-study-artifacts.ts`

Commands:

- `packages/server/src/domain/agents/academic-tutor/material-commands.ts`
- `packages/server/src/domain/agents/academic-tutor/artifact-commands.ts`

## Modelo mental

El modelo no recibe acceso directo a todo el backend. El harness le expone tools controladas:

- `load_skill({ name })`: carga instrucciones para una capacidad.
- `cli({ input })`: ejecuta comandos permitidos. El parámetro se llama `input`, no
  `command` (`harness.ts`, `Schema.Struct({ input: Schema.String })`); el adaptador lo
  declara igual (`gemini.ts`, `toolParameters`) y el system prompt del tutor lo escribe
  como `cli({"input": "..."})`.

Las skills no son tools. Si Gemini intenta llamar una skill como tool, el adapter redirige esa llamada a `load_skill` cuando puede.

## Comandos disponibles

Materiales:

```txt
materials list
materials view <materialId> <pages>
materials text <materialId> <pages>
```

Artifacts:

```txt
artifacts list
artifacts show <artifactId>
artifacts create '<json>'
artifacts submit '<json>'
artifacts attempts [artifactId]
artifacts grade <attemptId>
```

`materials view` puede devolver imágenes de páginas para llamadas multimodales a Gemini;
`materials text` devuelve el texto literal por página, con una cabecera
`--- <materialId> page N ---` por página (`material-commands.ts:89-90`). Esa cabecera es
fontanería interna: **nunca** debe llegar al alumno.

### Contrato de `artifacts create`

El modelo no puede adivinar el schema, así que está escrito en los tres sitios donde mira:
la skill `create-study-artifacts`, el `--help` del comando y el mensaje de error de
validación (`artifact-commands.ts`, `renderSerializationError`). Los tres dicen lo mismo, y
`packages/server/src/domain/artifacts/__tests__/artifact-schema.test.ts` lo ata al schema
real de `@proxus/shared`:

| Tipo de pregunta | Dónde vale | Campos requeridos | Opcionales |
|---|---|---|---|
| `multiple-choice` | `quiz` y `test` | `type`, `id`, `prompt`, `options` (objetos `{id,text}`), `correctOptionId`, `explanation` | `sourcePage` |
| `true-false` | `quiz` y `test` | `type`, `id`, `prompt`, `correctAnswer` (booleano), `explanation` | `sourcePage` |
| `short-answer` | **sólo `test`** | `type`, `id`, `prompt`, `expectedAnswer` (string, **no** `correctAnswer`) | `maxScore` (por defecto **1**), `sourcePage` |

Tres reglas que se saltaba el modelo antes de documentarlas:

- `explanation` es obligatoria en las preguntas cerradas porque **es** el feedback que se le
  enseña al alumno tras corregir. Una cadena vacía cumple el schema y rompe el producto.
- No existe la pregunta de respuesta múltiple: `correctOptionId` es uno. La skill obliga al
  tutor a elegir un rodeo (`short-answer` con la lista, o varias preguntas) y a decirlo.
- El `id` del artefacto lo asigna el servidor; enviarlo es un error.

## Presupuesto de pasos y turno de cierre

El bucle del harness (`harness/session.ts`) da `maxSteps` pasos por turno; por defecto
**8**, y 8 es lo que fijan las dos puertas de entrada del tutor
(`tutor-chat-service.ts`, `academic-tutor.ts`). Un flujo con materiales no cabe en menos:
dos `load_skill`, uno o dos `materials text` y un `artifacts create` antes de escribir la
primera línea de respuesta.

Cuando el presupuesto se agota, el harness **no** devuelve el último tool result —eso era el
bug: el volcado de una página del PDF salía firmado por el tutor—. Gasta un turno más con
las herramientas apagadas (`toolChoice: "none"`) para forzar una respuesta redactada con lo
ya reunido, y lo anota con el log `agent.wrap_up`. Ese turno de cierre tiene dos salidas
distintas, que conviene no confundir:

- Si **falla** (error del modelo), sale el texto de `modelErrorResponse`: *"I hit an
  internal model/tool-routing error…"* más el mensaje del error. Nunca menciona pasos.
- Si **tiene éxito pero devuelve texto vacío**, sale `wrapUpFallback`, que es el único
  texto que habla de haberse quedado sin pasos.

Cubierto por
`packages/server/src/domain/agents/harness/__tests__/session-step-budget.test.ts`.

Para que apagar las herramientas signifique algo, el adaptador tiene que decirlo: omitir
`toolConfig` deja a Gemini en `AUTO`, así que `toolChoice: "none"` manda `{ mode: "NONE" }`
explícito (`gemini.ts`, `toolChoiceConfig`).

## Flujo de chat

1. La web envía mensajes a `/api/tutor/chat/stream`.
2. El server crea/continúa una sesión del tutor.
3. Gemini responde con texto o function calls.
4. El harness ejecuta tools permitidas y añade resultados a la conversación.
5. La web recibe eventos NDJSON:
   - `{ type: "message", message }`
   - `{ type: "done" }`
6. Si hubo tool results, la web invalida materiales/artifacts.

**No hay streaming de tokens.** El adaptador de Gemini no lo implementa: `streamText`
devuelve `Stream.empty` (`gemini.ts`). Lo que viaja por NDJSON son **mensajes completos**
del harness (`AgentMessage`: el del usuario, cada llamada a tool, cada tool result y la
respuesta final), emitidos según se van produciendo — `session.stream` los va ofreciendo a
una `Queue` a medida que el bucle los añade (`harness/session.ts`). La respuesta del tutor
aparece de golpe cuando está entera, no palabra a palabra.

## Salida estructurada (JSON) — PR-03

El adaptador de Gemini (`packages/server/src/domain/agents/gemini.ts`) honra
`options.responseFormat` cuando se llama a `LanguageModel.generateObject({ schema, ... })`
en lugar de `generateText`. En ese caso:

- `requestBody` añade `generationConfig: { responseMimeType: "application/json", responseSchema }`.
- `responseSchema` se deriva de la `Schema` de Effect con `Schema.toJsonSchemaDocument`, se
  resuelven sus `$ref` con `resolveAllRefs` y se sanea al subconjunto tipo OpenAPI que
  acepta Gemini con `toGeminiResponseSchema` (`packages/server/src/domain/agents/gemini-schema.ts`,
  ambas funciones puras y sin dependencia de Effect ni de API key).
- En modo texto (`responseFormat.type === "text"`), `generationConfig` es `undefined` y el
  cuerpo de la petición no cambia respecto al comportamiento anterior.
- `LanguageModel.generateObject` decodifica la respuesta con el `defaultCodecTransformer`
  de Effect; si el modelo no respeta el schema, el fallo es un `AiError.InvalidOutputError`
  tipado, no una excepción ni un `JSON.parse` manual.

El contrato de evaluación (`FinalFeedbackSchema`, `EnrichedFeedbackSchema`) vive en
`packages/shared/src/schemas/evaluation.ts`.

Script de verificación manual contra la API real:

```bash
pnpm --filter @proxus/server run structured-output:check
```

Llama a `LanguageModel.generateObject` con `FinalFeedbackSchema` y un prompt de ejemplo, y
escribe el objeto decodificado por consola. **El subconjunto de `responseSchema` que
acepta Gemini no está garantizado por ningún tipo**: hay que ejecutar este script contra la
API real antes de confiar en un schema nuevo.

## Panel de evaluación multi-agente — PR-04

`short-answer` en un `test` deja de corregirse solo por igualdad exacta de strings.
`POST /api/artifacts/:id/submit` sigue calculando primero la nota determinista
(`gradeAttempt`, puro, sin LLM, siempre disponible) y luego la enriquece con un panel de
tres agentes Gemini definido en `packages/server/src/domain/evaluation/`:

- `prompts.ts`: los tres system prompts, aislados.
- `engine.ts`: `EvaluationEngineService`, el puerto y su layer.
- `errors.ts`: `EvaluationUnavailable` (único error tipado del motor).
- `review.ts`: `reviewGradedAttempt`, la capa que conecta el motor con un
  `ArtifactAttempt` ya corregido.
- `panel.check.ts`: script de verificación manual sin navegador.

Roles del panel:

1. **Profe Bueno** — motivador, busca qué hay de correcto en la respuesta del alumno.
   No decide la nota.
2. **Profe Malo** — crítico, señala lagunas e imprecisiones. Tampoco decide la nota.
3. **Juez** — recibe ambas críticas (o un aviso de que no hay críticas si los dos
   profes fallaron) más la respuesta del alumno, la esperada y el texto de la página.
   Decide `is_correct`, redacta `feedback`, y copia en `citas_pdf` fragmentos literales
   del texto aportado.

Los tres reciben **solo el texto de la página** (nunca el PDF entero) y tienen prohibido
usar conocimiento externo al texto aportado.

Concurrencia: los dos profes corren en paralelo con
`Effect.all([...], { concurrency: "unbounded", mode: "result" })` — nunca `Promise.all`.
Cada uno va envuelto en `Effect.timeout` (20s). Si ambos fallan, el Juez sigue adelante
avisado de que no hay críticas disponibles; si falla el Juez, el motor falla con
`EvaluationUnavailable({ stage: "judge" })`.

**Citas verificadas.** Cada string de `citas_pdf` que devuelve el Juez se comprueba
contra el texto real de la página con `verifyCitations` (`domain/materials/citation.ts`,
PR-02), produciendo un `PdfCitation` con `verified: boolean`. Ninguna cita se descarta.

**Regla anti-alucinación.** El veredicto del panel solo **sube** la nota de una
respuesta corta si `citas_pdf` contiene al menos una cita `verified: true` y el Juez
marcó `is_correct: true`. Sin evidencia verificada se conserva la corrección
determinista (`===`), y el `review` se adjunta igualmente para que la UI pueda mostrarlo.
Bajar la nota nunca aplica: si el `===` ya dijo que era correcta, coincide literalmente
con la esperada.

`reviewGradedAttempt` **nunca falla**: si no hay `sourcePage` ni páginas del material, si
el texto extraído está vacío (PDF escaneado), o si el motor falla por cualquier motivo,
se conserva la corrección determinista intacta y no se llama al LLM.

Multiple-choice y true-false **no pasan por el panel**: siguen siendo 100% deterministas
y sin latencia añadida.

Script de verificación manual contra la API real:

```bash
pnpm --filter @proxus/server run panel:check "<respuesta alumno>" "<respuesta esperada>" <materialId> <página>
```

Imprime las dos críticas, el JSON del Juez y las citas con su `verified`, y deja la traza
en `packages/server/.data/sessions/panel-check-<timestamp>.md`. Ejecutado en vivo el
8-sep-2026 en las dos direcciones (nota que no sube sin cita sostenida, nota que sube con
cita `verified: true`); resultados y coste en cuota en `docs/testing.md`.

Ojo con el coste: el script repite las llamadas a los dos profes fuera del motor sólo para
poder imprimirlas (`domain/evaluation/panel.check.ts:46-64`), así que cada pasada gasta 5
llamadas y no 3, sobre un límite de *free tier* de 20 al día.

## Trazabilidad del panel — PR-06

Cada corrección de una `short-answer` deja una traza determinista y legible por una
persona en `packages/server/.data/sessions/<attemptId>.md` (no confundir con
`.data/agent-sessions/`, que guarda el chat del tutor — ver `docs/data.md`).

Puerto en `domain/evaluation/trace.ts` (`EvaluationTrace`, `EvaluationTraceEntry`),
formateador puro en `domain/evaluation/trace-format.ts` (sin Effect, para que la eval del
PR-08 pueda comprobar el formato sin tocar disco), e implementación sobre `FileSystem` de
Effect en `infra/evaluation/file-evaluation-trace.ts`. El motor (`engine.ts`) produce un
borrador de la entrada (todo lo que solo él conoce: el texto de cada profe o su motivo de
fallo, el JSON crudo del Juez); `review.ts` la completa con `attemptId`, `artifactId`, la
nota determinista, la nota final y si el panel la modificó, y llama a `trace.record`.

**Qué buscar al leer una traza:**

- La sección **Evidencia inyectada**: el texto exacto de página que vio el panel. Si una
  nota parece injusta, empieza aquí — es la única fuente que los profes y el Juez tenían
  permitido usar.
- Las secciones **Profe Bueno** / **Profe Malo**: si alguno dice `_No disponible: <motivo>_`
  es que ese agente falló (timeout o error del modelo); el resto del panel sigue
  adelante sin él.
- La tabla de citas: cada cita del Juez con su marca ✅/❌. Contrastarla a mano contra el
  blockquote de evidencia justo encima es la demostración de que la verificación por
  código funciona — una cita ❌ no debe aparecer literalmente en ese texto.
- **Resultado**: nota determinista vs. nota final, y si el panel la modificó. Solo sube
  si hubo al menos una cita verificada y el Juez marcó `is_correct: true`.

La escritura ocurre en un fiber desligado (`Effect.forkDetach`) **después** de que el
Juez consolida su respuesta: nunca añade latencia a la corrección ni puede hacerla
fallar, ni siquiera si el directorio de trazas no tiene permisos de escritura. Es el
único puerto de este repo cuyo método no tiene canal de error.

## Configuración

```env
GOOGLE_GENERATIVE_AI_API_KEY=...
GEMINI_MODEL=gemini-3.6-flash
```

## Buenas prácticas al tocar AI

- Haz que una nueva capacidad sea observable: logs, tool results o artefactos claros.
- Limita el set de comandos disponibles; no conviertas el CLI en shell general.
- Escribe prompts/skills que expliquen cuándo usar cada tool.
- Añade smoke tests o evals si el cambio afecta comportamiento del tutor.
- Diseña fallbacks: el modelo puede equivocarse llamando tools o generando JSON.

## Smoke test manual

```bash
pnpm --filter @proxus/server run agent:tutor "list my uploaded materials"
pnpm --filter @proxus/server run agent:tutor "Crea un quiz corto de una pregunta sobre variables cualitativas"
```

Después, abre la web y comprueba que el artifact aparece en la sidebar y puede resolverse.
