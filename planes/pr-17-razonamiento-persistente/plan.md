# PR-17 — El razonamiento de los profes deja de evaporarse: se acumula, se persiste y se puede releer

**Rama**: `feat/razonamiento-persistente`
**Depende de**: sale de `feat/panel-transparente` (`2ccfa3c`), **no de `main`**. Toca `engine.ts`, `PanelAgentOutcome`, `PanelDebateModal.tsx`, `CitationList.tsx` y `EvaluationProgress.tsx` — los cinco los escribió o reescribió el PR-16 hace horas. Desde `main` es conflicto seguro.
**Estado**: borrador
**Contiene LLM**: no — no se toca ni un prompt. Solo se captura y se transporta lo que el modelo ya emite.
**Fichero delicado**: `packages/server/src/domain/evaluation/engine.ts`. Se toca `runTeacher` y `teacherOutcome`. **No se toca** el Juez (`generateObject`, L142-154), ni el paralelismo `mode: "result"` (L112-118), ni el timeout de 30 s (L30).
**Origen**: petición del usuario del 16-sep-2026: *"un botón que nos permita ver el razonamiento de los profesores aunque este termine de razonar, pero que podamos ver el historial de razonamiento del profe bueno y malo; ahora mismo esto desaparece cuando termina su razonamiento"*.

> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica con el formato de `planes/GUIA-DOER.md` §4.

---

## Contexto

El PR-14 (paso 13) hizo que el razonamiento de los dos profes se viera en vivo. El PR-16 rescató su **veredicto** del olvido (`PanelAgentOutcome`) y lo pintó en un modal. Lo que sigue sin sobrevivir es el **pensamiento** — el canal `thought`, la parte que de verdad explica cómo cada profe llegó a su conclusión. Y desaparece por cuatro sitios distintos, todos verificados contra el código:

**1. El motor nunca lo acumula.** `runTeacher` (`engine.ts:51-83`) tiene un acumulador `let text = ""` y lo alimenta en la rama `text-delta` (`:67-71`). La rama `reasoning-delta` (`:72-75`) **reenvía el delta al `emit` y no lo guarda en ninguna variable**. Cuando `teacherOutcome` (`:95-98`) construye el `PanelAgentOutcome`, el pensamiento ya no existe ni en memoria del servidor. Es la causa raíz: todo lo demás son consecuencias.

Y sí hay pensamiento que capturar: `gemini.ts:266-268` pide `thinkingConfig: { includeThoughts: true }` siempre que la llamada **no** sea en modo JSON, y `gemini.ts:579-590` lo clasifica en `reasoning-start` / `reasoning-delta` / `reasoning-end`. Por eso los profes razonan en vivo y el Juez no: el Juez va por `generateObject` (modo JSON).

**2. En vivo, el panel se desmonta en cuanto llega `deliberating`.** `EvaluationProgress.tsx:108` renderiza el transcript solo si `isTeacher && active`, y `active = run.activeStages.includes(stage)`. En `ArtifactWorkspace.tsx:221-226`, cuando el status `deliberating` llega (lo emite `engine.ts:126`, justo tras terminar ambos profes), `activeStages` pasa a ser `["deliberating"]` — **reemplaza, no añade**. Los dos `TranscriptPanel` se desmontan de golpe. El texto sigue en `run.transcript`; simplemente deja de pintarse. Esto es exactamente el "desaparece cuando termina de razonar" del usuario.

**3. Al cambiar de pregunta se borra.** `ArtifactWorkspace.tsx:232`: `transcript: isNewQuestion ? emptyTranscript : current.transcript`. `PanelTranscript` (`evaluation-atoms.ts:4-7`) es plano por agente, **sin dimensión de pregunta**, así que la única manera de empezar la pregunta siguiente es tirar la anterior. En un test de cinco preguntas de desarrollo solo sobrevive la última, y solo mientras dura.

**4. Al terminar todo se tira el estado entero.** La variante `done` (`evaluation-atoms.ts:24`) es `{ phase: "done"; attempt }` — no tiene campo `transcript`. Y `ArtifactWorkspace.tsx:340` monta `EvaluationProgress` solo si `run.phase === "running"`.

El botón que pide el usuario **ya existe a medias**: "See the panel debate" (`CitationList.tsx:63-79`) abre `PanelDebateModal`, que pinta el `text` final de cada profe (`PanelDebateModal.tsx:33-36`). Pero (a) no muestra el pensamiento, porque nadie lo guardó, y (b) está condicionado a `hasTeacherText` (`CitationList.tsx:22-24`), así que si los dos profes fallaron no hay forma de abrir el modal y leer por qué.

**Resultado buscado**: que el pensamiento de cada profe se acumule en el servidor, viaje en el intento persistido y se pueda releer días después desde el mismo modal; y que en vivo el transcript deje de desvanecerse al terminar una etapa o al pasar de pregunta.

---

## Objetivo

1. `runTeacher` acumula el canal `thought` igual que ya acumula el `text`.
2. El pensamiento se guarda en el `PanelAgentOutcome` — también cuando el profe **falla**, que es el caso donde más falta hace.
3. Un intento corregido hoy se puede reabrir mañana y enseñar el razonamiento completo de los dos profes.
4. El modal "See the panel debate" muestra, por profe, un bloque plegable *Reasoning* encima de su veredicto.
5. El botón que abre el modal aparece **siempre que el panel corrió**, no solo cuando algún profe produjo texto.
6. En vivo, el transcript de un profe sigue visible cuando termina, y el de las preguntas anteriores sigue consultable hasta que acaba la corrección.
7. La traza de disco (`.data/sessions/<attemptId>.md`) registra el pensamiento junto al veredicto.

---

## Fuera de alcance

- **Streamear el razonamiento del Juez.** No existe: `gemini.ts:266-268` desactiva `includeThoughts` en modo JSON, y el Juez necesita `generateObject` para que `FinalFeedbackSchema` se valide. Decisión ya tomada en el PR-16 y no se reabre.
- **Tocar el protocolo NDJSON.** `AttemptStreamEvent` (`shared/src/api/artifacts.ts:26-46`) ya transporta `channel: "thought"` desde el PR-14. El pensamiento persistido viaja dentro del `ArtifactAttempt` del frame `done`, como hizo el PR-16 con el `text`. **Si algún paso te pide cambiar `AttemptStreamEvent`, para y notifica**: significa que el plan está mal.
- **Guardar el transcript en vivo tras el `done`.** Sería una segunda fuente de verdad para el mismo dato que ya trae el intento persistido, y divergiría en cuanto una de las dos se toque. Tras `done`, manda el modal.
- **Renderizar el pensamiento como Markdown.** El *thinking* es prosa a medio hacer, con listas rotas y `$` sueltos. Va en texto plano con `white-space: pre-wrap`, igual que el transcript en vivo. El veredicto (`text`) sigue en Markdown con KaTeX.
- **Tests de render de componentes.** `packages/web` corre vitest con `environment: "node"` e `include: ["src/**/*.test.ts"]` — sin jsdom, sin `.tsx`. La lógica se extrae a una función pura en `domain/` y se testea esa (patrón establecido por `panel-status.ts` en el PR-16).
- **Purgar o truncar pensamientos largos en disco.** Ver *Riesgos*.

---

## Contratos afectados

### `packages/shared/src/schemas/evaluation.ts` — el pensamiento entra en el contrato

Hoy (`:16-20`):

```ts
export const PanelAgentOutcome = Schema.Union([
  Schema.Struct({ status: Schema.Literal("ok"), text: Schema.String }),
  Schema.Struct({ status: Schema.Literal("failed"), reason: Schema.String })
]);
```

Queda:

```ts
export const PanelAgentOutcome = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("ok"),
    text: Schema.String,
    // Opcional y sin default: los intentos del PR-16 no lo llevan, y un modelo
    // sin thinking tampoco. Ausente ≠ cadena vacía.
    thought: Schema.optional(Schema.String)
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    reason: Schema.String,
    // Un profe que se cae a los 30 s casi siempre dejó pensamiento a medias.
    // Es el caso en el que leerlo más ayuda.
    thought: Schema.optional(Schema.String)
  })
]);
```

`EnrichedFeedbackSchema` (`:23-32`) **no cambia**: `goodTeacher`/`badTeacher` ya son `PanelAgentOutcome`.
`ShortAnswerCorrection` y `PanelStatus` (`shared/src/schemas/artifact.ts:17-33`, `:223-233`) **no cambian**.
`shared/src/api/artifacts.ts` **no cambia**.

### `packages/web/src/domain/artifacts/evaluation-atoms.ts` — el transcript gana dimensión de pregunta

```ts
/** Transcript en vivo indexado por questionId. Nunca se vacía durante un run:
 * cambiar de pregunta añade una clave, no borra las anteriores. */
export type PanelTranscripts = Readonly<Record<string, PanelTranscript>>;

export const emptyTranscripts: PanelTranscripts = {};
```

La variante `running` cambia `transcript: PanelTranscript` por `transcripts: PanelTranscripts`. Las variantes `idle`, `done` y `error` **no cambian**: tras `done` el razonamiento se lee del intento persistido, no del atom.

`emptyTranscript` (`:9-12`) se conserva: es el valor inicial de una pregunta nueva.

---

## Pasos

Ejecuta `pnpm run typecheck` al terminar **cada** paso.

### Paso 0 — Premisas

1. [ ] `git switch feat/panel-transparente && git log -1 --format=%h` → `2ccfa3c`. Si no, para y notifica.
2. [ ] `git switch -c feat/razonamiento-persistente`.
3. [ ] `pnpm -r test` → **25 ficheros, 222 tests, todos en verde** (server 19/182, web 6/40). Apunta la cifra: el paso 6 la usa. Si no coincide, para y notifica.
4. [ ] Verificaciones de que el código es el que este plan describe:
   ```bash
   grep -n "reasoning-delta" packages/server/src/domain/evaluation/engine.ts   # 1 acierto (:72)
   grep -n "isTeacher && active" packages/web/src/components/evaluation/EvaluationProgress.tsx  # 1 (:108)
   grep -n "isNewQuestion ? emptyTranscript" packages/web/src/components/ArtifactWorkspace.tsx  # 1 (:232)
   grep -n "hasTeacherText" packages/web/src/components/evaluation/CitationList.tsx  # 2 (:22, :62)
   grep -c "thought" packages/shared/src/schemas/evaluation.ts                 # 0
   ```
   Si alguno no da eso, para y notifica.
5. [ ] `ls packages/server/.data/artifacts/attempts/` — cuenta los intentos existentes. Son la muestra del criterio de retrocompatibilidad (11 de la lista de aceptación).

### Paso 1 — El contrato admite pensamiento

1. [ ] `packages/shared/src/schemas/evaluation.ts:16-20` — sustituye `PanelAgentOutcome` por la versión de *Contratos afectados*, con los dos comentarios tal cual.
2. [ ] No toques `EnrichedFeedbackSchema`. Es el mismo tipo referenciado, hereda el campo.
3. [ ] `pnpm run typecheck` — debe salir **verde ya aquí**. `thought` es opcional en ambas variantes, así que ningún constructor existente se rompe. Si sale rojo, para y notifica: alguien está construyendo un `PanelAgentOutcome` con un objeto literal cerrado y eso no está en este plan.

### Paso 2 — El motor acumula el pensamiento y lo conserva aunque el profe se caiga

**Trampa que hay que resolver aquí.** Hoy `runTeacher` (`engine.ts:51-83`) declara `let text = ""` **dentro** del `Effect.gen`. Con `Effect.all(..., { mode: "result" })` (`:112-118`), un profe que falla devuelve `{ _tag: "Failure" }` y todo lo acumulado dentro del `Effect` se pierde. Si quieres el pensamiento parcial de un profe caído —y lo quieres, es el objetivo 2— el acumulador tiene que vivir **fuera** del `Effect`, en manos del llamante.

1. [ ] Define el acumulador y cámbiale la firma a `runTeacher`:

   ```ts
   interface TeacherAccumulator {
     text: string;
     thought: string;
   }

   const runTeacher = (
     agent: PanelAgent,
     systemPrompt: string,
     userPrompt: string,
     acc: TeacherAccumulator,
     emit?: (event: EvaluationProgressEvent) => Effect.Effect<void>
   ) =>
     Effect.gen(function* () {
       yield* LanguageModel.streamText({ /* … igual que hoy … */ }).pipe(
         Stream.runForEach((part) => {
           if (part.type === "text-delta") {
             acc.text += part.delta;
             return emit?.({ _tag: "reasoning", agent, channel: "text", delta: part.delta })
               ?? Effect.void;
           }
           if (part.type === "reasoning-delta") {
             acc.thought += part.delta;
             return emit?.({ _tag: "reasoning", agent, channel: "thought", delta: part.delta })
               ?? Effect.void;
           }
           return Effect.void;
         })
       );
       if (acc.text.trim().length === 0) {
         return yield* new TeacherStreamEmpty({ message: "Teacher stream produced no text" });
       }
       return { text: acc.text };
     }).pipe(Effect.timeout(TEACHER_TIMEOUT_MS));
   ```

   El `let text = ""` local desaparece; el resto del cuerpo (prompt, `toolChoice: "none"`, `TeacherStreamEmpty`, `Effect.timeout`) se queda **idéntico**.

2. [ ] En `evaluate` (`:112-118`), crea un acumulador por profe antes del `Effect.all` y pásalo:

   ```ts
   const goodAcc: TeacherAccumulator = { text: "", thought: "" };
   const badAcc: TeacherAccumulator = { text: "", thought: "" };

   const [goodResult, badResult] = yield* Effect.all(
     [
       runTeacher("good_teacher", goodTeacherSystemPrompt(input.mode), goodTeacherPrompt(input), goodAcc, emit),
       runTeacher("bad_teacher", badTeacherSystemPrompt(input.mode), badTeacherPrompt(input), badAcc, emit)
     ],
     { concurrency: "unbounded", mode: "result" }
   );
   ```

   **No cambies `concurrency` ni `mode`.** Cada profe muta solo su propio acumulador, así que el paralelismo sigue siendo seguro.

3. [ ] `teacherOutcome` (`:95-98`) pasa a recibir el acumulador:

   ```ts
   const teacherOutcome = (result: TeacherResult, acc: TeacherAccumulator): PanelAgentOutcome => {
     // `exactOptionalPropertyTypes` está activo (GUIA-DOER §5): nunca asignes
     // `thought: undefined`. O la clave existe con contenido, o no existe.
     const thought = acc.thought.trim().length > 0 ? { thought: acc.thought } : {};
     return result._tag === "Success"
       ? { status: "ok", text: result.success.text, ...thought }
       : { status: "failed", reason: describeFailure(result), ...thought };
   };
   ```

   Llamadas (`:122-123`): `teacherOutcome(goodResult, goodAcc)` y `teacherOutcome(badResult, badAcc)`.

4. [ ] No toques nada más de `engine.ts`. `traceBase` (`:129-140`) ya mete `goodTeacher`/`badTeacher`, así que la traza hereda el pensamiento sin cambios, y el `return` (`:175-183`) también.

5. [ ] `grep -n "let text" packages/server/src/domain/evaluation/engine.ts` → 0 aciertos.

### Paso 3 — La traza de disco lo escribe

1. [ ] `packages/server/src/domain/evaluation/trace-format.ts:30-32` — `formatTeacher` añade, **debajo** del veredicto y solo si `teacher.thought` existe y no está vacío, un bloque con el pensamiento. Respeta el estilo Markdown que ya usa el fichero (mira cómo formatea el resto de secciones antes de decidir; no inventes un estilo nuevo).
2. [ ] Rótulo: `Reasoning` — el fichero está en inglés como el resto de rótulos del proyecto.
3. [ ] Si `thought` no existe, la salida debe ser **byte a byte la de hoy**. Los 21 tests de `trace-format.test.ts` lo custodian y no deben moverse. **Si alguno se pone rojo, para y notifica.**

### Paso 4 — En vivo: el transcript deja de desvanecerse

#### 4.1 — El estado se indexa por pregunta

1. [ ] `packages/web/src/domain/artifacts/evaluation-atoms.ts` — añade `PanelTranscripts` y `emptyTranscripts` según *Contratos afectados*, y cambia `transcript` por `transcripts` en la variante `running`. `emptyTranscript` se queda.

#### 4.2 — La reducción de deltas sale del componente

**Por qué**: `ArtifactWorkspace.tsx:235-249` es la lógica que hay que cambiar y hoy no tiene ni un test, porque vive dentro de un `.tsx` y vitest de web corre en `environment: "node"` sobre `*.test.ts`. Sacarla a `domain/` es lo que hizo el PR-16 con `panel-status.ts`.

1. [ ] Crea `packages/web/src/domain/artifacts/transcripts.ts` con dos funciones **puras**:

   ```ts
   /** Acumula un delta de razonamiento en la pregunta a la que pertenece.
    * Crea la entrada de la pregunta si es la primera vez que se la ve. */
   export const appendDelta = (
     transcripts: PanelTranscripts,
     event: { questionId: string; agent: PanelAgent; channel: "thought" | "text"; delta: string }
   ): PanelTranscripts => { /* … */ };

   /** El transcript de una pregunta, o `emptyTranscript` si aún no hay nada. */
   export const transcriptFor = (
     transcripts: PanelTranscripts,
     questionId: string
   ): PanelTranscript => transcripts[questionId] ?? emptyTranscript;
   ```

   `appendDelta` devuelve un objeto nuevo (nada de mutar): el atom es estado de React.

2. [ ] `ArtifactWorkspace.tsx:235-249` — la rama `reasoning` pasa a ser `transcripts: appendDelta(current.transcripts, event)`. **Conserva el guard `if (current.phase !== "running") return current;`**, pero **elimina** la condición `event.questionId !== current.questionId` (`:237`): ya no hace falta descartar deltas de otra pregunta, ahora cada uno va a su cajón. Esa condición existía precisamente porque el estado era plano.

3. [ ] `ArtifactWorkspace.tsx:232` — `transcript: isNewQuestion ? emptyTranscript : current.transcript` desaparece: la rama `status` pasa a arrastrar `transcripts: current.transcripts` sin condición. `isNewQuestion` sigue usándose para `activeStages` (`:221-226`) — **no lo borres**.

4. [ ] `ArtifactWorkspace.tsx:212` — el `setRun` inicial usa `transcripts: emptyTranscripts`.

#### 4.3 — El componente deja de desmontar el panel

1. [ ] `EvaluationProgress.tsx` — la prop pasa de `transcript: PanelTranscript` a recibir el transcript **de la pregunta en curso**, vía `transcriptFor(run.transcripts, run.questionId)`.

2. [ ] `EvaluationProgress.tsx:108` — quita `&& active`:

   ```tsx
   {isTeacher && (
     <TranscriptPanel agent={agent} transcript={currentTranscript} />
   )}
   ```

   El guard de vacío ya lo hace `TranscriptPanel` (`:33`: `if (thought.length === 0 && text.length === 0) return null;`), así que un profe que aún no ha empezado sigue sin pintar nada. **Esta línea es el arreglo del síntoma que reportó el usuario.**

3. [ ] El auto-scroll (`:28-31`) se queda, pero una vez el profe termina deja de tener sentido forzar el fondo. Añade un `useRef<boolean>` que marque si el usuario ha hecho scroll manual hacia arriba y, si lo ha hecho, no reposiciones. Cuarenta caracteres de código que evitan que el panel pelee con quien está leyendo.

4. [ ] **Historial de preguntas anteriores**: debajo de la lista de etapas, si `Object.keys(run.transcripts).length > 1`, pinta un `<details>` cerrado por defecto rotulado `Previous questions` con un `TranscriptPanel` por cada `questionId` distinto del actual, cada uno bajo un `<h4>` con `Question N` (el índice sale del orden de inserción de las claves, que es el orden en que llegaron). Cerrado por defecto: durante la corrección lo que importa es la pregunta en curso.

5. [ ] `ArtifactWorkspace.tsx:340` no cambia: `EvaluationProgress` sigue montándose solo en `running`. Tras `done` manda el modal.

### Paso 5 — El modal muestra el pensamiento

1. [ ] `packages/web/src/components/evaluation/PanelDebateModal.tsx` — dentro de `TeacherSection` (`:6-53`), **encima** del veredicto, un `<details>`:

   ```tsx
   {outcome !== undefined && outcome.thought !== undefined && (
     <details style={{ marginBottom: "0.5rem" }}>
       <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--color-ink-mute)" }}>
         Reasoning
       </summary>
       <div
         className="border border-line bg-surface-muted"
         style={{ borderRadius: 8, padding: "8px 12px", marginTop: 6,
                  whiteSpace: "pre-wrap", fontSize: 12.5, maxHeight: 260, overflowY: "auto",
                  color: "var(--color-ink-faint)", fontStyle: "italic" }}
       >
         {outcome.thought}
       </div>
     </details>
   )}
   ```

   Cerrado por defecto, texto plano, mismo tratamiento visual que el `Thinking…` en vivo (`EvaluationProgress.tsx:50-54`) para que se reconozca como la misma cosa.

2. [ ] La rama `status === "failed"` (`:37-50`) también pinta el `<details>` si hay pensamiento — colócalo antes del bloque del `reason`, no dentro. Un profe que reventó a los 30 s con medio razonamiento escrito es justo lo que hay que poder leer.

3. [ ] Colores: usa tokens existentes (`--color-ink-faint`, `--color-line`, `--color-surface-muted`). **No introduzcas literales de color**: el guard de `documentacion/design-system.md:275` debe seguir dando 0.

4. [ ] El `maxHeight: 85vh` del `Modal` (`ui/Modal.tsx:79`) y su cuerpo con scroll (`:116`) ya contienen el crecimiento. No toques `Modal.tsx`.

### Paso 6 — El botón aparece siempre que haya debate

1. [ ] `CitationList.tsx:22-24` — `hasTeacherText` se sustituye por:

   ```ts
   // El botón abre el debate, no el texto de los profes: si el panel corrió,
   // siempre hay algo que leer (veredicto del Juez, o el motivo de cada fallo).
   const hasPanelDebate = correction.review !== undefined;
   ```

   y la condición del botón (`:62`) pasa a `hasPanelDebate`. Antes, con los dos profes caídos, el modal existía y no había forma de abrirlo.

2. [ ] `CitationList.tsx:26-38` — la rama `review === undefined` monta un `PanelDebateModal` que **nada puede abrir** (`debateOpen` nunca se pone a `true` en esa rama). Es código muerto desde el PR-16: bórralo. El `PanelIndicator` y el `<p>` del feedback se quedan.

3. [ ] No cambies la firma de `ShortAnswerDetails` ni `ArtifactWorkspace.tsx:621`.

### Paso 7 — Tests

**No muevas ningún test de `panelRaisesScore` ni de `reviewGradedAttempt`** (19 casos en `review.test.ts`). Este PR no toca la regla de nota. **Si se ponen rojos, para y notifica**: algo del paso 2 tocó lo que no debía.

1. [ ] `packages/server/src/domain/evaluation/__tests__/engine.test.ts` — al estilo del doble de `LanguageModel` que ya usa el fichero, tres casos nuevos:
   - con `reasoning-delta` en el stream, `goodTeacher.thought` contiene los deltas concatenados **en orden**;
   - sin ningún `reasoning-delta`, la clave `thought` **no existe** en el outcome (`"thought" in outcome === false`, no `=== undefined`: es lo que distingue ausente de vacío);
   - un profe que falla (timeout o error a mitad de stream) tras haber emitido `reasoning-delta` produce `status: "failed"` **y conserva** el `thought` parcial. Este es el caso que justifica sacar el acumulador del `Effect`; sin él, el paso 2 se puede revertir sin que nadie se entere.

2. [ ] `packages/server/src/domain/evaluation/__tests__/schema-retrocompat.test.ts` — un caso más: un `PanelAgentOutcome` **sin** `thought` (las dos variantes) decodifica sin lanzar. Hay intentos reales en `.data/` con esa forma.

3. [ ] `packages/server/src/domain/evaluation/__tests__/trace-format.test.ts` — dos casos: con `thought`, la traza lo incluye bajo su rótulo; sin `thought`, la salida es idéntica a la actual.

4. [ ] `packages/web/src/domain/artifacts/__tests__/transcripts.test.ts` (nuevo) — al estilo de `panel-status.test.ts`:
   - `appendDelta` sobre un `{}` crea la entrada de la pregunta con el resto de campos en cadena vacía;
   - dos deltas del mismo agente y canal se concatenan en orden;
   - deltas de `good_teacher` y `bad_teacher` intercalados (es lo que pasa de verdad: corren en paralelo) no se pisan;
   - un delta de una pregunta nueva **no borra** la anterior — el test que fija el arreglo del síntoma (3);
   - `appendDelta` no muta el objeto de entrada (compara por identidad);
   - `transcriptFor` con un `questionId` desconocido devuelve `emptyTranscript`.

5. [ ] Recuento final: la cifra del paso 0 más los ~12 casos nuevos. Mídela, no la estimes.

### Paso 8 — Documentación

1. [ ] `documentacion/funcionamiento-actual.md` — §5 (`EvaluationProgress`) y §7 (`ShortAnswerDetails`): el transcript ya no se desmonta al terminar la etapa, se guarda por pregunta, y el pensamiento se persiste en el intento y se relee en el modal. Di explícitamente que el Juez **no** razona en vivo y por qué (modo JSON).
2. [ ] `docs/testing.md` — actualiza la línea 32 con el recuento medido y añade al desglose (`:54-65`) las entradas nuevas con el formato existente (`(**N tests**, PR-17)`).
3. [ ] `README.md:259` — **está desactualizado desde el PR-08**: dice `17 ficheros, 151 tests (server 14/131, web 3/20)`. Ponlo en la cifra real de este PR. Revisa también `:283-286`, que cita cifras derivadas de esa (`5 failed | 126 passed`, `151/151`) al narrar la mutación de `panelRaisesScore`: reescríbelas para que sigan siendo ciertas o redáctalas sin números absolutos.
4. [ ] `README.md` §0 — fila de `pr-17-razonamiento-persistente` en la lista de planes en orden de ejecución.
5. [ ] `planes/GUIA-DOER.md` §3 — fila nueva `pr-17-razonamiento-persistente` / `feat/razonamiento-persistente`, y la cifra de tests de referencia al valor medido.
6. [ ] Copia este plan a `planes/pr-17-razonamiento-persistente/plan.md` **como primera acción del PR**, antes del paso 1.

---

## Criterio de aceptación

1. [ ] `grep -n "acc.thought" packages/server/src/domain/evaluation/engine.ts` → ≥ 2 aciertos.
2. [ ] Corriges una pregunta de desarrollo y, cuando el Juez empieza a deliberar, **los dos paneles de razonamiento siguen en pantalla** con su texto completo.
3. [ ] Con un test de ≥ 2 preguntas de desarrollo, al pasar a la segunda aparece `Previous questions`, y dentro está íntegro el razonamiento de la primera.
4. [ ] Al terminar, "See the panel debate" abre el modal y cada profe tiene un `<details>` *Reasoning* con su pensamiento.
5. [ ] Recargas la página, reabres ese intento desde el histórico y el pensamiento **sigue ahí**.
6. [ ] El JSON del intento en `packages/server/.data/artifacts/attempts/` contiene `"thought"` dentro de `goodTeacher` y `badTeacher`.
7. [ ] La traza `.data/sessions/<attemptId>.md` incluye el razonamiento de cada profe.
8. [ ] Un profe caído por timeout muestra su motivo **y** su pensamiento parcial, y el modal sigue siendo legible.
9. [ ] Con los dos profes caídos, el botón "See the panel debate" **aparece igualmente** y el modal explica qué falló.
10. [ ] Si el modelo no devuelve thinking, no aparece ningún `<details>` vacío en ninguna sección.
11. [ ] Un intento corregido **antes** de este PR se abre sin errores en consola: modal con veredictos, sin bloque de razonamiento.
12. [ ] Escape con el modal abierto cierra solo el modal; el workspace sigue abierto (regresión del PR-16, `Modal.tsx:26-39`).
13. [ ] `AttemptStreamEvent` sin cambios: `git diff packages/shared/src/api/artifacts.ts` vacío.
14. [ ] El guard de color de `documentacion/design-system.md:275` sigue dando 0.
15. [ ] `pnpm run typecheck` verde, `pnpm -r test` verde y sin bajar de 222, `pnpm --filter @proxus/web run build` verde.
16. [ ] Ningún `plan.md` de PRs anteriores modificado y `git status` sin `.data/`.

---

## Checks

Sin API key ni red:

```bash
pnpm run typecheck
pnpm -r test
pnpm --filter @proxus/web run build

grep -c "thought" packages/shared/src/schemas/evaluation.ts                               # >= 2
grep -n "let text" packages/server/src/domain/evaluation/engine.ts                        # 0
grep -n "isTeacher && active" packages/web/src/components/evaluation/EvaluationProgress.tsx  # 0
grep -n "emptyTranscript\b" packages/web/src/components/ArtifactWorkspace.tsx             # 0
grep -n "hasTeacherText" packages/web/src/components/evaluation/CitationList.tsx          # 0
git diff --stat packages/shared/src/api/artifacts.ts                                      # vacío
```

Con API key (si no la hay, **dilo explícitamente en el cuerpo del PR**):

```bash
pnpm --filter @proxus/server run panel:check
# Debe imprimir, además del veredicto y los dos profes, el pensamiento de cada uno.
# Si sale vacío con una key válida: comprueba gemini.ts:266-268 antes de tocar
# nada más — significa que el modelo configurado no devuelve thinking, y eso es
# un dato del entorno, no un bug de este PR.
```

---

## QA manual

1. Sube un PDF y pide al tutor un `test` con **tres** preguntas de desarrollo.
2. Responde las tres y corrige. Mientras corre:
   → Los dos paneles de razonamiento aparecen y **no desaparecen** cuando el Juez empieza a deliberar.
   → Al pasar a la pregunta 2 aparece `Previous questions`; ábrelo y comprueba que la 1 está entera.
   → Haz scroll hacia arriba en un panel mientras sigue llegando texto: no debe saltarte al fondo.
3. Al terminar, abre "See the panel debate" en cada pregunta → `Reasoning` plegado por profe, y al abrirlo, el pensamiento completo.
4. Escape → cierra el modal, **no** el workspace. Escape otra vez → cierra el workspace.
5. Recarga la página (F5), reabre el mismo intento → el razonamiento sigue.
6. `cat` del JSON del intento en `.data/artifacts/attempts/` → `thought` presente.
7. Fuerza un fallo de profe: baja `TEACHER_TIMEOUT_MS` a `1_000` temporalmente y corrige.
   → `status: failed` con el motivo **y** el pensamiento parcial. **Restaura los 30 s antes de commitear.**
8. Abre un intento anterior a este PR → modal sin bloque de razonamiento, sin errores en consola.

---

## Riesgos y decisiones

- **Los intentos en disco engordan bastante más que con el PR-16.** El pensamiento de un modelo con thinking es varias veces el veredicto. Se acepta por lo mismo que se aceptó persistir el `text`: `.data/` es almacenamiento local de un proyecto de estudio, y la alternativa —leer la traza desde el cliente— exigiría exponer `.data/sessions/` por HTTP, que es peor idea por superficie y por contenido. **Si el tamaño llega a molestar, la respuesta es truncar en el servidor con un tope explícito y marcarlo en el propio texto, no dejar de guardar.** No lo hagas en este PR.

- **El acumulador mutable fuera del `Effect` es deliberado y es la parte frágil.** Es la única forma de conservar el parcial de un profe que falla con `mode: "result"`. Cada profe muta exclusivamente su propio objeto, así que el paralelismo no lo rompe. El test 7.1 (tercer caso) es lo que impide que alguien "limpie" esto devolviendo el `thought` desde dentro del `Effect` y se cargue el caso de fallo sin notarlo.

- **El pensamiento no está pensado para que lo lea un alumno.** Es prosa cruda del modelo, en primera persona, a veces contradictoria consigo misma. Por eso va plegado, en gris, en cursiva y cerrado por defecto: quien lo abre es alguien que quiere auditar al panel, no estudiar. Es exactamente el caso de uso que pidió el usuario.

- **Dos sitios enseñan lo mismo con estilos distintos**: el transcript en vivo y el `<details>` del modal. Es deliberado y ya era así en el PR-16 (`text` plano en vivo, Markdown en el modal). El pensamiento va en plano en los dos, porque como Markdown parpadea y rompe fórmulas.

- **El Juez sigue siendo una caja negra.** Es el hueco que queda tras este PR y no tiene solución barata: `generateObject` y `includeThoughts` son excluyentes en la capa Gemini. Si alguna vez importa, la vía es una segunda llamada solo para la explicación, y es un PR con su propio coste en cuota.

- **Quitar `&& active` cambia el ritmo visual de la pantalla.** Antes los paneles se iban turnando; ahora se acumulan y la lista crece. Con `maxHeight: 180` por panel el crecimiento está acotado, pero en un móvil estrecho se nota. Se acepta: que el razonamiento se vea es literalmente lo que se pide.

---

## Historial

_(Vacío. Lo rellena el thinker si el doer reporta que algo de este plan no cuadra con el código.)_
