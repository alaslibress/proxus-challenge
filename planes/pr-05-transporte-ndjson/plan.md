# PR-05 — Endpoint NDJSON dedicado y decodificador resiliente

- **Rama**: `feat/transporte-ndjson`
- **Depende de**: PR-04 (`EvaluationEngineService`). Modifica su firma: ver Paso 2.
- **Conflicto conocido**: toca `domain/evaluation/engine.ts` y `review.ts`, los mismos
  ficheros que el PR-06. **No se implementan en paralelo.**
- **Bloquea a**: PR-07 (UI). El PR-06 puede ir en paralelo.
- **Conflicto añadido (PR-10)**: el PR-10 (`fix/chat-input-lifecycle`) se implementa
  antes que este PR y reescribe `Chat.tsx` y `domain/tutor/stream.ts`. **El Paso 6 de
  este plan y la firma de `streamTutorMessage` descritos aquí ya no corresponden al
  código.** El thinker actualizará este plan tras el merge del PR-10; hasta entonces el
  doer no lo implementa.
- **Estado**: borrador
- **Contiene LLM**: sí, indirectamente. No añade prompts.
- **Origen**: [ADR-02 §1](../../documentacion/adr-02-evaluacion-transporte-observabilidad.md) y [ADR-01, Decisión 3](../../documentacion/adr-motor-evaluacion.md).

> Normas de trabajo en [`../plan.md`](../plan.md). Contexto técnico obligatorio en
> [`../../documentacion/contexto-repo.md`](../../documentacion/contexto-repo.md) y
> [`../../documentacion/funcionamiento-actual.md`](../../documentacion/funcionamiento-actual.md).
> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.

---

## Problema

Tras el PR-04, corregir un test con respuestas cortas dispara tres llamadas al LLM por
pregunta. El endpoint que lo hace es el `submit` de siempre
(`transport/http/handlers.ts:53-59`): síncrono, sin ningún tipo de señal, con el alumno
mirando un botón que pone *"Submitting…"* durante decenas de segundos sin saber si el
sistema está trabajando o colgado.

Además hay una fragilidad heredada en el transporte que ya existe:

- `packages/web/src/domain/tutor/stream.ts:6` decodifica con
  **`Schema.decodeUnknownSync`**, que lanza. Una sola línea que no encaje en la unión
  —un frame de un tipo que el cliente no conoce todavía— **revienta el generador y mata
  el stream entero**. Un despliegue en el que el servidor vaya por delante del cliente
  rompe el chat.
- `Chat.tsx:42-61` solo hace `continue` con `"done"` y para todo lo demás lee
  `event.message` a ciegas. Un frame nuevo lo rompe aunque el parser sobreviva.
- En el servidor, un fallo a mitad de stream **corta la conexión sin frame terminal**
  (`harness/session.ts:51-59`): la respuesta ya salió con 200 y las cabeceras ya se
  enviaron, así que el cliente se queda esperando un `done` que no llega.

## Objetivo

Que el alumno vea el progreso real del panel mientras se corrige su intento, y que el
transporte NDJSON deje de romperse por un frame desconocido o por un fallo a mitad.

## Fuera de alcance

- La UI. Este PR deja el stream consumible y **no toca ni un componente**, salvo el
  mínimo imprescindible en `Chat.tsx` para que no explote (Paso 6). Los estados visuales
  y el render de citas son PR-07.
- La trazabilidad en `.data/sessions/`. Eso es PR-06.
- Los prompts, el motor y la lógica de corrección. No se toca nada del PR-04 salvo la
  firma que se indica en el Paso 2.
- Implementar `streamText` de verdad en Gemini. Sigue siendo `Stream.empty`: la decisión
  de estados discretos ya está cerrada (ADR-02 §1).

## Contratos afectados

### Nuevo: `AttemptStreamEvent` en `packages/shared/src/api/artifacts.ts`

```ts
export const AttemptEvaluationStage = Schema.Union([
  Schema.Literal("evaluating_good"),
  Schema.Literal("evaluating_bad"),
  Schema.Literal("deliberating")
]);

export const AttemptStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("status"),
    value: AttemptEvaluationStage,
    questionId: Schema.String,
    questionIndex: Schema.Number,
    questionTotal: Schema.Number
  }),
  Schema.Struct({ type: Schema.Literal("done"), payload: ArtifactAttempt }),
  Schema.Struct({ type: Schema.Literal("error"), message: Schema.String })
]);
export type AttemptStreamEvent = typeof AttemptStreamEvent.Type;
```

La unión de literales se escribe como `Schema.Union([Schema.Literal(...), ...])`, que es
el patrón que ya usa el repo (`ArtifactSummary.kind`, `ListArtifactsInput.kind`). No
inventar helpers.

**Dos desviaciones sobre el ADR-02, ambas deliberadas:**

1. **`done.payload` es el `ArtifactAttempt`, no `FinalFeedbackSchema`.** El ADR escribe
   `{"type":"done","payload":{...FinalFeedbackSchema}}`, pero esta ruta sustituye a
   `POST /api/artifacts/:id/submit`, que devuelve un attempt corregido entero: nota total,
   resumen y una corrección por pregunta. Un test puede tener varias respuestas cortas, así
   que un solo `FinalFeedbackSchema` no cabe. Los feedbacks del Juez **siguen ahí**: viven
   dentro de cada `ShortAnswerCorrection.review`, tal como los dejó el PR-04.
2. **`status` lleva `questionId`, `questionIndex` y `questionTotal`.** El ADR fija el
   campo `value` y sus tres valores, que se respetan **literalmente**. Pero con cinco
   preguntas cortas los tres estados se repiten cinco veces, y sin saber de qué pregunta
   se habla la UI solo puede parpadear. Son campos añadidos, no un cambio de forma.

### Sin tocar `TutorChatStreamEvent`

La unión del chat se queda igual. Este PR endurece su **parser**, no su contrato.

## Pasos

### Paso 1 — Contrato

- [ ] Añadir `AttemptEvaluationStage` y `AttemptStreamEvent` a
      `packages/shared/src/api/artifacts.ts`, junto a los endpoints ya definidos.
- [ ] Ya se exporta vía `export * from "./api/artifacts.ts"` en `index.ts`: nada más.

**La ruta de streaming no se declara en `ProxusApi`.** Igual que la del tutor, es una ruta
manual de `HttpRouter` y por tanto **no aparece en OpenAPI ni en `/docs`**. Es una
limitación conocida del repo, no un olvido; se anota en el README de entrega.

### Paso 2 — Hook de progreso en el motor

El PR-04 dejó `evaluate` devolviendo un `Effect`. Los estados `evaluating_good` y
`evaluating_bad` ocurren **dentro** del motor, así que el llamante no puede emitirlos: el
hook tiene que entrar ahí.

- [ ] En `domain/evaluation/engine.ts`, ampliar la firma:
      ```ts
      readonly evaluate: (
        input: EvaluationInput,
        emit?: (stage: AttemptEvaluationStage) => Effect.Effect<void>
      ) => Effect.Effect<EnrichedFeedbackSchema, EvaluationError, LanguageModel.LanguageModel>;
      ```
- [ ] Emitir `evaluating_good` y `evaluating_bad` **antes** del `Effect.all`, y
      `deliberating` justo antes de la llamada al Juez.
- [ ] Cuando `emit` no se pasa, el comportamiento es idéntico al del PR-04. El
      `submit` no-streaming sigue funcionando sin cambios.

> **Los dos profes corren en paralelo, así que sus dos estados se emiten a la vez.** No
> son fases sucesivas. El ADR-02 los lista uno tras otro, pero emitirlos en secuencia
> falsearía la arquitectura concurrente que es justo lo que el proyecto quiere enseñar. La
> UI del PR-07 debe mostrar los dos profes activos simultáneamente y el Juez después.

### Paso 3 — Stream de revisión

- [ ] En `domain/evaluation/review.ts`, añadir junto a `reviewGradedAttempt`:
      ```ts
      export const reviewGradedAttemptStreaming: (
        artifact: Artifact,
        attempt: ArtifactAttempt
      ) => Stream.Stream<AttemptStreamEvent, never, EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel>;
      ```
- [ ] Construirlo con **`Stream.callback` + `Queue`**, exactamente el patrón que ya usa
      `AgentSession.stream` (`domain/agents/harness/session.ts:47-60`): `Queue.offer` por
      evento, `Queue.end` al terminar y `Queue.failCause` si algo revienta. No inventar un
      mecanismo nuevo: el repo ya tiene uno y funciona.
- [ ] El último frame es siempre `{ type: "done", payload: <attempt revisado> }`.
- [ ] `Stream.catchCause` alrededor: cualquier defecto se convierte en
      `{ type: "error", message }` seguido del cierre del stream. **Nunca se corta la
      conexión sin frame terminal.** Esto arregla el agujero heredado del harness.

### Paso 4 — La ruta

En `packages/server/src/transport/http/server.ts`, siguiendo el molde de
`TutorStreamRoute` (`:30-48`):

- [ ] Un `encodeNdjson` propio para `AttemptStreamEvent`. **No reutilizar el del tutor**:
      está tipado contra `TutorChatStreamEvent` (`:27-28`). Extraer un helper genérico
      `makeNdjsonEncoder(schema)` y usarlo para los dos.
- [ ] Envolver `Schema.encodeSync` en un `try/catch`: si un evento no codifica, emitir un
      frame `error` en su lugar en vez de tumbar el stream. Es la mitad servidor de la
      resiliencia que pide el ADR.
- [ ] La ruta:
      ```ts
      const AttemptStreamRoute = HttpRouter.add(
        "POST",
        "/api/artifacts/:id/submit/stream",
        () => Effect.gen(function* () {
          const params = yield* HttpRouter.params;
          const artifactId = params.id;
          const payload = yield* HttpServerRequest.schemaBodyJson(SubmitAttemptInput);
          ...
        })
      );
      ```
      `HttpRouter.params` es un `Effect<ReadonlyRecord<string, string | undefined>, never, RouteContext>`
      (`HttpRouter.d.ts:100`). **Ojo con `noUncheckedIndexedAccess`**: `params.id` es
      `string | undefined` y hay que tratarlo, no forzarlo con `!`.
- [ ] El prefijo `/api` va escrito **literalmente** en el path, igual que en la ruta del
      tutor: el `.prefix("/api")` del `HttpApi` no aplica a las rutas de `HttpRouter`.
- [ ] Mismas cabeceras que la ruta del tutor: `contentType: "application/x-ndjson"`,
      `cache-control: no-cache`, `x-accel-buffering: no`.
- [ ] Reutilizar el contrato de entrada `SubmitAttemptInput` y mezclar el `:id` del path
      sobre el `artifactId` del payload, **igual que hace el handler existente**
      (`handlers.ts:53-56`).
- [ ] Añadirla a `Layer.mergeAll(...)` en `:50`.
- [ ] **Mantener vivo `POST /api/artifacts/:id/submit`.** Es la ruta tipada, sale en
      OpenAPI y es la degradación si el streaming falla en el navegador.

### Paso 5 — Lector NDJSON resiliente y compartido (web)

- [ ] Crear `packages/web/src/lib/ndjson.ts` con un lector genérico que sustituya al
      cuerpo de `stream.ts`:
      ```ts
      export async function* readNdjson<A>(
        response: Response,
        decode: (line: string) => A
      ): AsyncGenerator<A>
      ```
- [ ] Mover tal cual la lógica que ya es correcta de `stream.ts:26-53`: buffer,
      `split("\n")`, `lines.pop()` para la línea parcial, `TextDecoder({ stream: true })`
      y el flush final. **No reescribirla**: está bien resuelta, incluido el UTF-8 partido
      entre chunks.
- [ ] **El cambio de fondo**: envolver cada `decode(trimmed)` en `try/catch`. Si falla, se
      hace `console.warn` con la línea y **se continúa con la siguiente**. Una línea mala
      no puede matar el stream.
      Se usa `try/catch` sobre el decodificador síncrono y no una variante `Either`/`Result`
      a propósito: cero riesgo de API en un repo sobre Effect v4 beta, y el efecto es el
      mismo.
- [ ] Aceptar un `AbortSignal` opcional y pasarlo al `fetch`. No hay forma de cancelar hoy;
      esto habilita el botón de parar del PR-07 sin volver a tocar este fichero.
- [ ] Reescribir `packages/web/src/domain/tutor/stream.ts` para que use `readNdjson`.
      Su API pública (`streamTutorMessage`) **no cambia**.

### Paso 6 — Consumidor del stream de intentos

- [ ] Crear `packages/web/src/domain/artifacts/attempt-stream.ts` con
      `streamAttemptSubmission(artifactId, input, signal?)`, calcado de `stream.ts`:
      `fetch` a `${apiClientConfig.apiUrl}/api/artifacts/${artifactId}/submit/stream`,
      cabeceras `content-type: application/json` y `accept: application/x-ndjson`, y
      `readNdjson` con el decodificador de `AttemptStreamEvent`.
- [ ] En `Chat.tsx`, cambiar el `switch` del bucle (`:42-61`) para que **ignore cualquier
      frame cuyo `type` no sea `"message"`**, en vez de leer `event.message` a ciegas para
      todo lo que no sea `"done"`. Es un cambio de tres líneas y es la otra mitad de la
      resiliencia. **No se toca nada más de la UI en este PR.**

### Paso 7 — Documentación

- [ ] `docs/api.md`: documentar `POST /api/artifacts/:id/submit/stream`, sus tres tipos de
      frame y la nota de que no aparece en OpenAPI.
- [ ] `documentacion/funcionamiento-actual.md` §2: el parser ya no es estricto; actualizar
      el párrafo y la fila correspondiente de la tabla §9.
- [ ] `planes/plan.md` §9: actualizar el límite duro **"El cliente NDJSON decodifica en
      estricto"**. Referenciar por texto y no por número: la lista se renumera cada vez
      que un PR elimina una entrada.

## Criterio de aceptación

1. `POST /api/artifacts/:id/submit/stream` con un test de una respuesta corta emite, en
   orden: dos `status` (`evaluating_good` y `evaluating_bad`) prácticamente a la vez, un
   `status` `deliberating`, y un `done` con el attempt corregido.
2. Con N respuestas cortas se emiten 3·N eventos `status`, cada uno con su `questionId` y
   su `questionIndex` correcto.
3. El `done.payload` es idéntico a lo que devuelve `POST /api/artifacts/:id/submit` con el
   mismo cuerpo.
4. Un fallo del motor produce un frame `error` **y el stream se cierra limpiamente**. La
   conexión nunca se corta sin frame terminal.
5. Inyectando una línea que no encaje en la unión, el cliente la salta con un `warn` y
   **sigue consumiendo** los frames siguientes.
6. Una línea de JSON partida entre dos chunks TCP se reensambla bien (comportamiento que ya
   existía y que no debe perderse al extraer `readNdjson`).
7. El chat del tutor funciona exactamente igual que antes.
8. `POST /api/artifacts/:id/submit` sigue existiendo y funcionando.
9. `pnpm run typecheck` y el build de web en verde.

## Checks

```bash
pnpm run typecheck
pnpm --filter @proxus/web run build

curl -N -X POST http://localhost:3000/api/artifacts/<id>/submit/stream \
  -H 'content-type: application/json' \
  -d '{"artifactKind":"test","artifactId":"<id>","answers":[...]}'
```

`curl -N` desactiva el buffering y deja ver los frames llegar de uno en uno. Es la forma
de comprobar el paso 1 del criterio de aceptación sin navegador.

## QA manual

1. PDF con capa de texto en `packages/server/.data/materials/pdfs/` y `pnpm run dev`.
2. Pedir al tutor un test con **dos** preguntas de respuesta corta desde una página.
3. Lanzar el `curl -N` de arriba y ver los seis `status` y el `done`.
4. Repetir con `GEMINI_MODEL` apuntando a un modelo inexistente: debe llegar el `done` con
   la corrección determinista, o un `error` seguido de cierre limpio. Nunca un cuelgue.
5. Comprobar en la pestaña de red del navegador que el chat sigue funcionando.
6. Añadir a mano un `console.log` que inyecte una línea basura en el lector y confirmar que
   el stream continúa.

## Riesgos y decisiones

- **"Decodificador resiliente en cliente y servidor": el servidor no parsea NDJSON.** El
  ADR-01 pide parchear el parser en ambos lados, pero el servidor solo **produce** frames.
  La resiliencia equivalente, y la que se implementa, es doble: que un evento que no
  codifique no tumbe el stream, y que todo fallo termine en un frame `error` en vez de en
  una conexión cortada. Es el problema real que había.
- **La ruta nueva no está en OpenAPI ni en el cliente tipado.** Se consume con `fetch`
  crudo, igual que la del tutor. `HttpApiBuilder` no modela respuestas en streaming en esta
  beta; forzarlo sería pelearse con la librería. Limitación conocida, va al README.
- **Se emiten estados, no progreso real del LLM.** Un `status` dice que una llamada
  empezó, no cuánto le queda: `streamText` es `Stream.empty` y no hay tokens que contar. La
  UI del PR-07 no debe insinuar porcentajes ni tiempos.
- **Duplicidad de rutas de envío.** Quedan `submit` y `submit/stream` haciendo lo mismo con
  distinto transporte. Es deliberado: la tipada es la degradación y la que sale en `/docs`.
  El coste es que un cambio en la corrección hay que reflejarlo en dos sitios, y por eso
  ambas llaman a las **mismas** funciones de dominio.
- **`params.id` es `string | undefined`.** Con `noUncheckedIndexedAccess` activo hay que
  tratar el caso ausente y devolver un 400, no forzar con `!`. Es el error de compilación
  más probable de todo el PR.
- **Este PR cambia la firma de `evaluate` del PR-04.** Está anotado en el Paso 2 para que
  no sorprenda. Si el PR-04 ya está mergeado, es un cambio aditivo con parámetro opcional:
  ningún llamante existente se rompe.

## Historial

- **Tras el PR-10**: `stream.ts` pasa a aceptar un `AbortSignal` y `Chat.tsx` delega su
  estado en el hook `useTutorChat`. El Paso 6 debe reescribirse sobre esa base.

_Sin cambios todavía. El thinker anota aquí cualquier corrección al plan que venga del
doer, con fecha y motivo._
