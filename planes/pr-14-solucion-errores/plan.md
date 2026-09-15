# PR-14 — El panel siempre corre, el tutor ve el ejercicio abierto y el solver deja de mentir

- **Rama**: `fix/solucion-errores`
- **Depende de**: nada. Sale de `main` (`c2a73a6`).
- **Estado**: borrador
- **Contiene LLM**: sí. Cambia los prompts de los tres agentes del panel y el prompt del
  tutor, e implementa el streaming del proveedor de Gemini.
- **Fichero delicado**: el paso 13 toca `packages/server/src/domain/agents/gemini.ts`, que
  es donde viven la fuga de tool calls del PR-12, el reintento con `mode:ANY` y los
  `thoughtSignature`. **`generateText` no se toca en ninguna línea**: sólo se sustituye el
  `streamText` vacío.
- **Origen**: reporte de uso del 15 de septiembre de 2026. El paso 13 se añadió por
  petición posterior del usuario en la misma sesión de planificación.

> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica
> con el formato de `planes/GUIA-DOER.md` §4.

---

## Problema

### 1. El panel no llega a ejecutarse (y cuando lo hace, casi nunca sube la nota)

El panel de tres agentes vive en `packages/server/src/domain/evaluation/engine.ts` y solo
se invoca desde `reviewCorrection` (`domain/evaluation/review.ts:77-187`). Esa función
tiene cuatro puertas, y las tres primeras devuelven la corrección **intacta y en
silencio**:

```ts
// review.ts:93-95
if (artifact.source === undefined) {
  return correction;
}
```

- `review.ts:93` — el artefacto no trae `source` (`{ materialId, pages }`). La skill de
  autoría le dice explícitamente al modelo que **no** ponga `source` cuando el artefacto
  sale de conocimiento general:
  `domain/agents/academic-tutor/skills/create-study-artifacts.ts:63-64`. Comprobado en
  disco: `packages/server/.data/artifacts/artifacts/2cce9e76-….json` es un `test` con una
  `short-answer` y sin `source`.
- `review.ts:98-101` — `pages.length === 0`.
- `review.ts:106-144` — `extractText` falla, o las páginas no tienen capa de texto.

En esos tres casos no se emite **ningún** frame `status`, así que `EvaluationProgress`
nunca se pinta: el alumno no ve al panel porque el panel no existe para esa pregunta.

La nota que queda es la determinista, y para `short-answer` es igualdad exacta de strings:

```ts
// domain/artifacts/artifact.ts:207, 222
const correct = normalizeAnswer(answer.answer) === normalizeAnswer(question.expectedAnswer);
const normalizeAnswer = (answer: string) => answer.trim().toLocaleLowerCase();
```

De ahí el "las puntuó todas a 0": `get` ≠ `el método get`.

Y cuando el panel **sí** corre, la única regla que sube la nota
(`panelRaisesScore`, `review.ts:72-75`) exige que alguna cita del Juez case literalmente
contra el texto extraído (`verifyQuote`, `domain/materials/citation.ts:16-30`,
`MIN_QUOTE_LENGTH = 12`). Es frágil: dos intentos con la misma respuesta al mismo
artefacto dieron 1 y 0 (`.data/artifacts/attempts/8febde8b-….json` vs
`bf31080f-….json`).

En un **quiz** el panel es imposible por construcción: `QuizQuestion` solo admite
`multiple-choice` y `true-false` (`packages/shared/src/schemas/artifact.ts:44-48`), y
`review.ts:197,231` corta si `artifactKind !== "test"`. Eso no es un bug, pero la UI no lo
dice en ninguna parte.

### 2. El tutor no sabe qué ejercicio tienes abierto

`TutorChatRequest` (`packages/shared/src/api/tutor.ts:5-9`) lleva **solo**
`{ messages, input, maxSteps? }`. El cliente envía `{ input, messages }` y nada más
(`packages/web/src/domain/tutor/stream.ts:30-46`, llamado desde
`use-tutor-chat.ts:44-61`). `selectedArtifactId` vive en `useState` de `App.tsx:7` y no
llega a `Chat` (`Chat.tsx:12-13` llama a `useTutorChat()` sin props).

Así que "dime en qué he fallado" obliga al agente a redescubrirlo todo por tools:
`load_skill` → `artifacts list` → `artifacts attempts` → `artifacts grade <id>` (el único
comando que devuelve `corrections`, `artifact-commands.ts:233-246`) → `artifacts show
<id>` para resolver los enunciados → a veces `materials text`. Cada paso es **una ronda
HTTP completa** contra Gemini (`harness/session.ts:81-92`, una sola function call por
turno, `gemini.ts:270`), y con `maxSteps: 8` (`tutor-chat-service.ts:44-51`) el
presupuesto se agota y se gasta un turno extra de cierre (`session.ts:133-144`).

Ya existe el patrón que lo arregla: PR-11 inyecta el inventario de materiales en el
prompt por petición (`tutor-chat-service.ts:22-42` → `academic-tutor.ts:55-57`), que es
justo lo que eliminó la ronda de `materials list`. No hay equivalente para artefactos.

### 3. Verdadero/falso: el `name` del radio está mal

```tsx
// ArtifactWorkspace.tsx:496-503
<input
  type="radio"
  name={`true-false-${label}`}   // "true-false-True" / "true-false-False"
  ...
  checked={value === nextValue}
/>
```

El `name` agrupa **por etiqueta, no por pregunta**: todos los `False` de todas las
verdadero/falso del test comparten `name="true-false-False"`. El navegador impone un solo
radio marcado por `name`, así que marcar `False` en la pregunta 4 desmarca en el DOM el
`False` de la pregunta 1; React restaura el estado controlado del primero y el recién
pulsado se queda sin pintar. El estado de React (`answers`) sí guarda las dos, por eso
"cuenta para poder enviar" (`ArtifactWorkspace.tsx:174-177`, `604`).

`MultipleChoiceInput` lo hace bien: `name={question.id}` (`ArtifactWorkspace.tsx:463`).
`TrueFalseInput` ni siquiera recibe `question` (`:476-484`).

Agravante: **no hay ningún estilo de "seleccionado"** en ninguno de los dos componentes.
El único indicio visual es el punto nativo del radio.

### 4. Etiquetas internas y fórmulas

- `ArtifactWorkspace.tsx:392` pinta `{question.type}` crudo en un badge monoespaciado:
  `short-answer`, `true-false`, `multiple-choice`. No existe ningún diccionario de
  etiquetas en el repo (buscado: 0 aciertos).
  Lo mismo con `{artifact.kind}` (`:267`) y `` `Submit ${artifact.kind}` `` (`:331`).
- El enunciado (`:398`), el texto de las opciones (`:469`) y las explicaciones
  (`:568`, `:574`) se interpolan **como texto plano**: ni markdown ni fórmulas.
- Donde sí hay markdown —`Chat.tsx:230`, `ArtifactWorkspace.tsx:157`,
  `evaluation/CitationList.tsx:15`— se usa `Streamdown` **sin `plugins`**, y Streamdown no
  hace math por defecto. No hay `remark-math`, `rehype-katex` ni `@streamdown/math`
  declarados en ningún `package.json`. (`katex@0.16.47` está en el store, pero solo como
  dependencia transitiva de `mermaid`, dentro del bundle de `streamdown`: no es usable.)
- La UI mezcla idiomas: el chrome del solver en inglés, toda la capa de evaluación en
  español.

### 5. El razonamiento del panel se tira a la basura

Mientras el alumno espera, lo único que ve son tres filas con un `◐` parpadeando
(`evaluation/EvaluationProgress.tsx:42-60`). El texto que escriben el Profe Bueno y el
Profe Malo **existe** —`engine.ts:81-86` lo guarda en `good` / `bad` y se lo pasa al Juez,
y `teacherOutcome` lo mete en la traza— pero **no sale nunca hacia la UI**: el contrato
`AttemptStreamEvent` (`packages/shared/src/api/artifacts.ts:20-31`) solo tiene `status`,
`done` y `error`, y `status` solo lleva una etiqueta de etapa. El alumno espera diez o
quince segundos delante de un spinner mientras dos modelos escriben, para él, en secreto.

Y no se puede arreglar sólo en la UI, porque **debajo no hay streaming**:

```ts
// packages/server/src/domain/agents/gemini.ts:474
streamText: () => Stream.empty
```

El proveedor de Gemini del repo implementa `generateText` contra el endpoint
`:generateContent` (no incremental, `gemini.ts:151-152,353-385`, con `fetch` pelado) y deja
`streamText` como un stream vacío. Llamar a `LanguageModel.streamText` hoy **no da error:
devuelve cero partes**, que es la peor forma posible de fallar.

Lo que sí está ya preparado:
- `LanguageModel.make` (`effect/unstable/ai/LanguageModel.ts:748-762`) pide
  `streamText: (options) => Stream.Stream<Response.StreamPartEncoded, AiError, IdGenerator>`.
- `Response.StreamPartEncoded`
  (`effect/unstable/ai/Response.ts:330-348`) incluye `text-start` / `text-delta` /
  `text-end` **y** `reasoning-start` / `reasoning-delta` / `reasoning-end`.
- `GeminiPart` (`gemini.ts:17-22`) ya declara `thought`, y `logGeminiResponse`
  (`:395-401`) ya cuenta las partes de pensamiento: el canal de razonamiento del modelo
  está modelado, sólo que nadie lo lee.

## Objetivo

Que el panel de tres agentes se ejecute y se vea en **toda** respuesta corta, que suba la
nota cuando el alumno acierta con sus palabras, que el tutor conteste sobre el ejercicio
abierto sin gastar una sola tool call en encontrarlo, y que el solver pinte lo que el
alumno marca, con etiquetas legibles y fórmulas renderizadas.

Y que la espera deje de ser un spinner: mientras el Profe Bueno y el Profe Malo trabajan,
el alumno **lee lo que están escribiendo, token a token**.

## Fuera de alcance

- **Ampliar `QuizQuestion` con `short-answer`.** Decisión del usuario: el quiz se explica
  en la UI, no se amplía. Un quiz sigue siendo 100 % determinista.
- **Pasar multiple-choice y true-false por el panel.** Misma decisión. Ni latencia ni
  coste añadidos a las preguntas cerradas.
- **Tocar `maxSteps`.** Sigue en 8. El commit `bca8a8c` ya lo subió de 4 a 8 porque un
  flujo con materiales no cabía en 4; el arreglo aquí es quitarle trabajo al agente, no
  recortarle el presupuesto.
- **Traducir la traza de disco a inglés más allá de los rótulos de rol.** Ver *Riesgos*.
- **Streaming de tokens, tool calls en paralelo, caché de `pdfinfo`.** Nada de eso entra.
- **Reescribir `correctQuestion`** para que la corrección determinista deje de ser
  igualdad exacta. El `===` se conserva como red de seguridad sin LLM (ADR-01); lo que
  cambia es que ahora **siempre** hay un panel encima que puede subirla.
- **Borrar o migrar los artefactos y los intentos ya guardados en `.data/`.** Los
  contratos cambian de forma retrocompatible (ver *Contratos afectados*).
- **Streamear al Juez.** Sigue con `LanguageModel.generateObject`: su salida es JSON
  estructurado contra `FinalFeedbackSchema` y medio JSON en pantalla no es razonamiento,
  es ruido. Durante `deliberating` se sigue viendo el spinner de hoy. El paso 13 toca
  **solo** a los dos profes, que es lo que se pidió.
- **Streamear el chat del tutor.** `streamText` se implementa en el proveedor y queda
  disponible para todo el mundo, pero el harness del agente
  (`harness/session.ts:83-92`) **sigue llamando a `generateText`**. Cambiar el bucle del
  agente a streaming es otro PR: arrastra el contrato NDJSON del chat, el ciclo de vida
  del input del PR-10 y el reintento de tool calls del PR-12.2.
- **Conservar el razonamiento en la UI después de corregir.** Al pasar a `done` el
  transcript desaparece. Queda guardado en la traza de disco
  (`.data/sessions/<attemptId>.md`), que ya lo escribía. Pintarlo en el resultado es un
  añadido posterior.

## Contratos afectados

Los tres cambios de `packages/shared` mueven server **y** web en este mismo PR
(`GUIA-DOER.md` §5).

### `packages/shared/src/schemas/evaluation.ts` — el veredicto dice si tuvo evidencia

```ts
import { Effect, Schema } from "effect";   // Effect es nuevo en este fichero
...
export const EnrichedFeedbackSchema = Schema.Struct({
  is_correct: Schema.Boolean,
  feedback: Schema.String,
  citas_pdf: Schema.Array(PdfCitation),
  // Opcional en el transporte, siempre booleano una vez decodificado: los veredictos ya
  // persistidos en .data/ se escribieron cuando el panel solo corría con PDF delante.
  grounded: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true)))
});
```

Precedente exacto del patrón: `maxScore` en `schemas/artifact.ts:32-41`.

**`FinalFeedbackSchema` NO cambia.** Es el contrato que produce el LLM; `grounded` lo pone
el servidor.

### `packages/shared/src/api/tutor.ts` — el chat puede decir qué hay abierto

```ts
export const OpenExerciseRef = Schema.Struct({
  artifactId: Schema.String,
  attemptId: Schema.optional(Schema.String)
});
export type OpenExerciseRef = typeof OpenExerciseRef.Type;

export const TutorChatRequest = Schema.Struct({
  messages: Schema.Array(AgentMessage),
  input: Schema.String,
  maxSteps: Schema.optional(Schema.Number),
  openExercise: Schema.optional(OpenExerciseRef)
});
```

Solo viajan **ids**. El contenido lo resuelve el servidor contra el repositorio: el
cliente no puede mentirle al prompt sobre las notas.

### `packages/server/src/domain/evaluation/prompts.ts` — `EvaluationInput` gana modo

```ts
export type EvaluationMode = "grounded" | "ungrounded";

export interface EvaluationInput {
  readonly questionId: string;
  readonly questionPrompt: string;
  readonly expectedAnswer: string;
  readonly studentAnswer: string;
  readonly mode: EvaluationMode;
  readonly materialId: string | undefined;   // era `string`
  readonly pages: readonly number[];
  readonly evidence: readonly PageText[];    // vacío en ungrounded
}
```

`materialId` se declara **como propiedad requerida que admite `undefined`**, no como
opcional: con `exactOptionalPropertyTypes: true` (`GUIA-DOER.md` §5) eso evita el spread
condicional en cada llamante.

### `packages/server/src/domain/evaluation/trace.ts` — la traza registra el modo

`EvaluationTraceEntry` y `EvaluationTraceDraft` ganan `readonly mode: EvaluationMode`.

### `packages/shared/src/api/artifacts.ts` — el stream lleva el razonamiento

Frame **nuevo**, añadido a la unión `AttemptStreamEvent`. Los tres existentes (`status`,
`done`, `error`) **no se tocan**.

```ts
export const PanelAgent = Schema.Union([
  Schema.Literal("good_teacher"),
  Schema.Literal("bad_teacher")
]);
export type PanelAgent = typeof PanelAgent.Type;

// dentro de la unión AttemptStreamEvent:
Schema.Struct({
  type: Schema.Literal("reasoning"),
  agent: PanelAgent,
  // "thought" = traza de pensamiento del modelo; "text" = la crítica que sí acaba
  // llegando al Juez. Se pintan distinto.
  channel: Schema.Union([Schema.Literal("thought"), Schema.Literal("text")]),
  delta: Schema.String,
  questionId: Schema.String,
  questionIndex: Schema.Number,
  questionTotal: Schema.Number
})
```

`questionId`/`questionIndex`/`questionTotal` van aquí por la misma razón que en `status`:
con varias respuestas cortas, la UI tiene que poder tirar los deltas de una pregunta que
ya pasó.

**Un frame nuevo obliga a mover server y web en el mismo PR** (`GUIA-DOER.md` §5): el
lector NDJSON es tolerante desde el PR-05 y una línea que no decodifica **se descarta con
un `console.warn` sin romper el stream** (`packages/web/src/lib/ndjson.ts:17-24,38-46`).
Si publicas el frame y no lo consumes, no verás ningún error: verás una UI que no hace
nada.

### `packages/server/src/domain/evaluation/engine.ts` — el `emit` deja de ser sólo etapas

```ts
export type EvaluationProgressEvent =
  | { readonly _tag: "stage"; readonly stage: AttemptEvaluationStage }
  | {
      readonly _tag: "reasoning";
      readonly agent: PanelAgent;
      readonly channel: "thought" | "text";
      readonly delta: string;
    };
```

`EvaluationEngineService.evaluate` pasa de
`emit?: (stage: AttemptEvaluationStage) => Effect.Effect<void>` a
`emit?: (event: EvaluationProgressEvent) => Effect.Effect<void>`. Los llamantes son
`review.ts` (`reviewCorrection` y `stageEmit` en `executeStreaming`) y los tests del
motor. No hay más.

---

## Pasos

Ejecuta `pnpm run typecheck` al terminar **cada** paso. Cada paso deja el repo
compilando.

### Paso 0 — Premisas

1. [ ] `git switch -c fix/solucion-errores` desde `main` actualizado (`c2a73a6` o
       posterior).
2. [ ] `pnpm -r test` y **anota el recuento**. Referencia medida al escribir este plan:
       **17 ficheros / 151 tests** (server 14/131, web 3/20). Si tu número de partida es
       otro, usa el tuyo: la regla es que no baje.
3. [ ] Comprueba que `review.ts:93-95` sigue siendo el `if (artifact.source === undefined)
       return correction;` descrito arriba. **Si no lo es, para y notifica.**
4. [ ] Necesitas `packages/server/.data/materials/pdfs/` con al menos un PDF con capa de
       texto para la QA manual (`GUIA-DOER.md` §2).

### Paso 1 — Contratos en `shared`

Ficheros: `packages/shared/src/schemas/evaluation.ts`, `packages/shared/src/api/tutor.ts`.

1. [ ] Añade `grounded` a `EnrichedFeedbackSchema` tal y como está en *Contratos
       afectados*. Importa `Effect` en ese fichero.
2. [ ] Añade `OpenExerciseRef` y el campo `openExercise` a `TutorChatRequest`. Expórtalo
       desde el barrel de `shared` si el fichero índice enumera los tipos uno a uno
       (mira cómo se exporta `AttemptEvaluationStage`).
3. [ ] `pnpm run typecheck` fallará en `engine.ts` (le falta `grounded`). Es lo esperado;
       lo cierra el paso 2.

**Comprobación**: decodificar un `EnrichedFeedbackSchema` sin `grounded` da `true`. Se
prueba en el paso 5.

### Paso 2 — El motor acepta el modo sin evidencia

Fichero: `packages/server/src/domain/evaluation/prompts.ts`.

1. [ ] Aplica el cambio de `EvaluationInput` de *Contratos afectados*.
2. [ ] **Traduce los tres system prompts a inglés y renombra los roles** a
       `Good Teacher`, `Bad Teacher`, `Judge`. Conserva la estructura y las reglas
       actuales (no decide la nota; solo el texto aportado; párrafo breve), y cambia
       `Responde en español` por `Answer in English`.
3. [ ] Cada rol necesita **dos** variantes. Hazlo con una función que reciba el modo, no
       con seis constantes sueltas; exporta lo que necesiten los tests y `panel.check.ts`:

   ```ts
   export const goodTeacherSystemPrompt = (mode: EvaluationMode): string => ...
   export const badTeacherSystemPrompt = (mode: EvaluationMode): string => ...
   export const judgeSystemPrompt = (mode: EvaluationMode): string => ...
   ```

   - **grounded**: lo de hoy, traducido. El Juez sigue obligado a copiar citas
     literales y se le avisa de que se verifican por código.
   - **ungrounded**: se elimina toda mención al texto de la página. El bloque central
     pasa a ser: *"There is no source text available for this question. Decide whether the
     student's answer is conceptually equivalent to the expected answer, even if the
     wording differs. Do not invent material quotes: return an empty `citas_pdf` array."*
     El Juez **debe** devolver `citas_pdf: []`.
4. [ ] `questionContext(input)`: en `ungrounded` no imprime el bloque
       `Texto de la página (única fuente permitida)`; imprime en su lugar
       `Source text: not available.` Todo el prompt de usuario pasa también a inglés.
5. [ ] Pide fórmulas en LaTeX con delimitadores de dólar en los tres roles:
       *"Write any mathematical expression in LaTeX between `$…$` (inline) or `$$…$$`
       (display). Never use `\\( \\)` or `\\[ \\]`."* Lo consume el paso 11.

Fichero: `packages/server/src/domain/evaluation/engine.ts`.

6. [ ] Pasa el modo a las funciones de prompt y a `traceBase` (`mode: input.mode`).
7. [ ] Verificación de citas condicionada al modo:

   ```ts
   const citas_pdf = input.mode === "grounded" && input.materialId !== undefined
     ? verifyCitations(judgeOutcome.value.citas_pdf, input.evidence, input.materialId)
     : [];
   ```
8. [ ] El `feedback` devuelto añade `grounded: input.mode === "grounded"`.

Fichero: `packages/server/src/domain/evaluation/trace.ts`.

9. [ ] Añade `mode` a `EvaluationTraceEntry`/`EvaluationTraceDraft`.

### Paso 3 — `review.ts`: el panel siempre corre

Fichero: `packages/server/src/domain/evaluation/review.ts`.

1. [ ] **Borra las tres salidas silenciosas.** Ya no se devuelve `correction` sin pasar
       por el panel. En su lugar, una función que resuelve la evidencia y **nunca falla**:

   ```ts
   interface ResolvedEvidence {
     readonly mode: EvaluationMode;
     readonly materialId: string | undefined;
     readonly pages: readonly number[];
     readonly evidence: readonly PageText[];
   }
   ```

   Reglas, en este orden. En cuanto una no se cumple, el resultado es
   `{ mode: "ungrounded", materialId: <el que haya o undefined>, pages: [], evidence: [] }`:
   - `artifact.source !== undefined`
   - `evidenceForQuestion(artifact.source, question).length > 0`
   - `materialRepository.extractText(materialId, pages)` tiene éxito
     (`Effect.orElseSucceed(() => undefined)`, como hoy)
   - queda alguna página con `text.trim().length > 0`

   Si todas se cumplen: `{ mode: "grounded", materialId, pages, evidence: nonEmptyPages }`.
2. [ ] `reviewCorrection` conserva **solo** la primera guarda: si la pregunta no existe o
       no es `short-answer`, devuelve la corrección tal cual (`review.ts:88-91`).
3. [ ] Llama a `engine.evaluate` siempre, con el `EvaluationInput` que salga de
       `ResolvedEvidence`.
4. [ ] `panelRaisesScore` **conserva nombre y firma** —`panel.check.ts` la importa— y gana
       la rama sin evidencia:

   ```ts
   export const panelRaisesScore = (review: EnrichedFeedbackSchema | undefined): boolean =>
     review !== undefined
       && review.is_correct
       && (review.grounded
         ? review.citas_pdf.some((citation) => citation.verified)
         : true);
   ```

   El comportamiento con `grounded: true` es **idéntico** al de hoy. Los tests de mutación
   del PR-08 tienen que seguir en verde sin tocar su lógica (solo añadiendo `grounded: true`
   a los fixtures).
5. [ ] `noEvidenceTraceEntry` (`review.ts:41-70`) **queda muerta: bórrala.** Ya no hay
       camino que registre una traza sin haber llamado al panel. Comprueba con
       `grep -rn "noEvidenceTraceEntry" packages/` que no queda ningún llamante.
6. [ ] `executeStreaming` (`review.ts:225-296`) **no se toca**. Su `questionIndexById` ya
       contaba todas las `short-answer` con respuesta, incluidas las que hasta hoy no
       llegaban al panel; a partir de este paso la cuenta y la realidad coinciden.

**Comprobación**: `grep -n "return correction" packages/server/src/domain/evaluation/review.ts`
deja exactamente una salida temprana (la del tipo de pregunta) más la del final.

### Paso 4 — La traza registra el modo

Fichero: `packages/server/src/domain/evaluation/trace-format.ts`.

1. [ ] Renombra los rótulos de rol a `Good Teacher` / `Bad Teacher` / `Judge`
       (`trace-format.ts:72,74` y el de `formatJudge`), para que la traza llame a los
       agentes igual que los prompts y la UI.
2. [ ] Añade **una línea nueva** al bloque final, sin tocar las existentes:
       `- **Evidence: PDF page text**` o `- **Evidence: none (conceptual grading)**`, según
       `entry.mode`. Añadir no rompe los `toContain` de `trace-format.test.ts`; **cambiar
       o reordenar sí**. No lo hagas.
3. [ ] El resto del formato (rótulos en español como `Nota modificada por el panel`) **se
       queda como está**: es un artefacto de auditoría, no UI. Ver *Riesgos*.

### Paso 5 — Tests del motor y de la revisión

Objetivo: el recuento sube, no baja.

Fichero: `packages/server/src/domain/evaluation/__tests__/engine.test.ts`.

1. [ ] Líneas 31, 129 y 130 buscan `"Profe Bueno"` / `"Profe Malo"` en el system prompt.
       Cámbialas a `"Good Teacher"` / `"Bad Teacher"`.
2. [ ] Añade un caso: en modo `ungrounded`, `evaluate` **no** llama a `verifyCitations` y
       el `feedback` sale con `citas_pdf: []` y `grounded: false`, aunque el Juez devuelva
       citas.

Fichero: `packages/server/src/domain/evaluation/__tests__/review.test.ts`.

3. [ ] **Reescribe** —no borres— los tres casos que codifican el comportamiento viejo:
   - `:304` *"passes through unchanged when the artifact has no source"* →
     *"runs the panel in ungrounded mode when the artifact has no source, and raises the
     score when the judge says is_correct"*.
   - `:323` *"passes through unchanged when extractText fails"* → mismo giro: el panel
     corre en `ungrounded`.
   - `:341` *"passes through unchanged when the extracted page text is blank"* → ídem.
   En los tres, comprueba además que el `EvaluationInput` que recibió el motor falso lleva
   `mode: "ungrounded"`, `evidence: []` y `pages: []`.
4. [ ] Añade `grounded: true` a los fixtures de veredicto de los casos `:201`, `:222`,
       `:245`, `:265` y a los de `describe("panelRaisesScore")` (`:364-410`). Su
       comportamiento esperado **no cambia**.
5. [ ] Añade dos casos a `panelRaisesScore`: con `grounded: false` e `is_correct: true`
       **sube** aunque `citas_pdf` esté vacío; con `grounded: false` e `is_correct: false`
       **no** sube.
6. [ ] Añade un caso a `packages/server/src/domain/artifacts/__tests__/artifact-schema.test.ts`
       (o donde encaje mejor): decodificar un `ShortAnswerCorrection` cuyo `review` viene
       **sin** `grounded` da `grounded: true`. Es la garantía de que los intentos ya
       guardados en `.data/` siguen leyéndose.

Fichero: `packages/server/src/domain/evaluation/__tests__/review-streaming.test.ts`.

7. [ ] El caso `:251` (*"counts only short-answer questions in questionTotal"*) y el `:264`
       (*"emits the three stages for each evaluated question"*) deben seguir en verde. Si
       su artefacto de prueba tiene `source`, no cambian. **Añade** un caso: un artefacto
       **sin** `source` con una `short-answer` emite igualmente las tres etapas. Esto es
       exactamente el bug que se reportó.

### Paso 6 — `panel.check.ts`

Fichero: `packages/server/src/domain/evaluation/panel.check.ts`.

1. [ ] El `EvaluationInput` que construye pasa a llevar `mode: "grounded"`.
2. [ ] Sustituye las constantes de prompt que usa para imprimir las críticas por las
       nuevas funciones `goodTeacherSystemPrompt("grounded")` /
       `badTeacherSystemPrompt("grounded")`.
3. [ ] Añade un cuarto argumento opcional para forzar el modo, de modo que el modo nuevo
       se pueda probar a mano:
       `panel.check.ts <studentAnswer> <expectedAnswer> <materialId> <page> [grounded|ungrounded]`.
       En `ungrounded` no pide material ni página y pasa `materialId: undefined`,
       `pages: []`, `evidence: []`. Actualiza el texto de `Usage:`.

### Paso 7 — El servidor arma el contexto del ejercicio abierto

Fichero nuevo: `packages/server/src/domain/agents/academic-tutor/artifact-context.ts`.

1. [ ] Función **pura**, sin Effect —el mismo patrón que `buildMaterialsContext`
       (`tutor-chat-service.ts:22-27`), para que se pueda testear sin layers:

   ```ts
   export const buildOpenExerciseContext = (
     artifact: Artifact | undefined,
     attempt: ArtifactAttempt | undefined
   ): string
   ```

   - `artifact === undefined` → `"No exercise is open on the student's screen."`
   - Con artefacto y sin intento: id, `kind`, título y, numeradas, todas las preguntas con
     su enunciado, su tipo legible y su respuesta correcta (`correctOptionId` resuelto a
     texto de opción, `correctAnswer`, `expectedAnswer`) más su `explanation`.
   - Con intento `graded`: lo anterior, y por pregunta la respuesta del alumno, si acertó,
     la puntuación, y —si la corrección trae `review`— el `feedback` del Juez, si fue
     `grounded` y las citas verificadas. Al final, `score / maxScore` y el `summary`.
   - Con intento `ungraded`: solo las respuestas, sin corrección.
   - **Trunca cada texto libre** (enunciado, explicación, feedback, respuesta del alumno)
     a 600 caracteres con `…`. Es prompt, no un volcado: el PR-12 ya costó una fuga por
     meter texto sin límite en el turno del modelo.

Fichero nuevo: `packages/server/src/domain/agents/academic-tutor/__tests__/artifact-context.test.ts`.

2. [ ] Tests de esa función, calcados en estilo a `materials-context.test.ts`: sin
       artefacto; `test` corregido con una `short-answer` con `review`; `quiz` corregido;
       intento `ungraded`; truncado a 600.

Fichero: `packages/server/src/domain/agents/academic-tutor.ts`.

3. [ ] `makeAcademicTutorHarness` recibe un parámetro más, `openExerciseContext: string`,
       detrás de `materialsContext`.
4. [ ] Añade al prompt de persona, **después** de `## Uploaded materials`:

   ```
   ## Exercise open on the student's screen

   ${openExerciseContext}
   ```

5. [ ] Añade a `## Answer directly, without any tool call, when` una viñeta nueva:
       *"The question is about the exercise shown below under "Exercise open on the
       student's screen" — its questions, the student's answers, their marks or why an
       answer was wrong. That block is complete and current for this turn."*
6. [ ] Añade a `## Hard rules`:
       *"Never call `artifacts list`, `artifacts show`, `artifacts attempts` or
       `artifacts grade` for the exercise already shown below. It is the same data, and it
       costs the student seconds."*

Fichero: `packages/server/src/domain/agents/academic-tutor/tutor-chat-service.ts`.

7. [ ] `makeSession` pasa a recibir la petición y a resolver el ejercicio abierto. Ninguna
       de las dos lecturas puede tumbar el chat:

   ```ts
   const makeSession = (input: TutorChatRequest) => Effect.gen(function* () {
     const materials = yield* materialRepository.list().pipe(Effect.orElseSucceed(() => [] as const));
     const ref = input.openExercise;
     const artifact = ref === undefined
       ? undefined
       : yield* artifactRepository.getArtifact(ref.artifactId).pipe(Effect.orElseSucceed(() => undefined));
     const attempt = ref?.attemptId === undefined
       ? undefined
       : yield* artifactRepository.getAttempt(ref.attemptId).pipe(Effect.orElseSucceed(() => undefined));
     const harness = makeAcademicTutorHarness(
       materialRepository,
       artifactRepository,
       buildMaterialsContext(materials),
       buildOpenExerciseContext(artifact, attempt)
     );
     return { harness, session: AgentSession.make(harness) };
   });
   ```

   Ajusta los llamantes de `makeSession` (hoy es un `Effect`, pasa a ser una función que
   devuelve uno). **Descarta el intento si `attempt.artifactId !== artifact.id`**: el
   cliente no dicta qué se lee.
8. [ ] Los otros llamantes de `makeAcademicTutorHarness` —`academic-tutor.ts` como CLI,
       las evals— pasan `""` o el texto de "no exercise open". Búscalos con
       `grep -rn "makeAcademicTutorHarness" packages/`.

### Paso 8 — La web manda qué ejercicio está abierto

Fichero nuevo: `packages/web/src/domain/artifacts/chat-context.ts`.

```ts
import type { OpenExerciseRef } from "@proxus/shared";
import * as Atom from "effect/unstable/reactivity/Atom";

export const openExerciseAtom = Atom.make<OpenExerciseRef | null>(null);
```

Mismo import que `evaluation-atoms.ts:2`. Un atom global evita bajar props de `App` a
`Chat`.

1. [ ] En `ExerciseSolver` (`ArtifactWorkspace.tsx:162`): `useAtomSet(openExerciseAtom)` y
       un `useEffect` que escriba `{ artifactId: artifact.id }` al montar/cambiar de
       artefacto y devuelva `() => set(null)` en la limpieza. Cerrar el artefacto
       desmonta `ArtifactWorkspace` (`App.tsx:22-27`), así que la limpieza basta.
2. [ ] Cuando el stream entrega el frame `done` (`ArtifactWorkspace.tsx:222-226`) y
       también en `submitViaTypedEndpoint`, escribe
       `{ artifactId: artifact.id, attemptId: result.id }`.
3. [ ] `NoteViewer` no escribe nada: una nota no es un ejercicio.
4. [ ] `use-tutor-chat.ts`: lee el atom (`useAtomValue(openExerciseAtom)` desde
       `@effect/atom-react` — verifica el nombre exacto del hook contra los que ya se
       importan en el fichero) y añade el campo al cuerpo, **solo si no es null**, con
       spread condicional por `exactOptionalPropertyTypes`:

   ```ts
   streamTutorMessage(
     { input: prompt, messages: history, ...(openExercise === null ? {} : { openExercise }) },
     { signal: controller.signal }
   )
   ```

   `stream.ts:30-46` reenvía el objeto tal cual; no hay que tocarlo.

**Comprobación**: con un test abierto, la pestaña Red del navegador muestra
`openExercise` en el cuerpo de `POST /api/tutor/chat/stream`.

### Paso 9 — Verdadero/falso: agrupar bien y pintar la selección

Fichero: `packages/web/src/components/ArtifactWorkspace.tsx`.

1. [ ] `TrueFalseInput` recibe `question` (o al menos `questionId`) y el radio pasa a
       `name={question.id}`, como `MultipleChoiceInput` (`:463`). Actualiza la llamada de
       `:407-409`.
2. [ ] Da estado visual explícito a la opción seleccionada, en **los dos** componentes
       (`MultipleChoiceInput` y `TrueFalseInput`). Deriva `const selected = value === …` y
       cámbiale a la `<label>` el borde y el fondo:
       seleccionada `border-brand bg-brand-tint` (o el token equivalente que exista),
       sin seleccionar `border-line bg-surface-muted`.
       **Antes de escribirlo, comprueba en `packages/web/src/styles.input.css` que el
       token existe.** Si no existe, añádelo al bloque `@theme` y una fila a
       `documentacion/design-system.md` en el mismo commit — es la regla dura nº 2 del
       design system. Prohibido un color literal de Tailwind.
3. [ ] Deja la `<label>` con `aria-checked` implícito por el radio nativo: no sustituyas
       el `<input type="radio">` por un `<div>`.

**Comprobación**: en un test con dos verdadero/falso, marcar `False` en las dos deja las
dos pintadas. Antes del arreglo, la segunda desmarcaba a la primera.

### Paso 10 — Etiquetas legibles y UI en inglés

Fichero nuevo: `packages/web/src/domain/artifacts/labels.ts`.

```ts
export const QUESTION_TYPE_LABEL = {
  "multiple-choice": "Multiple choice",
  "true-false": "True / False",
  "short-answer": "Short answer"
} as const satisfies Record<TestQuestion["type"], string>;

export const ARTIFACT_KIND_LABEL = {
  note: "Note",
  quiz: "Quiz",
  test: "Test"
} as const satisfies Record<ArtifactKind, string>;
```

El `satisfies Record<…>` es lo que hace que añadir un tipo de pregunta rompa el
`typecheck` en vez de pasar en silencio.

1. [ ] Tests en `packages/web/src/domain/artifacts/__tests__/labels.test.ts`: hay una
       etiqueta por cada literal del union, y ninguna contiene un guion (el
       `grep`-guard contra la regresión de "etiqueta interna").
2. [ ] Sustituye `{question.type}` (`:392`) por `QUESTION_TYPE_LABEL[question.type]`, y
       quita del badge `fontFamily: "var(--font-mono)"` y `letterSpacing: ".1em"`: eso es
       lo que lo hacía parecer un identificador.
3. [ ] Sustituye `{artifact.kind}` (`:267`) y `` `Submit ${artifact.kind}` `` (`:331`) por
       `ARTIFACT_KIND_LABEL[artifact.kind]`.
4. [ ] Unifica en inglés la capa de evaluación, que hoy está en español:
   - `evaluation/EvaluationProgress.tsx:4-8` → `"Good Teacher analysing…"`,
     `"Bad Teacher challenging…"`, `"Judge deliberating and checking the PDF…"`;
     `"Pregunta X de Y"` → `"Question X of Y"`; `"Corrigiendo…"` → `"Grading…"`;
     `"Cancelar"` → `"Cancel"`.
   - `evaluation/CitationList.tsx`: `"✅ Verificada · … · pág. N"` → `"✅ Verified · … ·
     p. N"`; `"⚠️ Sin verificar en el PDF"` → `"⚠️ Not verified against the PDF"`.
5. [ ] En `ShortAnswerDetails` (`CitationList.tsx:5-27`), tres estados en lugar de dos:
   - `review === undefined` → `correction.feedback` tal cual (como hoy).
   - `review.grounded === false` → tras el feedback, en el mismo estilo de nota que ya
     existe: *"Graded without PDF evidence: the panel judged your answer against the
     expected answer."* y **no** se pinta `CitationList` (viene vacía).
   - `review.grounded === true` y ninguna cita verificada → el aviso de hoy, traducido:
     *"Advisory evaluation: no citation could be verified, so the automatic mark stands."*
6. [ ] En `ExerciseSolver`, bajo el subtítulo de la cabecera (`:270-272`), un aviso solo
       para `artifact.kind === "quiz"`, en `text-ink-mute`:
       *"A quiz is graded deterministically. The three-agent panel reviews the short
       answers of a test."*
7. [ ] Repasa el resto del chrome del solver para que no quede español suelto
       (`CorrectionBadge` ya está en inglés: `Correct` / `Review`).

**Comprobación (guard obligatorio de UI, `documentacion/design-system.md:275`)**:

```bash
grep -rnE '(bg|text|border|ring|from|to|via|fill|stroke|placeholder|divide|shadow|accent)-(slate|sky|indigo|emerald|red|blue|gray|zinc|neutral|stone|violet|purple)-[0-9]{2,3}' packages/web/src/
```

Tiene que dar **0**.

### Paso 11 — Markdown y fórmulas

1. [ ] Añade a `packages/web/package.json` (`dependencies`):
       `remark-math` `^6`, `rehype-katex` `^7`, `katex` `^0.16`. `pnpm install`.
       **No uses `@streamdown/math`**: no está publicado como dependencia consumible desde
       aquí, solo como devDependency interna de `streamdown`.
2. [ ] `packages/web/src/main.tsx`: `import "katex/dist/katex.min.css";` junto a
       `import "./styles.input.css";`.
3. [ ] Fichero nuevo `packages/web/src/lib/math.ts`, función **pura**:

   ```ts
   /** Gemini escribe \( … \) y \[ … \]; remark-math solo entiende $ … $ y $$ … $$. */
   export const normalizeMath = (text: string): string => ...
   ```

   Convierte `\(…\)` → `$…$` y `\[…\]` → `$$…$$`. **No toca** lo que esté dentro de un
   bloque de código (``` … ``` o `` ` ``): una guía de Python con `\[` en un string no se
   puede reescribir.
4. [ ] Tests en `packages/web/src/lib/__tests__/math.test.ts`: inline, display, varias por
       texto, texto sin fórmulas intacto, `$…$` ya correcto intacto, contenido de bloque
       de código intacto.
5. [ ] Fichero nuevo `packages/web/src/components/Markdown.tsx`: un único envoltorio que
       centraliza la configuración.

   ```tsx
   import { Streamdown } from "streamdown";
   import remarkMath from "remark-math";
   import rehypeKatex from "rehype-katex";
   import { normalizeMath } from "../lib/math.ts";

   export function Markdown({ children }: { readonly children: string }) {
     return (
       <Streamdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
         {normalizeMath(children)}
       </Streamdown>
     );
   }
   ```

   `remarkPlugins` y `rehypePlugins` son props reales de `StreamdownProps` (están en
   `streamdown/dist/index.d.ts:71-72`).

   **Trampa a comprobar antes de darlo por bueno**: Streamdown trae `rehype-harden` y
   `rehype-sanitize` por defecto y puede borrar el markup que genera KaTeX. Si las
   fórmulas salen como texto suelto sin estilo, hay que permitir las etiquetas de KaTeX
   (`span`, `math`, `semantics`, `annotation`, `mrow`, `mi`, `mo`, `mn`…) por la prop
   `allowedTags`. **Si ni con eso renderiza, para y notifica** antes de cambiar de
   librería.
6. [ ] Sustituye los tres `<Streamdown>` sueltos por `<Markdown>`: `Chat.tsx:230`,
       `ArtifactWorkspace.tsx:157` (nota) y `evaluation/CitationList.tsx:15` (feedback del
       Juez). `Chat.tsx:3` ya importa `streamdown/styles.css`; déjalo.
7. [ ] Pasa por `<Markdown>` lo que hoy es texto plano en el solver:
       el enunciado (`:398`), el texto de cada opción (`:469`) y las dos explicaciones
       (`:568`, `:574`). Para el enunciado, **no metas markdown de bloque dentro del
       `<h3>`**: deja `{index + 1}.` en el `<h3>` y pinta el enunciado en un contenedor
       hermano con los mismos estilos tipográficos.
8. [ ] `styles.input.css` tiene un `@source "../node_modules/streamdown/dist/*.js"`. Si
       alguna clase de Tailwind que uses en `Markdown.tsx` no se genera, es por ahí
       (`GUIA-DOER.md` §5). El CSS de KaTeX **no** pasa por Tailwind: entra por el import
       del paso 11.2.

### Paso 12 — Que el modelo escriba las fórmulas como toca

Fichero: `packages/server/src/domain/agents/academic-tutor/skills/create-study-artifacts.ts`.

1. [ ] Añade a las reglas de autoría: *"Write any mathematical expression in LaTeX between
       `$…$` (inline) or `$$…$$` (display), in prompts, options and explanations. Never use
       `\\( \\)` or `\\[ \\]`."*
2. [ ] Añade la misma línea al prompt de persona del tutor (`academic-tutor.ts`), para el
       markdown que escribe en el chat.

### Paso 13 — El razonamiento de los dos profes, en vivo

El paso más grande del PR y el único que toca el proveedor del modelo. Va en este orden:
sin 13.1 los demás sub-pasos no tienen nada que mostrar.

#### 13.1 — `gemini.ts` aprende a hacer streaming

Fichero: `packages/server/src/domain/agents/gemini.ts`.

1. [ ] Añade la URL de streaming junto a la que ya hay (`:151-152`):

   ```ts
   const geminiStreamUrl = (model: string, apiKey: string) =>
     `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
   ```

   `alt=sse` es obligatorio. Sin él, Gemini devuelve un array JSON entero al final y no
   habrá nada incremental que enseñar.

2. [ ] `generationConfig` (`:241-251`) devuelve hoy `undefined` cuando
       `responseFormat.type !== "json"`. Añade `thinkingConfig: { includeThoughts: true }`
       **sólo en la rama no-JSON**, para que Gemini mande partes con `thought: true`.
       **Compruébalo contra el modelo configurado** (`gemini-3.6-flash`): si la API
       responde 400 por ese campo, quítalo y sigue — el canal `thought` se queda vacío y
       el entregable real, que es la crítica en vivo (canal `text`), no depende de él.
       Anota en el cuerpo del PR lo que hayas observado.

3. [ ] Extrae el troceado de SSE a una función **pura y exportada**, en un fichero nuevo
       `packages/server/src/domain/agents/gemini-sse.ts`, para poder testearla sin red:

   ```ts
   /** Acumula un buffer y devuelve los payloads `data:` completos más el resto sin cerrar. */
   export const parseSseChunk = (
     buffer: string,
     chunk: string
   ): { readonly events: readonly string[]; readonly rest: string };
   ```

   Requisitos, todos con test:
   - separa eventos por línea en blanco (`\n\n`), y aguanta `\r\n`;
   - ignora líneas `:` (comentarios/keep-alive) y cualquier campo que no sea `data:`;
   - un `data:` partido entre dos chunks de red **no se pierde**: se queda en `rest`;
   - `data: [DONE]` se devuelve como evento y lo filtra el llamante.

   Tests en `packages/server/src/domain/agents/__tests__/gemini-sse.test.ts`.

4. [ ] Sustituye `streamText: () => Stream.empty` (`:474`) por una implementación real.
       Forma esperada:

   - `fetch(geminiStreamUrl(...), { method: "POST", body: JSON.stringify(requestBody(options)) })`
     — el mismo `requestBody` que usa `generateText`, sin duplicarlo.
   - Si `!response.ok`, falla con `toAiError(await response.text())`. **No** devuelvas un
     stream vacío: ese es exactamente el fallo silencioso que tiene el repo hoy.
   - Recorre `response.body` con su reader, decodifica UTF-8, pásalo por `parseSseChunk`,
     y decodifica cada payload con el `GeminiResponse` que **ya existe** (`:24-39`): los
     chunks de `streamGenerateContent` tienen la misma forma que la respuesta completa.
   - Por cada parte de cada chunk emite, en `Response.StreamPartEncoded`:
     - `part.thought === true` y `part.text` → `reasoning-start` (una vez), luego
       `reasoning-delta` con `{ id, delta: part.text }`, y `reasoning-end` al acabar;
     - `part.thought !== true` y `part.text` → `text-start` (una vez) / `text-delta` /
       `text-end`.
     Un `id` estable por canal (p. ej. `"text"` y `"reasoning"`); `start` se emite en la
     primera parte de ese canal, `end` al cerrar el stream, y sólo si hubo `start`.
   - Las partes `functionCall` **se ignoran** en streaming: el bucle del agente sigue por
     `generateText` (ver *Fuera de alcance*), así que aquí nunca llegan tools.
   - Constrúyelo con `Stream.callback` — el mismo patrón que ya usa
     `reviewGradedAttemptStreaming` (`review.ts:298-312`) — y cierra la cola con
     `Queue.end` tanto en el camino bueno como en el de error.

5. [ ] Comprobación sin gastar API: `grep -n "Stream.empty" packages/server/src/domain/agents/gemini.ts`
       da **0 aciertos**.

#### 13.2 — El motor emite lo que escriben los profes

Fichero: `packages/server/src/domain/evaluation/engine.ts`.

1. [ ] Aplica el cambio de `EvaluationProgressEvent` de *Contratos afectados*. Los dos
       `emit("evaluating_good")` / `emit("evaluating_bad")` / `emit("deliberating")`
       actuales (`:69-72`, `:88-90`) pasan a `emit({ _tag: "stage", stage: … })`.

2. [ ] `runTeacher` (`:39-49`) pasa de `generateText` a `streamText`, **conservando su
       firma de salida** `{ text }` para que el Juez, `teacherOutcome` y la traza no se
       enteren:

   ```ts
   const runTeacher = (
     agent: PanelAgent,
     systemPrompt: string,
     userPrompt: string,
     emit?: (event: EvaluationProgressEvent) => Effect.Effect<void>
   ) => Effect.gen(function* () {
     let text = "";
     yield* LanguageModel.streamText({
       prompt: [
         { role: "system" as const, content: systemPrompt },
         { role: "user" as const, content: userPrompt }
       ],
       toolChoice: "none" as const
     }).pipe(
       Stream.runForEach((part) => {
         if (part.type === "text-delta") {
           text += part.delta;
           return emit?.({ _tag: "reasoning", agent, channel: "text", delta: part.delta })
             ?? Effect.void;
         }
         if (part.type === "reasoning-delta") {
           return emit?.({ _tag: "reasoning", agent, channel: "thought", delta: part.delta })
             ?? Effect.void;
         }
         return Effect.void;
       })
     );
     return { text };
   }).pipe(Effect.timeout(TEACHER_TIMEOUT_MS));
   ```

   Verifica los nombres exactos de las variantes (`"text-delta"`, `"reasoning-delta"`) y
   el nombre del campo (`delta`) contra
   `effect/unstable/ai/Response.ts:689-698,330-348` antes de escribirlo.

3. [ ] **Un stream que termina sin una sola parte de texto es un fallo, no un éxito
       vacío.** Si `text.trim().length === 0`, falla el efecto. Sin esta guarda, un error
       en 13.1 degrada el panel a "sólo Juez" sin que nada lo diga — es el mismo fallo
       silencioso que este paso viene a quitar.

4. [ ] `Effect.all([...], { concurrency: "unbounded", mode: "result" })` (`:74-80`) **no
       cambia**: los dos profes siguen en paralelo y el `mode: "result"` sigue
       absorbiendo el fallo de cualquiera de ellos. Los deltas de los dos se entrelazan;
       por eso el frame lleva `agent`. `Promise.all` sigue prohibido.

5. [ ] `TEACHER_TIMEOUT_MS = 20_000` (`:19`) ahora cubre el stream entero, no una sola
       llamada. Déjalo en 20 s y anótalo en el cuerpo del PR.

Fichero: `packages/server/src/domain/evaluation/review.ts`.

6. [ ] `stageEmit` (dentro de `executeStreaming`) pasa a traducir el evento del motor al
       frame NDJSON:

   ```ts
   const panelEmit = (event: EvaluationProgressEvent) =>
     event._tag === "stage"
       ? emit({ type: "status", value: event.stage, questionId: correction.questionId, questionIndex, questionTotal })
       : emit({ type: "reasoning", agent: event.agent, channel: event.channel, delta: event.delta, questionId: correction.questionId, questionIndex, questionTotal });
   ```

   `reviewCorrection` sólo cambia el tipo del parámetro `emit`; el camino **no** streaming
   (`reviewGradedAttempt`) lo sigue llamando sin `emit` y no cambia.

#### 13.3 — Tests del servidor

1. [ ] `engine.test.ts`: el `LanguageModel` falso de ese fichero implementa hoy
       `generateText`. **Tiene que implementar también `streamText`**, devolviendo un
       `Stream` de partes encodeadas; si no, los dos profes se quedan mudos y los casos
       que ya existen se ponen rojos. Dos casos nuevos:
   - los deltas de texto llegan al `emit` con el `agent` correcto y en orden, y el `text`
     acumulado que recibe el Juez es la concatenación exacta;
   - un profe cuyo stream no emite texto se trata como fallido: el Juez recibe
     `"No disponible…"` y la traza lo registra, exactamente como hoy con `generateText`.
2. [ ] `review-streaming.test.ts`: un caso nuevo — los frames `reasoning` salen **entre**
       el `status` y el `done`, llevan `questionId` y nunca aparecen después del `done`.
       El invariante que ya custodia ese fichero (*"always ends with exactly one terminal
       'done' frame"*) tiene que seguir verde.
3. [ ] `packages/web/src/lib/__tests__/ndjson.test.ts`: un caso con una línea `reasoning`
       intercalada, para fijar que el lector la entrega y no la descarta.

#### 13.4 — La UI pinta el transcript

Fichero: `packages/web/src/domain/artifacts/evaluation-atoms.ts`.

1. [ ] La fase `running` gana el transcript acumulado:

   ```ts
   export type PanelTranscript = Readonly<Record<PanelAgent, {
     readonly thought: string;
     readonly text: string;
   }>>;

   export const emptyTranscript: PanelTranscript = {
     good_teacher: { thought: "", text: "" },
     bad_teacher: { thought: "", text: "" }
   };
   ```

   `{ phase: "running", …, readonly transcript: PanelTranscript }`.

Fichero: `packages/web/src/components/ArtifactWorkspace.tsx`.

2. [ ] En el bucle del stream (`:204-228`), rama nueva para `event.type === "reasoning"`:
       concatena `event.delta` sobre `transcript[event.agent][event.channel]`.
       **Descarta el frame si `event.questionId` no es el de la pregunta en curso**: al
       pasar de pregunta el transcript se vacía con `emptyTranscript`.
       El frame `status` que abre una pregunta nueva también lo vacía.
3. [ ] La rama `done`/`error` no necesita tocar el transcript: la fase cambia y el
       componente desaparece.

Fichero: `packages/web/src/components/evaluation/EvaluationProgress.tsx`.

4. [ ] Bajo la fila de `evaluating_good` y la de `evaluating_bad` —y sólo esas dos; la del
       Juez no lleva transcript— pinta el texto acumulado de ese agente cuando no esté
       vacío:
   - el canal `thought` primero, en `text-ink-faint`, `fontStyle: "italic"`, precedido de
     `Thinking…`;
   - el canal `text` debajo, en `text-ink-soft`;
   - contenedor con `maxHeight: 180`, `overflowY: "auto"`, `whiteSpace: "pre-wrap"`,
     `fontSize: 12.5`, y el borde/fondo de tokens que ya usa la tarjeta
     (`border-line` / `bg-surface-muted`). **Ningún color literal de Tailwind.**
5. [ ] **Auto-scroll**: un `useRef` al contenedor y un `useEffect` que, cuando cambie el
       texto, haga `el.scrollTop = el.scrollHeight`. Sin esto el alumno ve siempre las
       primeras líneas y el efecto "en vivo" no se aprecia.
6. [ ] **Accesibilidad.** El `<div aria-live="polite">` que envuelve hoy todo el
       componente (`:21`) no puede envolver el transcript: un lector de pantalla leería
       cada token. Pon `aria-live="off"` explícito en el contenedor del transcript y deja
       la región `polite` **sólo** sobre la lista de etapas. Etiqueta el contenedor con
       `aria-label` (`"Good Teacher reasoning"` / `"Bad Teacher reasoning"`).
7. [ ] El botón `Cancel` sigue donde está y sigue abortando: comprueba que al pulsarlo el
       transcript deja de crecer.
8. [ ] Los rótulos van en inglés, como todo lo demás tras el paso 10.

**Comprobación**: el guard de color del design system sigue dando 0.

### Paso 14 — Documentación

Sin esto el repo vuelve a describir un sistema que ya no existe.

1. [ ] `documentacion/funcionamiento-actual.md` §5: hoy dice *"Sin evidencia (sin página,
       sin texto extraíble, o si el LLM falla) se conserva íntegra la corrección `===`
       determinista"* y *"Los artifacts no guardan de qué material salieron"* (falso: hay
       `source` en el schema desde el PR-02). Reescribe el párrafo con los dos modos y con
       la regla de nota nueva.
2. [ ] `documentacion/funcionamiento-actual.md` §7: el bloque del PR-07 sobre
       `EvaluationProgress` y `ShortAnswerDetails`; añade el tercer estado, el idioma y el
       transcript en vivo de los dos profes.
3. [ ] `documentacion/funcionamiento-actual.md` §2: el cuerpo de la petición de chat ahora
       puede llevar `openExercise`.
3bis. [ ] `documentacion/funcionamiento-actual.md` §6 (Gemini): hoy el proveedor se
       describe sin streaming. Documenta `streamText` contra
       `:streamGenerateContent?alt=sse`, el mapeo `thought → reasoning-*`, y que el
       **harness del agente sigue en `generateText`**, para que nadie dé por hecho que el
       chat ya va en streaming.
3ter. [ ] `documentacion/funcionamiento-actual.md` §5: el contrato NDJSON de corrección
       tiene un cuarto frame, `reasoning`.
4. [ ] `docs/testing.md`: la QA manual del panel ya no exige un PDF; añade el caso sin
       evidencia, el del quiz y el del transcript en vivo.
5. [ ] `planes/GUIA-DOER.md` §3: añade la fila del PR-14 a la tabla del roadmap y
       actualiza el recuento de planes (hoy dice 16) y la cifra de referencia de tests.
6. [ ] `README.md`: si describe el panel como algo que ocurre "cuando la pregunta viene de
       un PDF", corrígelo.

---

## Criterio de aceptación

Comportamiento observable, comprobado en la UI o con `curl`:

1. [ ] Un `test` **sin `source`** con una respuesta corta: al enviar se ven las tres filas
       del panel (`Good Teacher` / `Bad Teacher` / `Judge`) y el contador
       `Question 1 of N`.
2. [ ] En ese mismo test, una respuesta conceptualmente correcta pero escrita con otras
       palabras puntúa **1/1**, no 0, y bajo la pregunta aparece el feedback del Juez y la
       nota *"Graded without PDF evidence…"*.
3. [ ] Una respuesta claramente incorrecta sigue puntuando **0**, con el feedback del
       Juez explicando por qué.
4. [ ] Un `test` **con `source`** y PDF con capa de texto sigue comportándose como hoy: la
       nota solo sube si alguna cita queda `✅ Verified`, y las citas se pintan.
5. [ ] Ninguna corrección de `short-answer` de un `test` llega a la UI sin haber pasado
       por el panel, salvo que el LLM falle (entonces la nota determinista queda intacta y
       el intento no se rompe).
6. [ ] Un `quiz` muestra el aviso de corrección determinista y **no** dispara el panel.
7. [ ] Con un test corregido en pantalla, *"dime en qué he fallado"* se contesta con
       **cero tool calls** (el contador de pasos del chat, PR-07, se queda en 1) y la
       respuesta cita preguntas y notas reales de ese intento.
8. [ ] Con el artefacto cerrado, la misma pregunta vuelve a comportarse como antes: el
       agente puede usar tools. No se ha roto el camino sin contexto.
9. [ ] En un test con dos verdadero/falso, marcar `False` en ambas deja **las dos**
       pintadas como seleccionadas, con borde y fondo propios, no solo el punto del radio.
10. [ ] En ninguna pantalla aparece `short-answer`, `true-false`, `multiple-choice`,
        `quiz` ni `test` en minúscula con guion. Se leen `Short answer`, `True / False`,
        `Multiple choice`, `Quiz`, `Test`.
11. [ ] Una pregunta cuyo enunciado lleve `$x^2 + y^2 = z^2$` se pinta como fórmula, igual
        que el feedback del Juez en el chat y en la corrección.
12. [ ] La UI no tiene español suelto: ni el solver, ni el panel, ni las citas.
13. [ ] Un intento ya guardado en `.data/artifacts/attempts/` de antes de este PR se abre
        sin error de decodificación.
14. [ ] Mientras las filas `Good Teacher` y `Bad Teacher` están activas, **bajo cada una
        crece su texto en vivo**, token a token, y las dos avanzan a la vez. No es un
        bloque que aparece de golpe al terminar: se ve escribir.
15. [ ] El texto que se leyó en vivo bajo `Good Teacher` coincide con el que queda en
        `.data/sessions/<attemptId>.md` bajo `Good Teacher`. Lo que se enseña es lo que se
        usó, no un adorno.
16. [ ] La fila del `Judge` **no** lleva transcript: sigue con su spinner.
17. [ ] Con varias respuestas cortas, al pasar de una pregunta a la siguiente el
        transcript se vacía. No se mezclan razonamientos de preguntas distintas.
18. [ ] `Cancel` durante el streaming detiene el crecimiento del texto y vuelve a `idle`.
19. [ ] Si el modelo no devuelve partes de pensamiento, se ve igualmente la crítica en
        vivo. La funcionalidad no depende de `includeThoughts`.
20. [ ] Si el endpoint de streaming falla, el profe cuenta como fallido —el Juez recibe
        *"No disponible…"* y la traza lo registra— y el intento **se corrige igualmente**.
        Nunca se queda un profe en blanco simulando que va bien.

## Checks

```bash
pnpm run typecheck                      # gate principal, tras cada paso
pnpm -r test                            # sin API key ni red; >= 151 tests
pnpm --filter @proxus/web run build

# guard de color del design system: tiene que dar 0
grep -rnE '(bg|text|border|ring|from|to|via|fill|stroke|placeholder|divide|shadow|accent)-(slate|sky|indigo|emerald|red|blue|gray|zinc|neutral|stone|violet|purple)-[0-9]{2,3}' packages/web/src/

# no queda código muerto del camino viejo
grep -rn "noEvidenceTraceEntry" packages/          # 0 aciertos
grep -rn "Profe Bueno\|Profe Malo" packages/web/   # 0 aciertos
grep -n "Stream.empty" packages/server/src/domain/agents/gemini.ts   # 0 aciertos
```

Con API key (`.env`), **los tres, y se anota el resultado real**:

```bash
pnpm --filter @proxus/server run panel:check "el método get" "get" <materialId> <page>
pnpm --filter @proxus/server run panel:check "el método get" "get" - - ungrounded
pnpm --filter @proxus/server run eval:tutor:artifact-authoring
```

`panel:check` es además la forma barata de probar el streaming del paso 13 sin abrir el
navegador: imprime las críticas de los dos profes llamando al modelo directamente. Si tras
el paso 13.1 **sale vacío**, el `streamText` nuevo está roto; párate ahí antes de tocar la
UI.

Para ver los frames `reasoning` llegar de uno en uno, `curl -N` desactiva el buffering
(`GUIA-DOER.md` §6):

```bash
curl -N -X POST http://localhost:3000/api/artifacts/<id>/submit/stream \
  -H 'content-type: application/json' -d '{...}'
```

Si no hay API key, `docs/testing.md` obliga a **decirlo explícitamente** en el cuerpo del
PR. No lo des por probado.

## QA manual

Con `pnpm run dev` y al menos un PDF con capa de texto en
`packages/server/.data/materials/pdfs/`.

1. Pide al tutor en el chat: *"hazme un test de 3 preguntas cortas sobre fotosíntesis"*
   (sin mencionar ningún material, para que salga **sin `source`**). Ábrelo.
2. Contesta las tres con tus palabras, correctamente. Envía.
   → se ven las tres filas del panel; la nota es 3/3; bajo cada pregunta, el feedback del
   Juez y la nota de "sin evidencia del PDF". **Este es el bug del reporte.**
3. `Try again`, contesta una a propósito mal → esa puntúa 0 con explicación.
4. Pide *"hazme un test con respuestas cortas a partir de <material>"*, ábrelo, contesta
   con tus palabras → mismas tres filas, y ahora además citas `✅ Verified` con su página.
5. Con ese test corregido en pantalla, escribe en el chat *"dime en qué he fallado"*
   → contesta **en el primer paso**, sin encadenar tools, y menciona tus respuestas
   reales.
6. Cierra el artefacto (`Close`) y repite la pregunta → el agente vuelve a usar tools.
   Nada se ha roto.
7. Abre un quiz → aviso de corrección determinista; al enviar **no** aparece el panel.
8. En un test con dos verdadero/falso, marca `False` en ambas → las dos quedan pintadas.
9. Mira los badges de tipo de pregunta → `Short answer`, no `short-answer`.
10. Pide al tutor una fórmula en el chat (*"escríbeme el teorema de Pitágoras"*) → se
    renderiza, no sale `$…$`.
11. Abre `packages/server/.data/sessions/<attemptId>.md` del paso 2 → hay una sección por
    pregunta, con `Good Teacher` / `Bad Teacher` / `Judge` y la línea de evidencia.
12. **Transcript en vivo** (el añadido del paso 13). Repite el envío del paso 2 mirando el
    panel sin parpadear: bajo `Good Teacher` y bajo `Bad Teacher` el texto **crece solo**,
    las dos columnas a la vez, con auto-scroll. Si aparece de golpe al final, el streaming
    no está funcionando y estás viendo el `generateText` de siempre.
13. Compara lo que leíste con el fichero del punto 11: el texto del Profe Bueno tiene que
    ser el mismo.
14. Haz un test con **dos** respuestas cortas → al arrancar la segunda pregunta el
    transcript se vacía y empieza de cero.
15. Pulsa `Cancel` a mitad del streaming → el texto deja de crecer y el panel vuelve a
    `idle`.
16. Corta la red (o mete una API key inválida) y envía → los dos profes fallan, el panel
    no se queda colgado y el intento se corrige con la nota determinista.

## Riesgos y decisiones

- **Latencia.** Antes, un test sin `source` se corregía al instante. Ahora cada respuesta
  corta cuesta dos llamadas en paralelo a Gemini más la del Juez. Es el precio de que la
  parte diferencial del producto se vea; `EvaluationProgress` ya existe para que la espera
  sea legible, y el botón `Cancel` ya funciona.
- **Nota sin evidencia.** En modo `ungrounded` la nota la decide un LLM sin fuente que
  verificar: es más generoso y menos auditable que el modo con PDF. Se asume a conciencia,
  se marca en la UI y queda registrado en la traza. La alternativa —seguir puntuando 0 una
  respuesta correcta— es peor para el alumno, que es de quien va el producto. La regla
  estricta con PDF **no se relaja**: `panelRaisesScore` con `grounded: true` es
  byte-a-byte la de hoy, y sus tests de mutación lo custodian.
- **Confianza en lo que manda el cliente.** `openExercise` lleva solo ids; el contenido lo
  lee el servidor del repositorio, y el intento se descarta si no pertenece al artefacto.
  Un cliente no puede inyectar notas falsas en el prompt.
- **Tamaño del prompt.** El contexto del ejercicio abierto crece con el número de
  preguntas. Por eso el truncado a 600 caracteres por campo. Si un test de 20 preguntas
  hace el prompt inmanejable, el siguiente paso (no en este PR) es enviar solo las
  preguntas falladas.
- **La traza se queda medio en español.** Se traducen los rótulos de rol (para que la
  traza llame a los agentes igual que el resto del sistema) y se añade la línea de modo,
  pero los demás rótulos (`Nota modificada por el panel`) siguen en español. Traducirlos
  obligaría a reescribir los 19 tests de `trace-format.test.ts` sin ganar nada para el
  alumno: la traza es un artefacto de auditoría, no interfaz. Decisión consciente; si
  molesta, es un PR de una tarde aparte.
- **Sanitizado de KaTeX por Streamdown.** Es la incógnita técnica del PR y está aislada en
  un solo fichero (`Markdown.tsx`). El paso 11.5 dice qué comprobar y cuándo parar.
- **El `name` del radio no lo caza ningún test.** El bug es de semántica del DOM y
  `packages/web` corre vitest con `environment: "node"`, sin jsdom ni testing-library.
  Añadir ese andamiaje no entra en este PR: el arreglo se custodia con el criterio de
  aceptación nº 9 en la QA manual.
- **Un `test` sin `source` y sin API key** sigue puntuando por `===`. Es la red de
  seguridad declarada del ADR-01 y no cambia: sin LLM no hay panel.
- **Implementar `streamText` es el trozo con más riesgo del PR, y toca el fichero más
  delicado del repo.** `gemini.ts` es donde viven la fuga de tool calls del PR-12, el
  reintento con `mode:ANY` y los `thoughtSignature`. Mitigación: `generateText` **no se
  toca en ninguna línea** —el bucle del agente sigue exactamente igual— y el troceado de
  SSE sale a `gemini-sse.ts` como función pura con tests, que es donde de verdad se
  esconden los bugs (un `data:` partido entre dos chunks TCP no se reproduce a mano).
- **El fallo silencioso es el enemigo, no el fallo.** Hoy `streamText: () => Stream.empty`
  devuelve cero partes sin error: es justo el patrón que hace que un bug de streaming
  parezca "el modelo no dijo nada". Por eso el paso 13.2.3 convierte un stream sin texto
  en un fallo explícito, y por eso `!response.ok` falla en vez de devolver un stream
  vacío.
- **`includeThoughts` puede no estar disponible** en el modelo configurado, o costar
  tokens extra. El plan lo trata como un extra: el canal `text` —la crítica que el Juez
  acaba leyendo— es el entregable, y funciona sin `thinkingConfig`. Si la API lo rechaza,
  se quita y el PR sigue siendo válido.
- **Lo que se enseña es lo que se usa.** El transcript no es una animación decorativa: es
  literalmente el texto que se acumula en `good`/`bad` y que viaja al prompt del Juez y a
  la traza. El criterio de aceptación nº 15 lo comprueba comparando pantalla y fichero.
  Si algún día se separan, es un bug de honestidad, no de UI.
- **Coste en tokens.** El streaming no añade llamadas: son las mismas dos al modelo, sólo
  que leídas incrementalmente. `includeThoughts` sí añade tokens de pensamiento a la
  factura. Es el único sobrecoste del paso 13.
- **Ruido para lectores de pantalla.** Un `aria-live="polite"` sobre texto que crece token
  a token es inusable. Por eso el paso 13.4.6 saca el transcript de la región viva y deja
  el anuncio en la lista de etapas, que cambia tres veces por pregunta y no trescientas.

## Historial

_(Vacío. Lo rellena el thinker si el doer reporta que algo de este plan no cuadra con el
código.)_
