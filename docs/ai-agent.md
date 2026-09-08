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
- `cli({ command })`: ejecuta comandos permitidos.

Las skills no son tools. Si Gemini intenta llamar una skill como tool, el adapter redirige esa llamada a `load_skill` cuando puede.

## Comandos disponibles

Materiales:

```txt
materials list
materials view <materialId> <pages>
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

`materials view` puede devolver imágenes de páginas para llamadas multimodales a Gemini.

## Flujo de chat

1. La web envía mensajes a `/api/tutor/chat/stream`.
2. El server crea/continúa una sesión del tutor.
3. Gemini responde con texto o function calls.
4. El harness ejecuta tools permitidas y añade resultados a la conversación.
5. La web recibe eventos NDJSON:
   - `{ type: "message", message }`
   - `{ type: "done" }`
6. Si hubo tool results, la web invalida materiales/artifacts.

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

Imprime las dos críticas, el JSON del Juez y las citas con su `verified`.

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
