# PR-16 — El panel deja de esconderse: razonamiento por profe, indicador honesto e idioma del alumno

**Rama**: `feat/panel-transparente`
**Depende de**: sale de `fix/gemini-reintentos` (`8eb3231`), **no de `main`**. Toca `prompts.ts`, `engine.ts` y `review.ts`, que el PR-14 reescribió y el PR-15 acaba de cablear con reintentos. Hacerlo desde `main` garantiza conflicto.
**Estado**: borrador
**Contiene LLM**: sí — se tocan los 6 bloques de prompt del panel y la skill `create-study-artifacts`.
**Fichero delicado**: `packages/server/src/domain/evaluation/review.ts`. Se toca `resolveEvidence` y el punto de construcción de la corrección. **No se toca** `panelRaisesScore` (regla de nota, cubierta por 5 tests) ni `correctQuestion` (ADR-01).
**Origen**: reporte de uso del 15-sep-2026. Cuatro síntomas: (1) toda corrección de desarrollo dice "Graded without PDF evidence"; (2) no hay forma de saber si el panel avanzado corrió; (3) el razonamiento del profe bueno y del malo llega fundido en un solo párrafo; (4) el enunciado va en español y el feedback en inglés.

> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica con el formato de `planes/GUIA-DOER.md` §4.

---

## Contexto

El PR-14 hizo que el panel de tres agentes corriera siempre en las preguntas `short-answer` de un `test`, y el PR-15 lo blindó con reintentos. Funciona. Pero al usarlo de verdad, el panel es opaco por tres motivos distintos y un cuarto de higiene:

**1. El grounding está roto en la práctica.** `resolveEvidence` (`review.ts:61-94`) necesita `artifact.source.materialId` para saber de qué PDF extraer texto, y sale por la puerta de `artifact.source === undefined` (`:66-67`) **antes** de mirar `question.sourcePage`. Datos reales de `packages/server/.data/artifacts/artifacts/`: 5 artefactos, **3 sin `source`**. El peor caso es `fb7f40ae-1c2e-4551-856a-fc037ee99c47.json` (15-sep 20:34), un `test` cuyas preguntas q4 y q5 traen `sourcePage: 3` y `sourcePage: 8` — el modelo sabía de qué página venían y aun así el artefacto no tiene `source`, así que esa información es inservible.

La razón es de prompt, no de código: `sourcePage` aparece en los ejemplos del `--help` (`artifact-commands.ts:154-172`) y `source` **no aparece en ninguno de los cuatro**. La skill lo pide en `create-study-artifacts.ts:59-65` pero lo lista como `Optional:` en `:25-27` y lo omite en 3 de sus 4 ejemplos (`:39-42`). El modelo copia los ejemplos.

Consecuencia visible: `mode: "ungrounded"` → `citas_pdf: []` forzado (`engine.ts:167-169`) → `grounded: false` → la UI pinta `CitationList.tsx:18` *"Graded without PDF evidence: the panel judged your answer against the expected answer."* Y peor: la traza `e61ee263-32a8-4202-93a5-ce1659c4f247.md:30` muestra `**Nota modificada por el panel: sí** (0 citas verificadas)` — la nota subió de 0 a 1 por juicio puro del LLM, sin PDF, porque en ungrounded `panelRaisesScore` (`review.ts:57-59`) no exige citas.

Que el pipeline grounded funciona cuando hay `source` está probado: las trazas de `16bc4e1d`, `32c576cc`, `8febde8b`, `b1dfa532`, `bf31080f` y `d8a04630` dicen `- **Evidence: PDF page text**`, y `8febde8b….md:82` registra una subida de nota con `(1 cita verificada)`.

**2. No hay indicador de si el razonamiento avanzado se usó.** El alumno no distingue "el panel deliberó y confirmó tu respuesta" de "el Juez se cayó por cuota de Gemini y quedó la nota determinista". El proxy actual es `correction.review !== undefined` (`CitationList.tsx:5-7`), que no se muestra. Las trazas reales están llenas de `_No disponible: GeminiLanguageModel… quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier_` y de un `TimeoutError` del Good Teacher: fallos invisibles para quien usa la app.

**3. Los razonamientos de los dos profes se pierden.** `engine.ts:96-136` los produce (dos `streamText` en paralelo, `mode: "result"`), los mete en el prompt del Juez como texto plano (`prompts.ts:122-130`) y le pide `write feedback in prose that consolidates both views` (`prompts.ts:75`). El resultado que se persiste (`engine.ts:171-177`) es solo `{ is_correct, feedback, citas_pdf, grounded }` — `good` y `bad` sobreviven únicamente en la traza de disco `.data/sessions/<attemptId>.md` (`trace.ts:17-21`). En la UI se ven en vivo durante el streaming (`EvaluationProgress.tsx:18-60`) y **se borran al terminar**: la fase `done` no lleva transcript (`evaluation-atoms.ts:24`) y cambiar de pregunta lo vacía (`ArtifactWorkspace.tsx:231`). El PR-14 dejó esto explícitamente pendiente: *"Pintarlo en el resultado es un añadido posterior."*

**4. El idioma está clavado a inglés.** `prompts.ts` repite `- Answer in English.` en seis sitios (`:33`, `:44`, `:57`, `:68`, `:82`, `:92`). Mientras tanto la `explanation` de las preguntas cerradas la escribe el tutor de chat al crear el artefacto, y ese sí responde en el idioma del alumno (`session.ts:119`, `:149`). De ahí que un mismo test muestre explicaciones en español y feedback de desarrollo en inglés.

**Resultado buscado**: que una corrección de desarrollo diga con claridad si el panel corrió y con qué evidencia, deje abrir el debate completo de los tres agentes por separado en un modal legible, y hable el idioma del examen.

---

## Objetivo

1. El tutor rellena `source` al crear artefactos, porque los ejemplos y la skill dejan de presentarlo como opcional.
2. Cuando el grounding falla igualmente, se sabe **por qué** — no más `orElseSucceed(undefined)` que borra la causa.
3. Cada corrección de desarrollo lleva un estado de panel de tres valores: corrió con PDF / corrió sin PDF / no corrió (con motivo).
4. Los textos del profe bueno y del profe malo se persisten en la corrección y se pueden leer por separado.
5. Un modal flotante muestra el debate completo: Profe bueno, Profe malo, Juez y citas, en Markdown con KaTeX.
6. El panel responde en el idioma del enunciado y de la respuesta del alumno.

---

## Fuera de alcance

- **Derivar `source` en el servidor.** Se descartó por decisión del usuario: se arregla por prompt y ejemplos, no inventando el material desde los `sourcePage`. Si tras este PR el modelo sigue omitiéndolo, la derivación en `normalizeCreateArtifactInput` es el siguiente paso, no este.
- **`materialId` por pregunta.** Cambiaría `packages/shared/src/schemas/artifact.ts` en los tres tipos de pregunta y dejaría los 5 artefactos en disco a medio camino.
- **Streamear al Juez.** Sigue con `generateObject`; durante `deliberating` sigue el spinner. Sin `generateObject` no hay `FinalFeedbackSchema` validado, y medio JSON en pantalla no es razonamiento.
- **i18n de la interfaz.** Los rótulos (`labels.ts`, `STAGE_LABEL`, `AGENT_LABEL`, botones) siguen en inglés. El idioma que se arregla es el del **contenido generado por el LLM**, que es lo que chirría. Montar i18n es un PR propio.
- **Feedback determinista en español.** `artifact.ts:211-213` (`"Answer matches the expected answer."` / `` `Expected: ${...}` ``) lo escribe TypeScript, no el LLM, y solo se ve cuando el panel no corre. Traducirlo exige el mismo i18n del punto anterior.
- **Pasar preguntas cerradas por el panel.** Decisión firme del PR-14: multiple-choice y true-false son 100% deterministas.
- **Tests de render del modal.** `packages/web` corre vitest con `environment: "node"`, sin jsdom ni testing-library (`GUIA-DOER.md` §5). La lógica testeable se extrae a funciones puras (paso 6.2) y el resto se custodia con QA manual. Montar jsdom es trabajo pendiente sin plan.

---

## Contratos afectados

### `packages/shared/src/schemas/evaluation.ts` — el panel deja de tirar los profes

```ts
import { Effect, Schema } from "effect";
import { PdfCitation } from "./citation.ts";

/** Lo que devuelve el LLM Juez. NO SE TOCA. */
export const FinalFeedbackSchema = Schema.Struct({
  is_correct: Schema.Boolean,
  feedback: Schema.String,
  citas_pdf: Schema.Array(Schema.String)
});

/**
 * Resultado de un profe. Mismo par de casos que ya usa la traza
 * (`trace.ts:17-21`), pero ahora vive en shared para que traza y API
 * no puedan divergir.
 */
export const PanelAgentOutcome = Schema.Union(
  Schema.Struct({ status: Schema.Literal("ok"), text: Schema.String }),
  Schema.Struct({ status: Schema.Literal("failed"), reason: Schema.String })
);
export type PanelAgentOutcome = typeof PanelAgentOutcome.Type;

export const EnrichedFeedbackSchema = Schema.Struct({
  is_correct: Schema.Boolean,
  feedback: Schema.String,
  citas_pdf: Schema.Array(PdfCitation),
  grounded: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  // Nuevos y OPCIONALES: los 6 intentos ya en disco no los llevan y deben
  // seguir decodificando. Sin default: "no lo sé" y "falló" son cosas distintas.
  goodTeacher: Schema.optional(PanelAgentOutcome),
  badTeacher: Schema.optional(PanelAgentOutcome)
});
```

### `packages/shared/src/schemas/artifact.ts` — el indicador de tres estados

```ts
/**
 * Por qué NO se pudo anclar al PDF. Se propaga desde resolveEvidence,
 * que hoy borra la causa con orElseSucceed(() => undefined).
 */
export const UngroundedReason = Schema.Literal(
  "no-source",       // artifact.source === undefined  <- el caso real de hoy
  "no-pages",        // hay source pero sin páginas que inyectar
  "extract-failed",  // extractText falló (PDF borrado, página fuera de rango, sin poppler)
  "empty-pages"      // se extrajo texto y salió vacío
);

/** Estado del razonamiento avanzado, tal y como lo verá el alumno. */
export const PanelStatus = Schema.Union(
  Schema.Struct({
    ran: Schema.Literal(true),
    grounded: Schema.Literal(true)
  }),
  Schema.Struct({
    ran: Schema.Literal(true),
    grounded: Schema.Literal(false),
    why: UngroundedReason
  }),
  Schema.Struct({
    ran: Schema.Literal(false),
    // "judge-unavailable" cubre timeout, cuota agotada y JSON inválido.
    why: Schema.Literal("judge-unavailable")
  })
);
export type PanelStatus = typeof PanelStatus.Type;

export const ShortAnswerCorrection = Schema.Struct({
  questionType: Schema.Literal("short-answer"),
  questionId: Schema.String,
  score: Schema.Number,
  maxScore: Schema.Number,
  feedback: Schema.String,
  review: Schema.optional(EnrichedFeedbackSchema),
  // Opcional por retrocompatibilidad: ausente = intento anterior a este PR,
  // y la UI no pinta indicador en vez de mentir.
  panel: Schema.optional(PanelStatus)
});
```

**Nota sobre `exactOptionalPropertyTypes`** (`GUIA-DOER.md` §5): está activo. No vale `{ panel: undefined }`; hay que construir el objeto con spread condicional (`...(panel !== undefined ? { panel } : {})`).

### `packages/shared/src/api/artifacts.ts` — sin cambios

El protocolo NDJSON **no se toca**. `AttemptStreamEvent`, `PanelAgent` y los frames `status`/`reasoning`/`done`/`error` quedan igual: los textos de los profes viajan dentro del `ArtifactAttempt` del frame `done`, que ya es el payload tipado completo. Esto importa porque, según `GUIA-DOER.md` §5, cualquier cambio del protocolo obliga a mover server y web en el mismo PR y el lector es tolerante (el fallo sería silencioso). Aquí no hay riesgo.

---

## Pasos

Ejecuta `pnpm run typecheck` al terminar **cada** paso.

### Paso 0 — Premisas

1. [ ] `git switch -c feat/panel-transparente` **desde `fix/gemini-reintentos`** (`8eb3231`). Comprueba con `git log --oneline -1` que ves ese commit antes de ramificar.

2. [ ] Anota el recuento de tests de partida: `pnpm -r test` y apunta la cifra real. Como referencia fechada, el PR-15 esperaba del orden de 195. **La cifra de partida no puede bajar al terminar.**

3. [ ] Comprueba que el código sigue como dice este plan:

   ```bash
   grep -n "Answer in English" packages/server/src/domain/evaluation/prompts.ts
   # esperado: 6 aciertos (33, 44, 57, 68, 82, 92)

   grep -n "artifact.source === undefined" packages/server/src/domain/evaluation/review.ts
   # esperado: 1 acierto hacia :66

   grep -n "orElseSucceed" packages/server/src/domain/evaluation/review.ts
   # esperado: 1 acierto hacia :79-82

   grep -c "source" packages/server/src/domain/agents/academic-tutor/artifact-commands.ts
   # los ejemplos de withExamples (:154-172) NO deben contener "source"
   ```

   **Si alguno no es así, para y notifica.**

4. [ ] Confirma el síntoma con datos reales antes de tocar nada:

   ```bash
   grep -L '"source"' packages/server/.data/artifacts/artifacts/*.json
   # esperado: 3 ficheros, entre ellos fb7f40ae-1c2e-4551-856a-fc037ee99c47.json
   ```

### Paso 1 — El idioma deja de estar clavado a inglés

Fichero: `packages/server/src/domain/evaluation/prompts.ts`.

1. [ ] Añade una regla compartida justo al lado de `mathRule` (`:21`), con el mismo patrón:

   ```ts
   const languageRule =
     "- Write in the same language as the question and the student's answer. " +
     "If they are in different languages, use the language of the question. " +
     "Never translate the student's own words when you quote them.";
   ```

   La última frase no es decorativa: el profe malo cita al alumno para rebatirlo, y traducirlo al citarlo convierte una crítica en un hombre de paja.

2. [ ] Sustituye las **seis** apariciones de `- Answer in English.` / `- Answer in English, in a brief paragraph.` por `languageRule`, conservando el resto de cada bullet. Los seis sitios son las dos variantes (`grounded` y no-evidence) de cada uno de los tres roles: `goodTeacherSystemPrompt` (`:33`, `:44`), `badTeacherSystemPrompt` (`:57`, `:68`), `judgeSystemPrompt` (`:82`, `:92`).

   Donde el bullet original añadía *"in a brief paragraph"*, mantén esa restricción en un bullet aparte — es de longitud, no de idioma, y perderla alargaría las críticas.

3. [ ] Comprobación:

   ```bash
   grep -n "Answer in English" packages/server/src/domain/evaluation/prompts.ts   # 0 aciertos
   grep -c "languageRule" packages/server/src/domain/evaluation/prompts.ts        # 7 (1 definición + 6 usos)
   ```

### Paso 2 — `resolveEvidence` deja de borrar la causa

Fichero: `packages/server/src/domain/evaluation/review.ts`.

Hoy las cuatro razones por las que no hay evidencia colapsan en el mismo `undefined`, y `orElseSucceed` (`:79-82`) se traga además cualquier error de `extractText` sin log. Un `sourcePage: 8` inventado sobre un PDF de 6 páginas produce exactamente el mismo resultado observable que un artefacto sin `source`.

1. [ ] Cambia la firma interna de `ungrounded()` para que lleve el motivo, usando el literal `UngroundedReason` del contrato:

   ```ts
   const ungrounded = (why: UngroundedReason) => ({ mode: "ungrounded" as const, why });
   ```

2. [ ] Rellena los cuatro puntos de salida con su motivo real:
   - `:66-67` (`artifact.source === undefined`) → `"no-source"`
   - la rama de `pages.length === 0` → `"no-pages"`
   - la rama donde `extractText` no produjo nada → `"extract-failed"`
   - la rama de páginas extraídas vacías → `"empty-pages"`

3. [ ] En `:79-82`, sustituye `Effect.orElseSucceed(() => undefined)` por una captura que **conserve el error para el log** antes de degradar. No cambies el comportamiento — sigue degradando a ungrounded, nunca aborta la corrección — pero que el fallo deje rastro:

   ```ts
   Effect.catchAll((error) =>
     Effect.logWarning("evidence extraction failed", { artifactId: artifact.id, error })
       .pipe(Effect.as(undefined))
   )
   ```

   Si la API de logging del repo no es esa, usa la que ya se esté usando en `packages/server/src/domain/`. **Si no hay ninguna, para y notifica** antes de introducir una nueva.

4. [ ] Propaga `why` hasta la traza: `trace.ts` / `trace-format.ts:64-66` pintan hoy `- **Evidence: none (conceptual grading)**`. Que pase a `- **Evidence: none (conceptual grading) — why: no-source**`. Sin el motivo en la traza, depurar esto vuelve a ser adivinar.

### Paso 3 — El motor conserva a los dos profes

Fichero: `packages/server/src/domain/evaluation/engine.ts`.

1. [ ] Importa `PanelAgentOutcome` de `@proxus/shared` y **reemplaza** el tipo ad-hoc de `trace.ts:17-21` por él, para que traza y API no puedan divergir. Es un cambio de tipo, no de forma: los casos `{ok:true,text}` / `{ok:false,reason}` pasan a `{status:"ok",text}` / `{status:"failed",reason}`. Ajusta `trace-format.ts:30-33` en consecuencia.

2. [ ] En `:96-136`, donde hoy se hace

   ```ts
   const good = goodResult._tag === "Success" ? goodResult.success.text : null;
   const bad  = badResult._tag  === "Success" ? badResult.success.text  : null;
   ```

   construye además los dos `PanelAgentOutcome`. El motivo del fallo tiene que ser legible por una persona: el `Cause` de Effect en crudo no vale. Extrae un helper local:

   ```ts
   const toOutcome = (result: /* el Result de Effect.all */): PanelAgentOutcome =>
     result._tag === "Success"
       ? { status: "ok", text: result.success.text }
       : { status: "failed", reason: describeFailure(result) };
   ```

   `describeFailure` debe distinguir al menos timeout (`TEACHER_TIMEOUT_MS`, `:28-30`), stream vacío (`:79-81`, `"Teacher stream produced no text"`) y error del proveedor. Las trazas reales están llenas de `quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier`: si ese texto viene en el error, que llegue al alumno tal cual — es la diferencia entre "el profe malo no opinó" y "has agotado la cuota diaria".

3. [ ] En `:171-177`, añade los dos campos al objeto devuelto, con spread condicional por `exactOptionalPropertyTypes`. **No toques** `is_correct`, `feedback`, `citas_pdf` ni `grounded`: la regla de nota depende de ellos y hay 5 tests vigilándola.

4. [ ] Comprobación: `grep -n "goodTeacher" packages/server/src/domain/evaluation/engine.ts` debe dar al menos dos aciertos (traza y resultado).

### Paso 4 — La corrección lleva el indicador de tres estados

Ficheros: `packages/shared/src/schemas/evaluation.ts`, `packages/shared/src/schemas/artifact.ts`, `packages/server/src/domain/evaluation/review.ts`.

1. [ ] Escribe en `evaluation.ts` y `artifact.ts` exactamente los schemas de la sección *Contratos afectados*. Recuerda: `Schema` se importa del barrel raíz de `effect`, no de un subpath (`GUIA-DOER.md` §5).

2. [ ] En `review.ts`, donde se construye la `ShortAnswerCorrection` final, sella el `panel`:
   - Juez OK y `mode === "grounded"` → `{ ran: true, grounded: true }`
   - Juez OK y `mode === "ungrounded"` → `{ ran: true, grounded: false, why }` (el `why` del paso 2)
   - Juez caído (`review.ts:147-149`, hoy devuelve `correction` sin `review`) → `{ ran: false, why: "judge-unavailable" }`

3. [ ] La puerta de `:107-110` (pregunta que no es `short-answer`) sigue devolviendo la corrección intacta y **sin** `panel`: multiple-choice y true-false no tienen indicador porque nunca tuvieron panel, y añadirles uno que diga "no corrió" solo genera ruido.

4. [ ] **No toques `panelRaisesScore`** (`:54-59`). La nota se calcula igual que hoy; este paso solo informa.

5. [ ] Comprobación: `grep -n "ran: false" packages/server/src/domain/evaluation/review.ts` — un único acierto, en la rama del Juez caído.

### Paso 5 — El tutor deja de olvidarse de `source`

Ficheros: `packages/server/src/domain/agents/academic-tutor/artifact-commands.ts` y `.../skills/create-study-artifacts.ts`.

Nada de código: es un problema de ejemplos. El modelo copia lo que ve.

1. [ ] `artifact-commands.ts:154-172` — añade `source: { materialId, pages }` a **los cuatro** ejemplos de `withExamples`, con valores coherentes con los `sourcePage` de cada ejemplo (si un ejemplo tiene preguntas con `sourcePage: 3` y `sourcePage: 5`, su `pages` debe ser `[3, 5]`).

2. [ ] `artifact-commands.ts` — en la descripción de los flags, sustituye la mención suelta de que *"sourcePage is optional on any question"* por una que ligue los dos campos:

   > `source` anchors the whole artifact to one material; `sourcePage` narrows a single question within it. Without `source`, `sourcePage` is useless and the evaluation panel cannot cite the PDF.

3. [ ] `artifact-commands.ts:52` — el hint de error al fallar la validación debe nombrar `source` igual que ya nombra `explanation`.

4. [ ] `create-study-artifacts.ts` — tres cambios:
   - `:25-27` — saca `source` de la lista `Optional:`. Queda como requerido siempre que el artefacto salga de un material subido.
   - `:39-42` — añade `source` a los cuatro ejemplos (hoy solo lo lleva uno).
   - `:59-65` — la instrucción existente se queda, pero añade la consecuencia, que es lo que cambia el comportamiento de un LLM: *"If you omit `source`, the grading panel cannot read the PDF and will grade the student from memory."*

5. [ ] Comprobación:

   ```bash
   grep -c '"source"' packages/server/src/domain/agents/academic-tutor/artifact-commands.ts
   # >= 4: uno por ejemplo
   ```

6. [ ] **No se derivan valores en el servidor.** `normalizeCreateArtifactInput` (`artifact-commands.ts:94-103`) se queda como está. Es decisión explícita del usuario (ver *Fuera de alcance*).

### Paso 6 — El modal del debate

#### 6.1 — El componente base, que no existe

Fichero nuevo: `packages/web/src/components/ui/Modal.tsx`.

No hay ningún dialog/overlay en el proyecto: ni Radix, ni shadcn, ni headlessui, ni `createPortal`, ni `<dialog>`. `packages/web/package.json` solo trae react, react-dom, effect, `@effect/atom-react`, streamdown, remark-math, rehype-katex, katex y tailwind. **No añadas dependencias.**

1. [ ] Props: `{ open: boolean; title: string; onClose: () => void; children: ReactNode }`.

2. [ ] Render con `createPortal` a `document.body`: backdrop semitransparente + caja centrada con `role="dialog"`, `aria-modal="true"` y `aria-labelledby` apuntando al `<h2>` del título.

3. [ ] Cierre: botón explícito, clic en el backdrop (no en la caja) y tecla Escape.

4. [ ] **Trampa que hay que resolver aquí.** `ArtifactDetail` ya escucha Escape a nivel de documento para cerrarse (`ArtifactWorkspace.tsx:74-85`, con la exclusión de INPUT/TEXTAREA/contentEditable). Si el modal no detiene el evento, un solo Escape cierra el modal **y** el workspace entero. El handler del modal debe llamar a `event.stopPropagation()` y registrarse en fase de captura, o el workspace debe ignorar Escape mientras haya un modal abierto. Elige una y déjala comentada en el código: el próximo que añada un overlay tropezará igual.

5. [ ] Restaura el foco al elemento que abrió el modal al cerrarlo (guarda `document.activeElement` al abrir).

6. [ ] **Colores**: solo tokens del design system (`packages/web/src/styles.input.css`). Nada de colores literales de Tailwind — hay un guard en `documentacion/design-system.md:275` que debe seguir dando 0.

#### 6.2 — Las etiquetas del indicador, como función pura

Fichero nuevo: `packages/web/src/domain/artifacts/panel-status.ts`.

Se extrae aparte **porque es lo único de este paso que se puede testear**: `packages/web` corre vitest con `environment: "node"`.

1. [ ] `describePanelStatus(panel: PanelStatus | undefined): { icon: string; label: string; detail: string } | undefined`

   - `undefined` → `undefined` (intento anterior a este PR: no se pinta nada)
   - `{ran:true, grounded:true}` → "Advanced reasoning · grounded in the PDF"
   - `{ran:true, grounded:false, why}` → "Advanced reasoning · no PDF evidence", con el `detail` derivado del `why`:
     - `no-source` → "the artifact does not record which material it came from"
     - `no-pages` → "no pages were linked to this question"
     - `extract-failed` → "the PDF text could not be read"
     - `empty-pages` → "the linked pages contain no extractable text"
   - `{ran:false, why:"judge-unavailable"}` → "Advanced reasoning unavailable · automatic mark stands"

2. [ ] El `switch` sobre `why` debe ser exhaustivo sin `default`, para que añadir un motivo al literal rompa el typecheck en vez de pasar desapercibido.

#### 6.3 — El debate

Fichero nuevo: `packages/web/src/components/evaluation/PanelDebateModal.tsx`.

1. [ ] Props: `{ correction: ShortAnswerCorrection; open: boolean; onClose: () => void }`.

2. [ ] Tres secciones con encabezado propio, **en este orden y nunca fundidas**: *Good Teacher* (lo que defiende), *Bad Teacher* (lo que objeta), *Judge* (el veredicto, que es `review.feedback`). Es el punto central del PR: hoy solo existe la tercera.

3. [ ] Cada sección de profe:
   - `status: "ok"` → `<Markdown>{text}</Markdown>` (`packages/web/src/components/Markdown.tsx`, que ya trae remark-math + rehype-katex + `normalizeMath`). Los profes escriben fórmulas; texto plano las destrozaría, que es justo la limitación que tiene hoy el transcript en vivo.
   - `status: "failed"` → aviso en tono `warn` con el `reason` literal.
   - campo ausente → "Not recorded for this attempt" (intento anterior a este PR).

4. [ ] Debajo del Juez, reutiliza `<CitationList citations={review.citas_pdf} />` (`CitationList.tsx:45`) tal cual. No dupliques esa lista.

5. [ ] Diferencia visual entre los dos profes con tokens existentes (`good-line`/`good-tint` y `warn`, ya usados por `CitationList.tsx:52-57`). Que se distingan de un vistazo sin depender solo del rótulo.

#### 6.4 — El enganche en la corrección

Fichero: `packages/web/src/components/evaluation/CitationList.tsx`, componente `ShortAnswerDetails` (`:4-41`).

1. [ ] Encima del feedback, una línea con el indicador de `describePanelStatus(correction.panel)`. Si devuelve `undefined`, no se pinta nada.

2. [ ] Botón "See the panel debate", que abre `PanelDebateModal`. Se muestra **solo** si hay al menos un profe con texto — un modal con tres "Not recorded" es peor que ningún botón.

3. [ ] El estado `open` vive en `ShortAnswerDetails` con `useState`. Nada de atoms: es efímero y local.

4. [ ] La rama `review === undefined` (`:5-7`) sigue pintando `correction.feedback` en texto plano, pero ahora **acompañada del indicador** — es precisamente el caso "el panel no corrió" que el alumno no podía distinguir.

5. [ ] Para pasar `correction.panel`, `ShortAnswerDetails` ya recibe la `correction` entera: no hay que cambiar la firma ni tocar `ArtifactWorkspace.tsx:620-622`.

### Paso 7 — Tests

**Ninguno de los tests existentes de `panelRaisesScore` ni de `reviewGradedAttempt` debe moverse.** Son 5 casos que custodian la regla de nota y este PR no la toca. **Si se ponen rojos, para y notifica**: significa que algo del paso 3 o 4 tocó lo que no debía.

1. [ ] `packages/server/src/domain/evaluation/__tests__/prompts.test.ts` (créalo si no existe): los seis system prompts contienen `languageRule` y **ninguno** contiene la cadena `"in English"`. Es un test de una línea que impide que la regla se revierta sin querer.

2. [ ] `packages/server/src/domain/evaluation/__tests__/` — el motor: con ambos profes OK, el resultado trae `goodTeacher.status === "ok"` y `badTeacher.status === "ok"` con sus textos; con el profe malo caído, trae `badTeacher.status === "failed"` **y el Juez sigue emitiendo veredicto** (la degradación elegante de `engine.ts:113` no debe romperse). Usa el fichero de tests del motor ya existente y su estilo de doble de `LanguageModel`.

3. [ ] `review.test.ts` — los tres estados de `panel`, como casos nuevos añadidos al final del fichero: grounded, ungrounded con `why: "no-source"`, y Juez caído con `ran: false`.

4. [ ] `packages/web/src/domain/artifacts/__tests__/panel-status.test.ts` — un caso por variante de `describePanelStatus`, incluido `undefined`. Al estilo de `packages/web/src/lib/__tests__/math.test.ts`.

5. [ ] Retrocompatibilidad, y este es el test que evita un incidente: decodifica con `Schema` un `ShortAnswerCorrection` **sin** `panel` y **sin** `goodTeacher`/`badTeacher` y comprueba que no lanza y que `grounded` sigue cayendo a `true` por su `withDecodingDefaultKey`. Hay 6 intentos reales en `.data/` con esa forma.

6. [ ] Recuento final: la cifra del paso 0 más los ~10 casos nuevos.

### Paso 8 — Documentación

1. [ ] `documentacion/funcionamiento-actual.md` — §5 (`EvaluationProgress`) y §7 (`ShortAnswerDetails`): el indicador de tres estados, el modal del debate y que los profes ahora se persisten. Añade que el streaming en vivo y el modal muestran **lo mismo**, uno durante y otro después.
2. [ ] `docs/testing.md` — la QA manual del panel, con los tres estados y cómo forzar cada uno (ver *QA manual*).
3. [ ] `docs/ai-agent.md` — que `source` ha dejado de ser opcional de facto en la skill y por qué.
4. [ ] `planes/GUIA-DOER.md` §3 — fila nueva `pr-16-panel-transparente` / `feat/panel-transparente` con su línea, y actualiza la cifra de tests de referencia con la medida real.
5. [ ] `README.md` §0 — añade PR-16 a la lista de planes en orden de ejecución.

---

## Criterio de aceptación

1. [ ] `grep -rn "Answer in English" packages/server/` da 0 aciertos.
2. [ ] Un test con enunciados en español produce feedback del panel en español; uno en inglés, en inglés. Comprobado en vivo, no por lectura del prompt.
3. [ ] Un artefacto nuevo creado por el tutor a partir de un PDF trae `source` en su JSON de `.data/artifacts/artifacts/`.
4. [ ] Ese mismo artefacto, al corregirse, muestra "Advanced reasoning · grounded in the PDF" y al menos una cita verificada, y su traza dice `- **Evidence: PDF page text**`.
5. [ ] Un artefacto sin `source` muestra "no PDF evidence" **con el motivo** `no-source`, y la traza lo registra.
6. [ ] Con la cuota de Gemini agotada, la corrección muestra "Advanced reasoning unavailable · automatic mark stands" en vez de aparentar normalidad.
7. [ ] El modal muestra Profe bueno, Profe malo y Juez en tres secciones visualmente distintas, nunca fundidos en un párrafo.
8. [ ] Las fórmulas LaTeX de los profes se renderizan en el modal (el transcript en vivo sigue en texto plano; eso es conocido y queda así).
9. [ ] Si un profe falló, su sección lo dice con el motivo, y el resto del modal sigue siendo legible.
10. [ ] Escape con el modal abierto cierra **solo** el modal; el `ArtifactWorkspace` sigue abierto. Un segundo Escape ya lo cierra.
11. [ ] Al cerrar el modal el foco vuelve al botón que lo abrió.
12. [ ] Un intento corregido **antes** de este PR sigue abriéndose sin errores: sin indicador, sin botón de debate, con su feedback de siempre.
13. [ ] El guard de color de `documentacion/design-system.md:275` sigue dando 0.
14. [ ] `pnpm run typecheck` verde, `pnpm -r test` verde y sin bajar del recuento del paso 0, `pnpm --filter @proxus/web run build` verde.
15. [ ] Ningún `plan.md` modificado y `git status` sin `.data/`.

---

## Checks

Sin API key ni red:

```bash
pnpm run typecheck
pnpm -r test
pnpm --filter @proxus/web run build

grep -rn "Answer in English" packages/server/                                  # 0
grep -c "languageRule" packages/server/src/domain/evaluation/prompts.ts        # 7
grep -n "ran: false" packages/server/src/domain/evaluation/review.ts           # 1
grep -c '"source"' packages/server/src/domain/agents/academic-tutor/artifact-commands.ts  # >= 4
grep -rn "orElseSucceed" packages/server/src/domain/evaluation/review.ts       # 0
```

Con API key (si no la hay, **dilo explícitamente en el cuerpo del PR**):

```bash
pnpm --filter @proxus/server run panel:check
# Debe imprimir el veredicto y, ahora, los dos profes por separado desde el
# resultado del motor. OJO: panel.check.ts:70-85 hoy DUPLICA las llamadas a los
# profes solo para poder imprimirlas (5 llamadas al LLM por ejecución) porque
# el motor no las exponía. Tras el paso 3 ya las expone: elimina esa duplicación
# y lee good/bad del resultado de engine.evaluate. Baja de 5 a 3 llamadas.
```

---

## QA manual

1. Sube un PDF y pide al tutor un `test` con al menos dos preguntas de desarrollo, **en español**.
2. Abre el JSON del artefacto en `packages/server/.data/artifacts/artifacts/` → debe traer `source`.
3. Responde bien una y mal la otra, y corrige.
   → El transcript en vivo de los dos profes debe salir **en español**.
   → Cada corrección de desarrollo muestra el indicador verde "grounded in the PDF".
4. Pulsa "See the panel debate" → el modal muestra las tres secciones separadas, con las citas al final.
5. Escape → cierra el modal, **no** el workspace. Escape otra vez → cierra el workspace.
6. Repite el paso 1 en inglés → todo el feedback en inglés.
7. Fuerza el caso ungrounded: edita a mano el JSON de un artefacto y borra su clave `source`. Corrige otra vez.
   → Indicador "no PDF evidence" con motivo `no-source`. **Restaura el fichero después.**
8. Fuerza el Juez caído: invalida temporalmente la API key.
   → "Advanced reasoning unavailable · automatic mark stands", y la nota es la determinista. **Restaura la key antes de commitear.**
9. Abre un intento viejo de `.data/artifacts/attempts/` (los 6 anteriores a este PR) → se pinta sin indicador y sin botón, y sin errores en consola.

---

## Riesgos y decisiones

- **Arreglar el grounding solo con prompts es una apuesta, y es la que pidió el usuario.** Un LLM puede seguir omitiendo `source` aunque esté en los cuatro ejemplos. La mitigación no es código: es que ahora el fallo *se ve* — el indicador dice "no PDF evidence · no-source" en vez de callar. Si tras unos días de uso sigue pasando, la derivación en `normalizeCreateArtifactInput` desde los `sourcePage` es el siguiente PR, con el dato real de cuántas veces falló.

- **Persistir los textos de los profes engorda los intentos en disco.** Dos párrafos extra por pregunta de desarrollo. Aceptado: `.data/` es almacenamiento local de un proyecto de estudio, y la alternativa —leer la traza desde el cliente— exigiría exponer `.data/sessions/` por HTTP, que es peor idea por partida doble (superficie y contenido).

- **El indicador puede desmoralizar.** Ver "no PDF evidence" en cada pregunta es una mala noticia repetida. Es la decisión correcta igualmente: hoy el sistema sube notas sin evidencia y no lo dice. Un panel que se calla cuando no sabe no es amable, es poco fiable.

- **Dos campos codifican el grounding: `review.grounded` y `panel.grounded`.** Redundancia deliberada. `review.grounded` ya está persistido en 6 intentos y lo consume `CitationList.tsx:11`; migrarlo obligaría a reescribir esos ficheros. `panel` es el campo nuevo y es la fuente de verdad del indicador. Si alguna vez divergen, es un bug del paso 4, no un caso legítimo — por eso el paso 7.3 los cubre.

- **El modal se construye desde cero sin dependencias.** Un Radix daría foco y ARIA gratis, pero mete un árbol de dependencias en un proyecto que hoy tiene diez. Un modal con Escape, click-outside y restauración de foco son cuarenta líneas. El coste real es que no hay tests de render (`environment: "node"`), y por eso la lógica se extrae a `panel-status.ts`.

- **El transcript en vivo sigue en texto plano mientras el modal renderiza Markdown.** Incoherencia asumida: durante el streaming el Markdown llega a medias y renderizarlo produce parpadeo de fórmulas rotas. En vivo prima la fidelidad byte a byte (criterio 15 del PR-14); al terminar, la legibilidad.

---

## Historial

_(Vacío. Lo rellena el thinker si el doer reporta que algo de este plan no cuadra con el código.)_
