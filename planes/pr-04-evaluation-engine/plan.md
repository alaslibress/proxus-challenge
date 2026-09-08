# PR-04 — `EvaluationEngineService`: el panel multi-agente concurrente

- **Rama**: `feat/evaluation-engine`
- **Depende de**: PR-02 (texto de página + `verifyCitations` + `sourcePage`) y PR-03 (`generateObject` contra Gemini + `FinalFeedbackSchema`).
- **Bloquea a**: PR-05 (transporte), PR-06 (trazabilidad), PR-07 (UI).
- **Estado**: borrador
- **Contiene LLM**: sí. Es el corazón del producto.
- **Origen**: [ADR-01, Decisión 1](../../documentacion/adr-motor-evaluacion.md) y [ADR-02 §1](../../documentacion/adr-02-evaluacion-transporte-observabilidad.md).

> Normas de trabajo en [`../plan.md`](../plan.md). Contexto técnico obligatorio en
> [`../../documentacion/contexto-repo.md`](../../documentacion/contexto-repo.md) y
> [`../../documentacion/funcionamiento-actual.md`](../../documentacion/funcionamiento-actual.md).
> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.

---

## Problema

Hoy una respuesta corta se corrige así (`packages/server/src/domain/artifacts/artifact.ts:463`):

```ts
const correct = normalizeAnswer(answer.answer) === normalizeAnswer(question.expectedAnswer);
```

con `normalizeAnswer = (answer) => answer.trim().toLocaleLowerCase()` (`:478`). Es
igualdad exacta de strings: un alumno que escriba *"la media aritmética vale 4"* cuando se
esperaba *"la media es 4"* saca un cero. No hay tolerancia a paráfrasis, ni a sinónimos,
ni a orden distinto, ni siquiera a un acento. El feedback que recibe es la cadena
`` `Expected: ${question.expectedAnswer}` ``.

Ese es el agujero de producto que el ADR-01 manda cerrar. Y no se cierra con un
`===` más listo: se cierra evaluando **conceptualmente** contra el texto real del PDF, y
justificando la decisión con citas que se puedan comprobar.

## Objetivo

Que exista un `EvaluationEngineService` aislado que, dada una respuesta corta y el texto
de la página de la que salió la pregunta, ejecute **Profe Bueno y Profe Malo en paralelo**
y consolide su veredicto con un **Juez** que devuelve JSON estructurado con citas
verificadas contra el PDF.

## Fuera de alcance

- El endpoint `POST /api/artifacts/:id/submit/stream` y los estados discretos. Eso es
  PR-05. **Aquí el motor se invoca de forma síncrona** desde el `submit` que ya existe,
  para que el PR sea demostrable por sí solo.
- La trazabilidad en Markdown bajo `.data/sessions/`. Eso es PR-06.
- Cualquier cosa en `packages/web`.
- Tocar multiple-choice y true-false. Siguen deterministas (decisión cerrada nº3 en
  `plan.md`).
- Meter el motor en el chat del tutor o en el harness de tools.

## Contratos afectados

### `ShortAnswerCorrection` gana el review

En `packages/shared/src/schemas/artifact.ts` (copia única desde el PR-01):

```ts
export const ShortAnswerCorrection = Schema.Struct({
  questionType: Schema.Literal("short-answer"),
  questionId: Schema.String,
  score: Schema.Number,
  maxScore: Schema.Number,
  feedback: Schema.String,
  review: Schema.optional(EnrichedFeedbackSchema)   // ← nuevo
});
```

`Schema.optional`, no `NullOr`: los attempts ya guardados en `.data/artifacts/attempts/`
no tienen el campo y deben seguir decodificando. Ojo con
`exactOptionalPropertyTypes` (`tsconfig.json:15`): construir con spread condicional,
`...(review === undefined ? {} : { review })`.

`MultipleChoiceCorrection` y `TrueFalseCorrection` **no** se tocan.

### Sin cambios en el contrato del Juez

`FinalFeedbackSchema` y `EnrichedFeedbackSchema` quedan exactamente como los fijó el
PR-03. El motor no añade campos al JSON que ve el modelo.

## Arquitectura

Módulo nuevo `packages/server/src/domain/evaluation/`. **No va bajo `domain/agents/`**:
según el ADR-02 §1 el motor es un servicio de dominio independiente, no un agente del
harness, y así puede consumirlo tanto la ruta de corrección como el CLI.

```
domain/evaluation/
  prompts.ts            los 3 system prompts aislados
  engine.ts             EvaluationEngineService: puerto, implementación y layer
  errors.ts             EvaluationError (Data.TaggedError)
```

Puerto:

```ts
export interface EvaluationInput {
  readonly questionPrompt: string;
  readonly expectedAnswer: string;
  readonly studentAnswer: string;
  readonly materialId: string;
  readonly evidence: readonly PageText[];
}

export interface EvaluationEngineService {
  readonly evaluate: (
    input: EvaluationInput
  ) => Effect.Effect<EnrichedFeedbackSchema, EvaluationError, LanguageModel.LanguageModel>;
}
```

Flujo:

```
                  ┌── Profe Bueno ──┐
evidence + input ─┤                 ├─ Effect.all({concurrency:"unbounded", mode:"result"})
                  └── Profe Malo ───┘
                            │
                            ▼
                   Juez  (generateObject → FinalFeedbackSchema)
                            │
                            ▼
                 verifyCitations(citas_pdf, evidence, materialId)
                            │
                            ▼
                    EnrichedFeedbackSchema
```

## Pasos

### Paso 1 — Los tres prompts

- [ ] Crear `domain/evaluation/prompts.ts` con tres constantes exportadas y una función
      por prompt que reciba `EvaluationInput` y devuelva el texto del usuario.

Reglas que deben cumplir los tres, y que el doer no debe suavizar:

- **Profe Bueno**: motivador y empático. Busca qué hay de correcto en la respuesta del
  alumno. **No decide la nota** y no puede afirmar nada que no esté en el texto aportado.
- **Profe Malo**: crítico y exigente. Señala lagunas, imprecisiones y lo que falta.
  **Tampoco decide la nota.**
- **Juez**: recibe la respuesta del alumno, la respuesta esperada, el texto de la página y
  las dos críticas. Decide `is_correct`, redacta `feedback` consolidando ambas posturas, y
  **debe copiar en `citas_pdf` fragmentos literales del texto aportado**, palabra por
  palabra, sin reformular. Se le dice explícitamente que las citas se verifican por código
  y que una cita inventada invalida su respuesta.
- Los tres reciben **solo el texto de la página**, nunca el PDF entero, y se les prohíbe
  usar conocimiento externo.
- Los tres van en español: es el idioma del producto y de las skills existentes.

### Paso 2 — Errores

- [ ] `domain/evaluation/errors.ts`:
      ```ts
      export class EvaluationUnavailable extends Data.TaggedError("EvaluationUnavailable")<{
        readonly reason: unknown;
        readonly stage: "judge" | "evidence";
      }> {}
      ```
      Un único error tipado. Los fallos de los profes **no** producen error: se degradan
      (paso 3).

### Paso 3 — El motor

- [ ] `domain/evaluation/engine.ts`, `Context.Service` + `Layer`, siguiendo el patrón de
      `TutorChatService` (`domain/agents/academic-tutor/tutor-chat-service.ts:18-20`).

**Los dos profes, en paralelo y sin poder tumbar el panel:**

```ts
const critiques = yield* Effect.all(
  [
    LanguageModel.generateText({ prompt: goodTeacherPrompt(input), toolChoice: "none" }),
    LanguageModel.generateText({ prompt: badTeacherPrompt(input),  toolChoice: "none" })
  ],
  { concurrency: "unbounded", mode: "result" }
);
```

`mode: "result"` está documentado como *"runs every effect and never fails"*
(`Effect.d.ts:407-412`). Es la forma idiomática de los *fallbacks dentro del ecosistema
Effect* que exige la Tech Spec §5, y evita tener que envolver cada agente a mano.
**Prohibido `Promise.all`**, igual que prohíbe la Tech Spec.

- [ ] Envolver cada profe en `Effect.timeout` (`Effect.d.ts:7463`). Arrancar en **20s**
      por agente y ajustar si el smoke test dice otra cosa.
- [ ] El Juez recibe las críticas que hayan salido bien. Si fallaron las dos, se le dice
      en el prompt que no hay críticas disponibles y **sigue adelante**: un panel con solo
      el Juez es peor, pero es mejor que un cero.
- [ ] Juez con `LanguageModel.generateObject({ schema: FinalFeedbackSchema, prompt })`.
      Si falla, el motor falla con `EvaluationUnavailable({ stage: "judge" })`. El fallo de
      forma llega como **`AiError.StructuredOutputError`**: `generateObject` concatena las
      partes de texto de la respuesta y las decodifica con `Schema.fromJsonString`
      (`LanguageModel.js:1109-1133`), y tanto "sin texto en la respuesta" como "el JSON no
      encaja con el schema" salen por ahí. Capturar el `AiError` entero, no un tag concreto. **No hay reintento de reparación**: con
      `responseSchema` nativo del PR-03 el JSON viene conforme por construcción, y quien
      decide si reintenta es el llamante, no el motor.
- [ ] Enriquecer: `verifyCitations(judge.citas_pdf, input.evidence, input.materialId)`,
      la función pura del PR-02. Devuelve un `PdfCitation` por cada string, marcando
      `verified` — **no descarta ninguna**.
- [ ] Devolver `{ is_correct, feedback, citas_pdf: <enriquecidas> }`.

### Paso 4 — Sustituir la corrección de `short-answer`

Aquí es donde el ADR-01 se materializa. En `domain/artifacts/artifact.ts`:

- [ ] En `correctQuestion` (`:454-476`), la rama `short-answer` deja de decidir la nota
      por sí misma. El `===` **ya no es el mecanismo de corrección**: pasa a ser
      exclusivamente la ruta de reserva cuando el panel no está disponible.
- [ ] `gradeAttempt` (`:346`) **sigue siendo puro y sin LLM**. No se le añade
      `LanguageModel` al canal `R`. Es lo que garantiza que la nota exista siempre.
- [ ] Crear la capa de arriba en `domain/evaluation/review.ts`:
      ```ts
      export const reviewGradedAttempt: (
        artifact: Artifact,
        attempt: ArtifactAttempt
      ) => Effect.Effect<ArtifactAttempt, never, EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel>;
      ```
      Recorre las correcciones `short-answer`, evalúa cada una con el motor y devuelve el
      attempt actualizado. **Nunca falla**: si el motor falla, deja la corrección
      determinista intacta.

**Regla dura, y es la garantía anti-alucinación del producto:**

> El veredicto del panel solo **sube** la nota de una respuesta corta si `citas_pdf`
> contiene **al menos una cita verificada**. Sin evidencia verificada se conserva la
> corrección determinista, se adjunta el `review` igualmente (para que la UI pueda
> mostrarlo con sus badges) y no se toca `score`.

Bajar la nota no aplica: si el `===` dijo que era correcta, la respuesta coincide
literalmente con la esperada.

- [ ] Recalcular el total con `scoreQuestionCorrections` (`:485-509`), que ya suma
      `correction.score` para `short-answer`. No hace falta tocarlo.

### Paso 5 — Evidencia

- [ ] En `reviewGradedAttempt`, construir la evidencia por pregunta:
      1. `question.sourcePage` si existe (PR-02).
      2. si no, `artifact.source.pages` completo.
      3. si tampoco, **no hay evidencia**: no se llama al motor y se conserva la
         corrección determinista. Se registra el motivo.
- [ ] Obtener el texto con `materialRepository.extractText(materialId, pages)` (PR-02).
- [ ] Si el texto de todas las páginas sale vacío (PDF escaneado), tratarlo igual que
      "sin evidencia". No se manda al Juez un contexto vacío del que no puede citar.

### Paso 6 — Wiring y layers

- [ ] Registrar `EvaluationEngineServiceLive` en `DomainLive`
      (`transport/http/server.ts:52-62`), junto a `TutorChatServiceLive` y `GeminiModel`.
- [ ] En el handler de `submit` (`transport/http/handlers.ts:53-59`), encadenar
      `reviewGradedAttempt` **después** de `gradeAttempt`, y persistir el attempt
      resultante. El handler ya termina en `Effect.orDie`; como `reviewGradedAttempt` no
      falla, no cambia el canal de error.
- [ ] Ese endpoint pasa a tardar lo que tarden las llamadas al LLM. **Es temporal y
      conocido**: el PR-05 mete la ruta de streaming y esta espera deja de ser ciega.
      Anotarlo en el cuerpo del PR.

### Paso 7 — Script de prueba sin navegador

- [ ] `domain/evaluation/panel.check.ts`, en la línea de `academic-tutor.ts`: recibe por
      argumento la respuesta del alumno, la esperada y un `materialId` + página, y
      imprime las dos críticas, el JSON del Juez y las citas con su `verified`.
- [ ] Añadir el script a `packages/server/package.json` con el patrón exacto de los
      existentes: `node --env-file=../../.env --import tsx <fichero>`.

### Paso 8 — Documentación

- [ ] `documentacion/funcionamiento-actual.md` §5: la corrección deja de ser 100%
      determinista. Actualizar también la tabla §9.
- [ ] `planes/plan.md` §9: actualizar el límite duro **"La corrección es determinista y
      sin LLM"**. Referenciar por texto y no por número: la lista se renumera cada vez
      que un PR elimina una entrada.
- [ ] `docs/ai-agent.md`: sección nueva describiendo el panel, los tres roles, la regla de
      citas verificadas y el script del paso 7.

## Criterio de aceptación

1. Una respuesta corta parafraseada que hoy saca 0 obtiene la puntuación completa, con
   `feedback` en prosa y al menos una cita `verified: true`.
2. Una respuesta corta claramente incorrecta sigue puntuando 0, y el `feedback` explica
   por qué citando el texto.
3. Con la API key vacía o Gemini caído, `submit` **sigue devolviendo un attempt corregido**
   con la nota determinista. No hay 500, no hay cuelgue.
4. Si los dos profes fallan pero el Juez responde, hay review. Si falla el Juez, no hay
   review y la nota es la determinista.
5. Una cita que el Juez se invente llega a la respuesta con `verified: false` y **no
   altera la nota**.
6. Multiple-choice y true-false se corrigen exactamente igual que antes, sin latencia
   añadida y sin llamar al LLM.
7. Un attempt guardado antes de este PR sigue decodificando.
8. En el código nuevo no aparece `Promise.all` ni ningún `await` de concurrencia manual.
9. `pnpm run typecheck` y el build de web en verde.

## Checks

```bash
pnpm run typecheck
pnpm --filter @proxus/web run build
pnpm --filter @proxus/server run panel:check "la media aritmética vale 4" "la media es 4" <materialId> 1
pnpm --filter @proxus/server run eval:tutor:artifact-authoring
```

## QA manual

1. Colocar un PDF con capa de texto en `packages/server/.data/materials/pdfs/`.
2. `pnpm run dev`. Pedir al tutor: *"lee la página 2 de \<id\> y créame un test con una
   pregunta de respuesta corta"*.
3. Responder con una **paráfrasis** de la respuesta esperada, no con las mismas palabras.
   Enviar. Debe puntuar correcto, con feedback razonado y una cita del PDF.
4. Repetir con una respuesta incorrecta: debe puntuar 0 y explicar por qué.
5. Vaciar `GOOGLE_GENERATIVE_AI_API_KEY`... **no**: el server no arranca sin ella
   (fail-fast deliberado). Para probar la degradación, apuntar `GEMINI_MODEL` a un modelo
   inexistente. El envío debe seguir devolviendo nota determinista.
6. Abrir el JSON del attempt en `.data/artifacts/attempts/` y comprobar `review` con sus
   `citas_pdf` y los `verified`.

## Riesgos y decisiones

- **Desviación del ADR-01, declarada.** El ADR dice *"la comparación estricta (===) se
  elimina por completo"*. Este plan **la conserva como única ruta de reserva**, nunca como
  mecanismo principal. Motivo: la propia Tech Spec §5 exige que *"los fallos del LLM no
  crashean el servidor (graceful degradation)"*, y sin el `===` la degradación sería
  poner un 0 a un alumno porque se cayó una API. Si se prefiere la lectura literal, es un
  cambio de una rama en `correctQuestion` —devolver score 0 y feedback "no evaluable"—
  pero el thinker lo desaconseja y quiere que se decida explícitamente antes.
- **Coste y latencia.** Tres llamadas al LLM por respuesta corta. Los dos profes van en
  paralelo, así que el coste en tiempo es `max(bueno, malo) + juez`, no la suma. Aun así
  un test con cinco preguntas cortas son quince llamadas: por eso el PR-05 mete el
  streaming, y por eso multiple-choice y true-false no pasan por aquí.
- **`mode: "result"` sobre `Effect.all` es la pieza que hay que verificar primero.** Está
  documentada como que nunca falla, pero el tipo de retorno exacto (`All.Return`) conviene
  comprobarlo en el editor antes de construir el resto encima. Si no encaja, la
  alternativa es envolver cada profe en `Effect.result` (`Effect.d.ts`) y usar
  `Effect.all` normal.
- **`Effect.either` no existe en Effect v4.** El equivalente es `Effect.result`. Si el
  doer viene de v3, este es el primer sitio donde se va a tropezar.
- **La calidad depende de los prompts, no del código.** Es el único punto del roadmap
  donde el resultado no es determinista. Por eso el PR-08 mete evals con modelo falso: no
  para medir si el Juez es listo, sino para garantizar que el sistema **no se rompe ni
  miente** cuando el Juez se equivoca.
- **Se evalúa pregunta a pregunta, no el intento entero.** Más llamadas, pero cada
  veredicto queda anclado a su página y sus citas. Evaluar el intento completo de una vez
  abarataría el coste y haría las citas mucho más difíciles de atribuir.

## Historial

_Sin cambios todavía. El thinker anota aquí cualquier corrección al plan que venga del
doer, con fecha y motivo._
