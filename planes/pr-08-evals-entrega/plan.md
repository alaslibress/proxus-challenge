# PR-08 — Cierre de la suite de tests, evals y README de entrega

- **Rama**: `feat/evals-entrega`
- **Depende de**: nada. PR-01 a PR-07 están **implementados y mergeados en `main`**
  (`git log`: `4d078aa` merge de `feat/ui-observabilidad`). Este PR se puede empezar hoy.
- **Bloquea a**: nada. Es el último.
- **Estado**: listo para implementar
- **Contiene LLM**: **no**. Todo lo que este PR añade corre sin API key y sin red.
- **Origen**: [Tech Spec §5 (Testing LLM) y §6 Fase 4](../../documentacion/tech-spec.md), y
  `CHALLENGE.md` — *Cómo entregar*.

> Normas de trabajo en [`../plan.md`](../plan.md). Contexto técnico obligatorio en
> [`../../documentacion/contexto-repo.md`](../../documentacion/contexto-repo.md) y
> [`../../documentacion/funcionamiento-actual.md`](../../documentacion/funcionamiento-actual.md).
> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.
>
> **Este PR no es recortable.** Sin evals ni README no hay entrega: `CHALLENGE.md` evalúa
> explícitamente *"capacidad de evaluación"* y *"comunicación"*.

---

## Aviso: este plan se reescribió el 2026-09-08

La versión original se redactó **antes** de PR-02..PR-07 y daba por cierto que el repo no
tenía test runner y que había que construir a mano un `LanguageModel` falso, un
`MaterialRepository` de fixtures y dos scripts `eval:pure` / `eval:panel`. **Nada de eso
sigue siendo cierto.** Lo que quedaba por hacer se ha reducido y desplazado: ver
*Estado real verificado* y el *Historial* al final.

---

## Estado real verificado

Todo lo de esta sección está comprobado a fecha 2026-09-08 sobre `main` limpio.

### Ya existe un test runner, con suite verde

- `vitest ^5.0.0` es devDependency de server (`packages/server/package.json:26`) y de web
  (`packages/web/package.json:29`).
- Scripts `test` / `test:watch` en ambos paquetes
  (`packages/server/package.json:16-17`, `packages/web/package.json:11-12`).
- Configuración en `packages/server/vitest.config.ts` y `packages/web/vitest.config.ts`,
  ambas con `include: ["src/**/*.test.ts"]` y `environment: "node"`.
- `pnpm -r test` ejecutado en modo lectura: **11 ficheros, 91 tests, todos en verde**
  (server 9/81, web 2/10).

### Las garantías centrales YA están cubiertas por tests

La tabla mapea los nueve casos que pedía el plan original contra el test que hoy los cubre:

| # (plan viejo) | Caso | Dónde está hoy | ¿Cubierto? |
|---|---|---|---|
| 1 | Juez devuelve estructura válida y cita literal | `domain/evaluation/__tests__/engine.test.ts:72-89` | sí |
| 2 | `citas_pdf: []` | `engine.test.ts:145-153` (se conserva vacío) | **parcial**: falta que la nota NO suba con `is_correct: true` y `citas_pdf: []` |
| 3 | Fallo del LLM no tumba nada | `evaluation/__tests__/review.test.ts:169-180` | sí |
| 4 | JSON malformado se rechaza | — | **no** |
| 5 | Cita alucinada se marca y no sube nota | `engine.test.ts:91-104` + `review.test.ts:203-224` y `:226-244` | sí |
| 6 | Paráfrasis correcta sube la nota | `review.test.ts:182-201` | sí |
| 7 | Un profe caído, el panel sigue | `engine.test.ts:106-121` | sí |
| 8 | Los dos profes caídos, el panel sigue | `engine.test.ts:123-134` | sí |
| 9 | Sin evidencia no se llama al panel | `review.test.ts:246-264`, `:266-283`, `:285-301` (falla `extractText`) y `:303-318` (texto en blanco) | sí |

El `LanguageModel` falso que el plan viejo mandaba escribir **ya está escrito**:
`engine.test.ts:16-51` (`makeFakeLanguageModel`, con `generateText`, `generateObject`,
`streamText` y fallos guionizados por rol). El `MaterialRepository` de fixtures también:
`review.test.ts:29-53`. Y `verifyQuote` / `verifyCitations` / `normalizeForMatch` tienen
**23** casos en `domain/materials/__tests__/citation.test.ts` (contados ejecutando vitest
sobre ese fichero aislado), incluida la frontera exacta `MIN_QUOTE_LENGTH === 12`
(`:60-80`).

**Consecuencia directa: los pasos 1, 2, 3 y la mitad del 4 del plan original están
hechos. No los repitas.**

### La eval con LLM real sigue ahí y sigue siendo lo que era

`domain/agents/academic-tutor/evals/artifact-authoring.eval.ts` tiene **504 líneas** (el
plan viejo decía 473). `makeEvalLayer` mete `GeminiModel` directamente
(`:319-322`), así que necesita API key y cuesta dinero. `criteria` sigue siendo un `const`
de módulo compartido por todos los casos (`:422`). **No se toca.**

Lo que ya no es cierto: el repositorio falso de esa eval **sí** implementa `extractText`
desde `MaterialPageFixture.text` (`:289-303`); el paso 2 del plan viejo ("ese campo hoy no
lo usa nadie", `:36`) es falso, y además el schema está en `:49-53`.

### Lo que de verdad queda sin cubrir

Cuatro funciones y una ruta, todas puras o casi, todas de PRs posteriores al plan viejo:

| Sin test | Fichero | De qué PR |
|---|---|---|
| `resolveAllRefs`, `toGeminiResponseSchema` | `domain/agents/gemini-schema.ts:41-46` y `:59-76` | PR-03 |
| `formatTraceEntry`, `formatTraceHeader` | `domain/evaluation/trace-format.ts:61-89` y `:91-97` | PR-06 |
| `readNdjson` | `packages/web/src/lib/ndjson.ts:5-60` | PR-05 |
| `reviewGradedAttemptStreaming` (orden y terminalidad de frames) | `domain/evaluation/review.ts:275-289`, lógica en `:218-273` | PR-05 |
| La ruta de decodificación de `generateObject` con JSON malformado | — | PR-03/PR-04 |

`trace-format.ts:57-59` lleva escrito en un comentario *"la eval del PR-08 debe poder
comprobar el formato sin tocar disco"*: la función se diseñó para este PR y aún nadie la
llama desde un test.

### La entrega está sin hacer

- `README.md` son **101 líneas** y sigue siendo el README del template del challenge
  ("Template de inicio para explorar un caso fullstack + AI"). No dice qué problema se
  eligió, ni cómo se resolvió, ni qué checks se ejecutaron. Lo único propio es el punto 5
  de *"Por dónde empezar si estás evaluando el proyecto"*, que ya apunta a
  `.data/sessions/<attemptId>.md`.
- `docs/testing.md:17-25` sigue diciendo que las evals *"Requieren `.env` con
  `GOOGLE_GENERATIVE_AI_API_KEY`"* y **no menciona `pnpm test` en ninguna parte**.
- `documentacion/funcionamiento-actual.md:357-370` (§8 Evals) afirma *"No hay framework"*,
  *"473 líneas"*, *"no existe un `LanguageModel` falso"* y que el fixture de texto se
  disfraza de PNG porque no hay canal de texto. Las cuatro cosas son falsas hoy.
- `planes/plan.md:102-118`: los dieciséis planes de la tabla siguen en estado `borrador`.
- El `package.json` de la raíz **no tiene script `test`**: hoy hay que acordarse de
  `pnpm -r test` a mano.
- `planes/GUIA-DOER.md` §2 dice *"No hay test runner"* y §6 anuncia scripts `eval:pure` y
  `eval:panel` que este plan ya no crea. Corregido en el mismo commit que este plan.

### De dónde vino vitest (para no volver a atribuirlo mal)

vitest **no** llegó con PR-03 ni con PR-04. Entró en el commit `2bb42f4`
*"test: add unit test suite with vitest (22 tests, all passing)"*, que `git merge-base
--is-ancestor` confirma **anterior** tanto a PR-03 (`ac1f8cf`) como a PR-04 (`746edc4`).
Vino con la línea de trabajo de producto (PR-09..PR-13), no con la de evaluación.

## Problema

El sistema hace lo que promete y hay 91 tests que lo demuestran, pero **nadie que abra el
repo se entera**: el README es el del template, `docs/testing.md` no nombra el runner y la
documentación interna describe un repo que ya no existe. Además quedan cinco piezas de
PR-03, PR-05 y PR-06 sin una sola aserción encima, justo las que traducen entre nuestro
mundo y el de Gemini/el navegador, que es donde un cambio silencioso duele más.

## Objetivo

Cerrar los huecos de test que dejaron PR-03, PR-05 y PR-06, y dejar un README que explique
la entrega de principio a fin con checks reales.

## Fuera de alcance

- **Introducir un runner.** Ya está: `vitest ^5.0.0` en server y web. No se cambia de
  runner, no se añade jest, no se toca la configuración de vitest más allá de lo
  estrictamente necesario.
- **Reescribir los tests existentes.** Los 91 tests actuales pasan y cubren el núcleo. Se
  añade encima; no se reorganiza, no se renombra, no se "unifica el estilo".
- **Refactorizar `artifact-authoring.eval.ts`.** Sigue con `criteria` global (`:422`) y
  sigue llamando a Gemini de verdad (`:319-322`). Meterle criterios por caso es un refactor
  con riesgo y sin premio, y no lo necesita nadie.
- **Crear scripts `eval:pure` / `eval:panel`.** Eran la forma de tener tests sin runner.
  Con vitest instalado no tienen razón de existir: duplicarían lo que ya hace
  `pnpm test` y añadirían un segundo formato de informe que mantener.
- **Medir si el Juez es "listo".** Eso depende del modelo. Lo que se mide es que **el
  sistema no se rompe ni miente** cuando el Juez se equivoca.
- **Cambios de producto.** Si un test descubre un fallo real, se anota en el README como
  limitación conocida y se arregla en su propio PR.

## Contratos afectados

Ninguno. No se toca `packages/shared`.

## Pasos

### Paso 1 — Script `test` en la raíz

- [ ] Añadir a `package.json` de la raíz, junto a `typecheck` (`package.json:8-12`):
      `"test": "pnpm -r test"`.
- [ ] Comprobar: `pnpm run test` desde la raíz ejecuta las dos suites y sale en verde.

Es una línea y quita la excusa de "no sabía cómo se lanzan los tests" a quien evalúe.

### Paso 2 — Tests de `gemini-schema.ts` (hueco de PR-03)

- [ ] Crear `packages/server/src/domain/agents/__tests__/gemini-schema.test.ts`, junto a
      `gemini-thought-signature.test.ts` que ya vive en ese directorio.
- [ ] `resolveAllRefs` (`gemini-schema.ts:41-46`):
      - un `Schema.toJsonSchemaDocument` cuyo top level es un `$ref` a `definitions` se
        devuelve **inlineado**, sin `$ref` en ningún nivel;
      - un `$ref` anidado dentro de `properties` también se inlinea;
      - un `$ref` que no resuelve lanza `Unable to resolve $ref` (`:26-28`);
      - un `$ref` cíclico lanza `Cyclic $ref detected` (`:21-23`). **Este es el caso que
        más importa**: sin la guardia el resolvedor se colgaría en un bucle infinito, y un
        cuelgue no da traza. **Lee la nota de *Riesgos* antes de escribirlo**: el ciclo
        tiene que estar ANIDADO dentro de `properties`, no en el nivel superior.
- [ ] `toGeminiResponseSchema` (`gemini-schema.ts:59-76`): el resultado no contiene
      ninguna de las siete claves de `DISALLOWED_KEYS` (`:48-56`) — `$schema`, `$defs`,
      `$ref`, `additionalProperties`, `definitions`, `title`, `examples` — **a ninguna
      profundidad**, incluidas las que estén dentro de arrays.
- [ ] Un test de extremo a extremo de la pareja: partir de
      `Schema.toJsonSchemaDocument(FinalFeedbackSchema, { additionalProperties: false })`
      —el schema real que usa `gemini.ts:236-241`— y comprobar que
      `toGeminiResponseSchema(resolveAllRefs(doc))` sale limpio.

      **Justificación honesta (verificada ejecutando el `toJsonSchemaDocument` real):** ese
      documento hoy **no emite ningún `$ref`** y devuelve `definitions: {}`. Es decir, en
      este test `resolveAllRefs` es un **no-op puro** y lo único que se comprueba de verdad
      es que `toGeminiResponseSchema` elimina el `additionalProperties: false` que
      `toJsonSchemaDocument` sí pone. **No escribas en el commit ni en el README que este
      test caza lo que los sintéticos no cazan: hoy es falso.** Vale la pena igualmente
      como **guardia de regresión de la forma real**: si mañana `FinalFeedback` gana un
      campo que sí genere `$ref`/`definitions`, o si Effect cambia el shape del documento,
      este test es el que se entera. Escríbelo con esa justificación, no con la otra.

### Paso 3 — Tests de `trace-format.ts` (hueco de PR-06)

- [ ] Crear `packages/server/src/domain/evaluation/__tests__/trace-format.test.ts`.
- [ ] `formatTraceEntry` (`trace-format.ts:61-89`):
      - con un profe caído sale `_No disponible: <razón>_` (`:30-33`);
      - con el Juez caído sale `_No disponible: <razón>_` y **no** aparecen las líneas
        `is_correct` / `feedback` (`:35-43`);
      - sin evidencia sale `_Sin evidencia inyectada._` (`:14-17`);
      - un texto de evidencia de más de `MAX_EVIDENCE_LENGTH` (1500, `:3`) se trunca con el
        sufijo `…[truncado]` (`:5-6`), y uno de exactamente 1500 **no** se trunca;
      - la evidencia sale como blockquote, una `> ` por línea (`:8-12`);
      - la tabla de citas entrecomilla la cita y pone `✅`/`❌` y la página, con `—` en la
        página cuando no está verificada (`:50-51`); sin citas, `_Sin citas._` (`:46-48`);
      - `scoreOverridden: true` añade el recuento de citas verificadas con el plural
        correcto: **1 → "1 cita verificada"**, 2 → "2 citas verificadas" (`:83-87`). Ese
        triple ternario es exactamente el tipo de código que se rompe sin que nadie lo note.
- [ ] `formatTraceHeader` (`:91-97`): incluye `attemptId`, `artifactId` y fecha.

### Paso 4 — Test de `readNdjson` (hueco de PR-05)

- [ ] Crear `packages/web/src/lib/__tests__/ndjson.test.ts`.
- [ ] Construir la `Response` con un `ReadableStream` de `Uint8Array`; no hace falta red
      ni jsdom, la config es `environment: "node"` (`packages/web/vitest.config.ts`).
- [ ] **Consume siempre el generador hasta el final** (`for await` completo o
      `Array.fromAsync`). `readNdjson` hace `await reader.cancel()` en su `finally`
      (`ndjson.ts:57-59`), así que un `break` temprano dispara ese `finally` y cierra el
      stream a media lectura; si asertas "sólo llegan N frames" cortando el bucle, el test
      mide otra cosa.
- [ ] Casos, todos contra `ndjson.ts:5-60`:
      - varias líneas completas en un solo chunk → se emiten todas, en orden;
      - **un objeto JSON partido por la mitad entre dos chunks** → se emite entero una vez
        (el buffer de `:35-36` es el que lo hace y es lo más fácil de romper);
      - última línea **sin `\n` final** → se emite igualmente (`:49-56`);
      - líneas en blanco y sólo-espacios → se ignoran (`:39-40`);
      - una línea que no decodifica → **se salta con `console.warn` y el generador
        continúa** con las siguientes (`:17-24`). Esta es la garantía que ADR-02 vendió y
        que hoy no comprueba nadie;
      - `response.body === null` → lanza `Stream response did not include a body`
        (`:9-11`).

### Paso 5 — Tests del stream de evaluación (hueco de PR-05)

- [ ] Añadir a `packages/server/src/domain/evaluation/__tests__/` un
      `review-streaming.test.ts` que ejercite `reviewGradedAttemptStreaming`
      (`review.ts:275-289`) reutilizando los mismos fakes de `review.test.ts:20-124`
      (`fakeTrace`, `makeFakeEngine`, `makeFakeMaterialRepository`,
      `noLanguageModelNeeded`).
- [ ] **Cópialos. Importarlos no es una opción y no lo intentes.** `review.test.ts` no
      exporta nada (`grep -n "export" review.test.ts` → cero líneas): los cuatro fakes son
      `const` de módulo. La decisión de este plan es **duplicarlos** en
      `review-streaming.test.ts`, no añadirles `export` ni extraerlos a un helper
      compartido: son ~100 líneas de fixture de test, la duplicación es barata y el
      refactor tocaría un fichero verde y fuera de alcance. Copia sólo los que uses.
- [ ] Recoger el stream con `Stream.runCollect` y comprobar:
      - el **último** frame es siempre `{ type: "done" }`, y sólo hay uno;
      - `questionIndex` / `questionTotal` cuentan **sólo las short-answer con respuesta
        short-answer**, no todas las correcciones (`review.ts:233-242`): un test con una
        multiple-choice + dos short-answer debe dar `questionTotal: 2`;
      - un intento `ungraded` o de `artifactKind` distinto de `test` emite **únicamente**
        el `done` con el intento intacto (`review.ts:224-227`);
      - las correcciones que viajan en el `done` son las revisadas, no las de entrada
        (`review.ts:270-272`).
- [ ] **No** intentar comprobar el orden relativo de los `status` de Profe Bueno y Profe
      Malo: corren con `concurrency: "unbounded"`. Ver *Riesgos*.

### Paso 6 — Los dos casos de panel que faltan

- [ ] En `review.test.ts`, añadir: el panel responde `is_correct: true` con
      **`citas_pdf: []`** → la nota se queda en la determinista y `feedback` no cambia. Hoy
      todos los casos de ese fichero llevan exactamente una cita, así que la rama
      `hasVerifiedCitation === false` por array vacío (`review.ts:155-159`) nunca se
      ejecuta en tests. Es literalmente la exigencia nº2 de la Tech Spec §5.
- [ ] **AUTORIZACIÓN EXPLÍCITA — este paso sí modifica `review.test.ts`.** El helper
      `makeFakeEngine` (`review.test.ts:57-116`) sólo tiene dos modos, `"fail"` y
      `"succeed"`, y el modo `succeed` construye **siempre exactamente una cita**
      (`:96-103`): con la firma actual el caso `citas_pdf: []` es inalcanzable. Extiende el
      helper con un **tercer modo** —p. ej.
      `{ kind: "succeed-no-citations"; is_correct: boolean }`— que devuelva
      `citas_pdf: []` en el `feedback` y `citations: []` / `judge.citas_pdf: []` en la
      traza. Reglas del cambio:
      - **Aditivo y sólo aditivo.** No renombres ni cambies la forma de los modos `"fail"`
        y `"succeed"`; los ocho tests existentes deben seguir compilando y pasando **sin
        tocar una sola línea suya**.
      - No exportes el helper ni lo muevas a un fichero compartido (ver paso 5).
      - Si al escribirlo ves que un `quote: ""` o un `evidenceText` vacío ya produce el
        efecto sin tocar la firma, esa vía es preferible — pero **compruébalo de verdad**
        contra `:96-103` antes de darlo por bueno; el `citas_pdf` se construye siempre con
        un elemento, así que lo más probable es que no sirva.
      - Tras el cambio, `pnpm --filter @proxus/server run test` debe seguir en verde y el
        diff de `review.test.ts` debe ser: el modo nuevo + el test nuevo, nada más.
- [ ] En `engine.test.ts`, añadir el caso de **JSON malformado**: el fake de
      `generateObject` (`engine.test.ts:39-49`) hoy devuelve el `value` ya decodificado y
      nunca ejercita el decode. Hacer que falle con un `AiError.StructuredOutputError` en
      vez del `FakeModelError` genérico y comprobar que el motor lo convierte en
      `EvaluationUnavailable` con `stage: "judge"`, igual que el caso de `:136-143`.
      Encadenado con `review.test.ts:169-180`, eso cierra la exigencia nº3 de la Tech Spec:
      un fallo del LLM no tumba el servidor.

### Paso 7 — README de entrega

Reescribir `README.md` (hoy 101 líneas, el del template). `CHALLENGE.md` — *Cómo entregar*
pide cinco cosas y el README debe responderlas **en este orden**:

1. **Qué problema elegí.** La corrección de respuestas cortas por igualdad exacta de
   strings normalizados (`packages/server/src/domain/artifacts/artifact.ts:207`): un alumno
   que parafrasea saca cero. Y el riesgo obvio de arreglarlo con un LLM: que el tutor se
   invente la justificación.
2. **Cómo lo resolví.** Panel de tres agentes con los dos profes concurrentes
   (`Effect.all` con `concurrency: "unbounded"`, `mode: "result"`), Juez con salida
   estructurada vía `generateObject`, y **verificación literal de cada cita contra el texto
   extraído del PDF** (`domain/materials/citation.ts`). La regla que lo cierra todo está en
   `domain/evaluation/review.ts:154-160`: **la nota sólo sube si hay al menos una cita
   verificada y el Juez dice `is_correct`**. Incluir el diagrama del flujo.
3. **Cómo probarlo manualmente.** Los pasos exactos, empezando por *colocar un PDF con
   capa de texto en `packages/server/.data/materials/pdfs/`*, que no existe en un checkout
   limpio y sin lo cual nada de la parte de citas funciona.
4. **Qué checks ejecuté.** Los comandos de la sección *Checks* de este plan **con su
   resultado real** — número de tests incluido. Si algo no se pudo probar por falta de API
   key, **decirlo explícitamente**: `docs/testing.md` ya lo exige.
5. **Qué haría después.**

Y tres secciones más, porque `CHALLENGE.md` valora que se puedan explicar las decisiones de
principio a fin:

- **Trade-offs**, con las decisiones incómodas dichas en voz alta:
  - Por qué el scoring determinista sigue siendo la fuente de verdad y el panel va encima
    (degradación estructural con `mode: "result"`, no `try/catch`).
  - Por qué el `===` de `artifact.ts:207` sobrevive como ruta de reserva pese a que el
    ADR-01 pedía eliminarlo.
  - Por qué se cita por página y no con RAG.
  - Por qué se evalúa pregunta a pregunta pese a multiplicar las llamadas.
  - Por qué no se construyó un servicio de structured output: `generateObject` ya existía
    y sólo hacía falta honrar `responseFormat` en el adaptador (`gemini.ts:236-241`).
  - Por qué se metió vitest pese a que `CHALLENGE.md` desaconseja frameworks nuevos: 91
    tests deterministas sin API key son la respuesta directa al criterio *"capacidad de
    evaluación"*, y el script Effect a mano no escalaba más allá de un dataset.
- **Dónde mirar para auditar**: `packages/server/.data/sessions/<attemptId>.md`. **Es lo
  primero que va a abrir quien evalúe la prueba y hay que decírselo.** El README ya lo
  menciona de pasada en el punto 5 de *"Por dónde empezar"*; en la versión nueva tiene que
  ser una sección propia.
- **Limitaciones conocidas**, sin adornos y todas verificadas:
  - `streamText` es `Stream.empty` (`domain/agents/gemini.ts:468`): no hay streaming de
    tokens, sólo estados discretos.
  - Las rutas de streaming (`transport/http/server.ts:68-109`) no salen en OpenAPI ni en el
    cliente tipado: se llaman con `fetch` a pelo desde
    `packages/web/src/domain/artifacts/attempt-stream.ts`.
  - PDFs escaneados sin capa de texto: no se puede citar; el sistema lo detecta
    (`review.ts:120`) y degrada a la nota determinista.
  - `AgentMessage` sigue duplicado entre `shared/schemas/agent-message.ts` y
    `domain/agents/harness/message.ts`.
  - `toolParameters` (`domain/agents/gemini.ts:154-190`) hardcodea esquemas por nombre de
    tool: añadir una tool al harness sin tocarlo la anuncia a Gemini con el esquema
    equivocado.
  - `packages/ai-google` es dependencia declarada del server y no la importa nadie.
  - `ArtifactDetail` y `Sidebar` sólo tratan `onInitial`: un refresco en segundo plano
    muestra datos viejos sin avisar.
  - El estado del chat sigue en cinco `useState` dentro de
    `packages/web/src/domain/tutor/use-tutor-chat.ts`, no en atoms — a diferencia del
    workspace, que sí usa `evaluationRunAtom`
    (`packages/web/src/domain/artifacts/evaluation-atoms.ts:16-18`).
  - **Los tests usan un `LanguageModel` falso: garantizan que ante una respuesta X el
    sistema hace Y, no que los prompts sean buenos.** Lo único que mide la calidad de los
    prompts es `panel:check` contra Gemini de verdad, y es manual. Decirlo.

### Paso 8 — Cierre de documentación

- [ ] `docs/testing.md`: añadir una sección de tests automáticos **antes** de la de evals
      con LLM, con `pnpm run test` (o `pnpm -r test`) y el recuento real. Corregir
      `docs/testing.md:17-25`, que hoy da a entender que **toda** la capacidad de
      evaluación del repo necesita API key.
- [ ] `documentacion/funcionamiento-actual.md:357-370` (§8 Evals): reescribir. Tiene
      **cuatro afirmaciones falsas confirmadas**, y dos de ellas necesitan matiz — no las
      taches sin más:
      1. `:357` *"No hay framework"* → **falso y sin matiz**. vitest está en los dos
         paquetes: 11 ficheros, 91 tests. Sustituir.
      2. `:357` *"(473 líneas)"* → **son 504**. Corregir el número.
      3. `:363-364` *"no existe un `LanguageModel` falso"* → **falso a nivel de repo**:
         `engine.test.ts:16-51` es exactamente eso. **Matiz que hay que conservar:** la
         frase es *literalmente cierta dentro del ámbito de esa eval concreta*, que sí
         llama a Gemini de verdad (`artifact-authoring.eval.ts:319-322`). Lo incorrecto es
         el fraseo **absoluto**. Reescribir acotando: *"esta eval no usa modelo falso —
         llama a Gemini de verdad; el modelo falso vive en la suite vitest
         (`engine.test.ts:16-51`)"*.
      4. `:368-370` *"finge el canal de imagen porque no hay canal de texto"* → **el
         disfraz PNG es real, la CAUSA es falsa**. Sí hay canal de texto:
         `artifact-authoring.eval.ts:289-303` implementa `extractText` leyendo
         `MaterialPageFixture.text`. El disfraz PNG afecta **sólo a `renderPages`**
         (`:268-283`), no a todo el repositorio falso. Corregir la causa y acotar el
         alcance; **no borres la mención al PNG**, que sigue siendo cierta.
      Y describir los dos niveles reales: suite vitest determinista sin API key, y la eval
      con LLM real que sí cuesta dinero.
- [ ] Revisar que la tabla de límites duros de `funcionamiento-actual.md:375-395` y la
      lista de `planes/plan.md:256-283` reflejan el estado final tras los PRs. Ojo:
      `plan.md` §9 todavía lista como límite duro *"No hay salida estructurada:
      `gemini.ts` nunca envía `generationConfig`"*, y eso lo cerró el PR-03
      (`gemini.ts:236-241`). **Citar las entradas por su texto, nunca por su número**
      (`plan.md:134-135`).
- [ ] `planes/plan.md:102-118`: pasar a `mergeado` todos los planes ya integrados en
      `main`, y este a `en curso` mientras dure el PR.
- [ ] `planes/plan.md:118` (la fila de PR-08): **no basta con el Estado, hay que corregir
      otras dos celdas de esa misma fila**, que hoy contradicen la cabecera de este plan:
      - *Depende de*: dice `PR-07` → debe decir `—`. La cabecera de este plan dice
        **"Depende de: nada"**, porque PR-01..PR-07 ya están mergeados en `main`
        (`4d078aa`).
      - *Alcance*: dice *"Evals deterministas sin API key (modelo falso + funciones puras),
        QA final y README de entrega"* → describe el plan **viejo**, que ya no es este.
        Sustituir por el alcance real: *"Cierre de la cobertura de tests que dejaron PR-03,
        PR-05 y PR-06 (`gemini-schema`, `trace-format`, `readNdjson`, stream de
        evaluación), script `test` en la raíz, QA final y README de entrega."*
      - Conservar el **"No recortable."** al final del alcance.
- [ ] `AGENTS.md` §*Testing / checks*: hoy lista sólo `typecheck` y el build. Añadir
      `pnpm run test`.

### Paso 9 — QA final completa

- [ ] Ejecutar `docs/testing.md` de principio a fin sobre un checkout limpio, con
      `pnpm install` incluido, y anotar los resultados **reales** en el README.
- [ ] Probar el arranque sin `pdftotext` en el PATH: debe fallar rápido con mensaje claro.
- [ ] Probar con `GEMINI_MODEL` inexistente: el producto degrada a la nota determinista,
      no se rompe (ya está en `docs/testing.md`, punto 10).

## Criterio de aceptación

1. `pnpm run test` desde la raíz ejecuta las dos suites y pasa **sin fichero `.env`, sin
   API key y sin ninguna llamada de red**.
2. Los tests nuevos de los pasos 2 a 6 existen y pasan; el recuento total sube de 91.
3. `gemini-schema.ts`, `trace-format.ts`, `readNdjson` y `reviewGradedAttemptStreaming`
   dejan de estar a cero tests.
4. Rompiendo a propósito la condición `hasVerifiedCitation` de `review.ts:155-159`,
   **falla al menos un test** de `review.test.ts`. Una suite que no puede ponerse roja no
   vale nada: hay que comprobarlo y deshacer el cambio después.
5. Los 91 tests que ya existían siguen pasando. **La única edición permitida sobre un
   fichero de test existente es la del paso 6**: el modo nuevo de `makeFakeEngine` en
   `review.test.ts` (aditivo) más el test nuevo que lo usa. Ningún test ya existente
   cambia de cuerpo, de nombre ni de aserciones; el diff de `review.test.ts` no debe
   contener otra cosa. Fuera de ese fichero, cero ediciones a tests existentes.
6. `pnpm --filter @proxus/server run eval:tutor:artifact-authoring` sigue pasando con API
   key: no se ha roto nada de lo que había.
7. El README responde las cinco preguntas de `CHALLENGE.md`, con los comandos y sus
   resultados reales.
8. El README lista las limitaciones conocidas del paso 7, sin omitir ninguna.
9. Un lector que no conozca el repo puede, siguiendo sólo el README, dejar el sistema
   funcionando y ver una cita verificada.
10. `documentacion/funcionamiento-actual.md` §8 ya no afirma que no haya framework de tests
    ni que no exista un `LanguageModel` falso.
11. `pnpm run typecheck` y el build de web en verde.

## Checks

```bash
pnpm run typecheck
pnpm run test                                   # sin API key, sin red
pnpm --filter @proxus/web run build
pnpm --filter @proxus/server run eval:tutor:artifact-authoring   # requiere API key
```

## QA manual

1. `git clone` limpio en otro directorio, `pnpm install`, **sin crear `.env`**.
2. `pnpm run test` debe pasar igualmente. Si algo pide la key, el criterio de aceptación
   nº1 ha fallado.
3. Crear `.env`, colocar un PDF con capa de texto en
   `packages/server/.data/materials/pdfs/` y ejecutar la QA completa de `docs/testing.md`,
   incluido su punto 10 (flujo de respuesta corta con panel).
4. Leer el README **como si no se conociera el proyecto** y seguirlo al pie de la letra. Si
   algún paso obliga a abrir el código para entenderlo, reescribir ese paso.
5. Abrir una traza de `.data/sessions/` y confirmar que se entiende sin ayuda.

## Riesgos y decisiones

- **El orden entre los dos profes no es determinista.** Corren con
  `concurrency: "unbounded"`, así que ningún test puede afirmar cuál emite antes. Por eso
  el paso 5 prohíbe explícitamente aserciones sobre el orden relativo de los `status`. Si
  se cuela una, sale como test intermitente, que es la peor forma de descubrirlo. Nótese
  que `engine.test.ts:106-121` ya lo hace bien: usa `some(...)` sobre los prompts vistos,
  no índices.
- **Un modelo falso prueba el sistema, no el prompt.** Los tests garantizan que ante una
  respuesta X del Juez el sistema hace Y. No dicen nada sobre si los prompts son buenos:
  eso sólo lo dice `panel:check` contra Gemini de verdad, y es manual. Hay que escribirlo
  en el README para no vender más de lo que hay.
- **Criterio 4 es incómodo y por eso está.** Hay que romper `review.ts` a propósito y
  comprobar que la suite se pone roja. Una suite que pasa siempre da falsa seguridad, que
  es peor que no tenerla. **Deshacer el cambio antes de commitear.**
- **No extraer los fakes a un helper "compartido".** Es la tentación obvia del paso 5.
  `review.test.ts` **no exporta nada** (cero coincidencias de `export`), así que importar
  los fakes es imposible sin modificarlo, y extraerlos a un módulo común arrastraría todo
  el fichero a un refactor que no aporta. La decisión es **copiar** en
  `review-streaming.test.ts`. Ojo con la asimetría deliberada respecto al punto siguiente:
  el paso 6 **sí** edita `review.test.ts`, y sólo para lo que ahí se autoriza.
- **`review.test.ts` está semi-abierto, no cerrado.** El paso 6 autoriza **una única**
  modificación: añadir un tercer modo a `makeFakeEngine` (`:57-116`) porque el modo
  `succeed` construye siempre exactamente una cita (`:96-103`) y sin eso el caso
  `citas_pdf: []` es inalcanzable. Todo lo demás del fichero sigue congelado: no se
  exportan helpers, no se renombra, no se toca ningún test existente. Si te ves cambiando
  la firma de los modos `"fail"` o `"succeed"`, te has salido del alcance.
- **El test de `$ref` cíclico es lo más frágil de todo el PR, y el orden importa.**
  Ningún schema del repo emite `$ref` (verificado: `Schema.toJsonSchemaDocument` sobre
  `FinalFeedbackSchema` devuelve `definitions: {}` y ni un `$ref`), así que el doer tendrá
  que **fabricar a mano** un `JsonSchema.Document<"draft-2020-12">` literal, probablemente
  con un cast. Y la trampa: `resolveAllRefs` llama **primero** a
  `JsonSchema.resolveTopLevel$ref` (`gemini-schema.ts:44`), antes de entrar en
  `substituteRefs`. Un ciclo colocado en el **nivel superior** revienta ahí dentro, con un
  mensaje de error de Effect que **no** es `"Cyclic $ref detected"`, y el test quedaría
  verde probando otra cosa. **Para alcanzar la guardia de `:21-23` el ciclo tiene que
  estar ANIDADO**, dentro de `properties` (p. ej. `properties.hijo.$ref → "#/definitions/A"`
  con `definitions.A.properties.hijo.$ref` apuntando de vuelta a `A`). Assertar sobre el
  mensaje concreto, no sólo sobre "lanza".
- **`readNdjson` cancela el reader en su `finally`.** El entorno de
  `packages/web/vitest.config.ts` es `node`, así que `Response` y `ReadableStream` existen
  y no hace falta jsdom ni polyfills. Pero `readNdjson` hace `await reader.cancel()` en el
  `finally` (`ndjson.ts:57-59`): salir del `for await` con un `break` temprano dispara ese
  cierre. **Consume el generador hasta el final** en todos los tests del paso 4.
- **El README es más de la mitad del valor de este PR.** `CHALLENGE.md` puntúa la
  comunicación al mismo nivel que el código. Escribir limitaciones reales —incluidas las
  feas, como `toolParameters` o el `AgentMessage` duplicado— demuestra que se conoce el
  sistema; ocultarlas se nota.
- **Si hay que recortar dentro del PR**, el orden es: primero los pasos 1, 6, 7 y 8
  (script raíz, los dos casos de panel que faltan, README y documentación); después los
  pasos 2 y 3 (funciones puras, baratas); y por último los pasos 4 y 5 (NDJSON y stream,
  los más laboriosos de montar). **Lo que no se recorta es el README**: sin él la entrega
  está incompleta por definición.

## Historial

- **2026-09-08 — Reescritura completa del plan tras revalidarlo contra `main`.** El plan
  original se escribió antes de PR-02..PR-07 y había derivado en casi todo lo verificable:

  | Decía | Dice ahora |
  |---|---|
  | *"El repo no tiene ningún runner"*, *"Fuera de alcance: introducir vitest"* | `vitest ^5.0.0` en server (`packages/server/package.json:26`) y web (`:29`), con `test`/`test:watch` y config propia. 11 ficheros, 91 tests en verde. |
  | Paso 1: escribir un `TestLanguageModel` falso | Ya existe: `engine.test.ts:16-51`. Paso eliminado. |
  | Paso 2: escribir un `MaterialRepository` de fixtures | Ya existe: `review.test.ts:29-53`. Paso eliminado. |
  | Paso 3: `feedback-panel.eval.ts` con 9 casos y script `eval:panel` | 8 de los 9 casos ya están en `engine.test.ts` y `review.test.ts` (tabla en *Estado real verificado*). Quedan dos: `citas_pdf: []` y JSON malformado → paso 6. Script eliminado. |
  | Paso 4: `pure.eval.ts` con `verifyQuote`/`verifyCitations` y script `eval:pure` | `citation.test.ts` ya cubre las dos con **23** casos, incluida la frontera `MIN_QUOTE_LENGTH === 12` (`:60-80`). Sobreviven sólo `resolveAllRefs`/`toGeminiResponseSchema` y `formatTraceEntry`, ahora pasos 2 y 3 con vitest. Script eliminado. |
  | *"473 líneas"* (`artifact-authoring.eval.ts`) | 504 líneas. |
  | `makeEvalLayer` en `:288-292`; `criteria` en `:391-395` | `:319-322` y `:422`. |
  | *"`MaterialPageFixture.text` hoy no lo usa nadie (`:36`)"* | Falso: el repositorio falso implementa `extractText` desde ese campo (`:289-303`); el schema está en `:49-53`. |
  | `gemini.ts:285` para `streamText: Stream.empty` | `gemini.ts:468`. |
  | `toolParameters` en `gemini.ts:124-154` | `:154-190`. |
  | El `===` de la corrección en `artifact.ts:463` | `artifact.ts:207`. |
  | Nota *"Depende de PR-02, PR-03, PR-04, PR-06"* y estado `borrador` | PR-01..PR-07 están mergeados en `main` (`4d078aa`). Sin dependencias pendientes; estado `listo para implementar`. |
  | Trampa de `node --env-file` como razón para evitar la bandera | Sigue siendo cierta como trampa del repo, pero ya no aplica: los tests corren con vitest, no con `node --env-file`. Nota eliminada. |

  **Alcance nuevo**, por capacidades que PR-03, PR-05 y PR-06 introdujeron después de
  escribirse el plan y que nadie cubre hoy: paso 2 (`gemini-schema.ts`), paso 3
  (`trace-format.ts`), paso 4 (`readNdjson`), paso 5 (`reviewGradedAttemptStreaming`) y
  paso 1 (script `test` en la raíz).

  En el mismo commit se corrigen dos afirmaciones obsoletas de
  [`../GUIA-DOER.md`](../GUIA-DOER.md): §2 *"No hay test runner"* y la tabla de §6 que
  anunciaba `eval:pure` y `eval:panel` como scripts a crear en este PR.
