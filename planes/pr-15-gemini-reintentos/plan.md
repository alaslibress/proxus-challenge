# PR-15 — Reintentos con backoff en Gemini, y errores que dicen qué llamada falló

- **Rama**: `fix/gemini-reintentos`
- **Depende de**: **PR-14** (`fix/solucion-errores`). Sale de esa rama, no de `main`: el
  paso 13 del PR-14 acaba de escribir el `streamText` que aquí se toca. Hacerlo desde
  `main` garantiza conflicto en `gemini.ts`.
- **Estado**: borrador
- **Contiene LLM**: no cambia ningún prompt. Sí cambia **cómo** se llama al modelo.
- **Fichero delicado**: `packages/server/src/domain/agents/gemini.ts`, donde viven la fuga
  de tool calls del PR-12, el reintento con `mode:ANY` y los `thoughtSignature`. Este PR
  **no toca la lógica de decisión de ninguno de los tres**: sólo envuelve las llamadas
  HTTP.
- **Origen**: incidente observado el 15 de septiembre de 2026 usando la aplicación.

> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica
> con el formato de `planes/GUIA-DOER.md` §4.

---

## Problema

### El incidente

Con la aplicación en marcha, el chat del tutor devolvió esto al alumno:

```
I hit an internal model/tool-routing error, so I stopped this turn safely instead of crashing the app.

GeminiLanguageModel.generateText: { "error": { "code": 503, "message": "This model is
currently experiencing high demand. Spikes in demand are usually temporary. Please try
again later.", "status": "UNAVAILABLE" } }
```

El 503 es de Google, no del repo: el modelo estaba saturado. El mensaje que lo envuelve
es la red de seguridad propia (`modelErrorResponse`,
`domain/agents/harness/session.ts:187-191`), que capturó el fallo y contestó en vez de
reventar. Eso funciona bien y **no se toca**.

Lo que no funciona es todo lo demás.

### 1. No hay un solo reintento en el servidor

```bash
grep -rn "Effect.retry\|Schedule\." packages/server/src/     # 0 aciertos
```

Un `503 UNAVAILABLE` —que Google documenta como transitorio y reintentable— le cuesta al
alumno el turno entero. Y no es sólo el chat: `callGeminiOnce`
(`gemini.ts:357-385`) es el único camino de `generateText`, así que el mismo 503 tumba
también al **Juez** del panel, que va por `LanguageModel.generateObject`. Un pico de
demanda de dos segundos se convierte en una corrección perdida.

### 2. El código de estado se tira antes de poder decidir nada

```ts
// gemini.ts:367-369
if (!response.ok) {
  throw new Error(await response.text());
}
```

El `503` llega abajo como un **string dentro de un mensaje**. No queda nada estructurado
con lo que distinguir *"vuelve a intentarlo"* de *"tu API key es inválida"*. Cualquier
reintento escrito sobre esto sería a ciegas: reintentar un `401` tres veces sólo retrasa
el error y gasta cuota.

El `streamText` del PR-14 (`gemini.ts:487-493`) tiene exactamente el mismo problema, con
otra forma: `return yield* Effect.fail(toAiError(body))`.

### 3. El error miente sobre qué llamada falló

```ts
// gemini.ts:68-73
const toAiError = (description: string) =>
  AiError.make({
    module: "GeminiLanguageModel",
    method: "generateText",      // hardcodeado
    reason: new AiError.UnknownError({ description })
  });
```

`method` está fijo. Hasta el PR-14 era inocuo porque sólo existía una llamada. Ya no:
el paso 13 añadió `streamText`, y sus **seis** sitios de error
(`gemini.ts:485,491,493,498,510` y el `catchCause` final) usan el mismo helper. Hoy, un
503 durante el streaming del Profe Bueno se reporta como `GeminiLanguageModel.generateText`.

El incidente de arriba dice `generateText`, y por eso **no se puede afirmar desde el log si
venía del chat o del panel**. Se dedujo por otra vía —`modelErrorResponse` sólo existe en
el harness del tutor— pero eso es suerte, no instrumentación.

### 4. El `fetch` del streaming no manda `content-type`

```ts
// gemini.ts:484
fetch(url, { method: "POST", body: JSON.stringify(requestBody(options)) })
```

`callGeminiOnce` sí lo manda (`gemini.ts:361`). Si hoy funciona es porque Google lo
tolera; es una inconsistencia entre dos llamadas al mismo API, en el mismo fichero, y
tocamos esa línea de todos modos.

## Objetivo

Que un pico de demanda de Google no le cueste el turno al alumno, y que cuando una llamada
al modelo falle de verdad, el error diga **cuál** falló y **por qué**.

## Fuera de alcance

- **Reintentar a mitad de un stream.** Una vez emitido el primer `text-delta`, el alumno
  ya está leyendo texto en pantalla: reintentar duplicaría la crítica. El reintento del
  streaming vive **sólo antes del primer byte**. Ver *Riesgos*.
- **Reintentar errores no transitorios** (`400`, `401`, `403`, `404`). Una API key mala no
  mejora esperando.
- **Respetar `RetryInfo` / `Retry-After`.** Google a veces manda un retraso sugerido en el
  cuerpo del error. Leerlo sería mejor que el backoff fijo, pero obliga a parsear un
  formato que no está en el schema `GeminiResponse`. Backoff exponencial con jitter es
  suficiente para un pico de demanda.
- **Circuit breaker, cola de peticiones o rate limiting propio.** Otro problema.
- **Fallback a otro modelo.** Cambiar de modelo a mitad de un panel rompe la comparación
  entre profes y Juez.
- **Reintentar en el bucle del agente** (`harness/session.ts`). El reintento va en el
  proveedor, un nivel por debajo: así lo heredan `generateText`, `generateObject` y
  `streamText` a la vez, sin tocar el bucle.
- **`modelErrorResponse` y su mensaje.** Sigue igual. Si tras los reintentos el modelo
  sigue caído, esa red de seguridad es exactamente lo que queremos que actúe.

## Contratos afectados

**Ninguno en `packages/shared`.** Todo el cambio vive en
`packages/server/src/domain/agents/`. El canal de error público del proveedor sigue siendo
`AiError.AiError`, que es lo que exige `LanguageModel.make`
(`effect/unstable/ai/LanguageModel.ts:748-762`): el error tipado nuevo es **interno** y se
convierte a `AiError` en el borde, cuando la política de reintentos se ha rendido.

Tampoco cambia el contrato NDJSON: la web no se toca en este PR.

---

## Pasos

Ejecuta `pnpm run typecheck` al terminar **cada** paso.

### Paso 0 — Premisas

1. [ ] `git switch fix/solucion-errores && git pull` si procede, y desde ahí
       `git switch -c fix/gemini-reintentos`. **No salgas de `main`.**
2. [ ] `pnpm -r test` y anota el recuento. Referencia medida al escribir este plan, con el
       PR-14 ya implementado en `23a8bf8`: **21 ficheros / 190 tests**
       (server 16/157, web 5/33). Si tu número de partida es otro, usa el tuyo: la regla es
       que no baje.
3. [ ] Comprueba que `grep -rn "Effect.retry\|Schedule\." packages/server/src/` sigue dando
       **0 aciertos**. Si ya hay reintentos, este plan está desfasado: **para y notifica.**
4. [ ] Comprueba que `toAiError` (`gemini.ts:68-73`) sigue con `method: "generateText"`
       hardcodeado.

### Paso 1 — Un error de transporte con su código de estado

Fichero nuevo: `packages/server/src/domain/agents/gemini-retry.ts`.

Va aparte de `gemini.ts` **por la misma razón que `gemini-sse.ts`**: son funciones puras
que se pueden probar sin red ni API key.

1. [ ] El error tipado. `Data` ya está importado en `gemini.ts` (`:1`) y ya se usa para
       `GeminiConfigError`, así que el patrón es el del propio fichero:

   ```ts
   import { Data, Schedule } from "effect";

   /** Fallo de transporte contra la API de Gemini.
    *  `status: null` = la petición nunca llegó a recibir respuesta (DNS, socket, abort). */
   export class GeminiTransportError extends Data.TaggedError("GeminiTransportError")<{
     readonly status: number | null;
     readonly body: string;
   }> {}
   ```

2. [ ] El predicado, **puro y exportado**:

   ```ts
   /** 408 y 429 son de ritmo; 5xx son de servidor. Todos transitorios según Google.
    *  Un 4xx que no sea 408/429 es culpa nuestra: reintentarlo sólo retrasa el error. */
   export const RETRYABLE_STATUSES: readonly number[] = [408, 429, 500, 502, 503, 504];

   export const isRetryableTransportError = (error: GeminiTransportError): boolean =>
     error.status === null || RETRYABLE_STATUSES.includes(error.status);
   ```

3. [ ] La política, en un solo sitio para que las tres llamadas usen la misma:

   ```ts
   /** 3 reintentos sobre el intento inicial. Backoff 500ms → 1s → 2s, con jitter para no
    *  sincronizar los dos profes, que salen a la vez y chocarían con el mismo pico. */
   export const geminiRetryPolicy = {
     while: isRetryableTransportError,
     times: 3,
     schedule: Schedule.jittered(Schedule.exponential("500 millis"))
   } as const;
   ```

   **Verificaciones obligatorias contra el paquete antes de darlo por bueno**
   (`effect@4.0.0-beta.83`, `GUIA-DOER.md` §5 — no asumas la API de v3):
   - `Effect.retry(effect, options)` acepta un objeto con `while`, `times` y `schedule`
     a la vez: `Effect.ts:7025-7029` (`namespace Retry`, `interface Options<E>`).
   - `Schedule.exponential(base, factor = 2)`: `Schedule.ts:3798-3807`.
   - `Schedule.jittered(self)` toma **un solo argumento**: `Schedule.ts:4345-4352`.
   - **Si `times` y `schedule` juntos no hacen lo esperado** (que `times` acote el número
     de repeticiones del `schedule`), cámbialo por
     `Schedule.both(Schedule.exponential("500 millis"), Schedule.recurs(3))`
     (`Schedule.ts:1392`, `:4462`) y **anótalo en el cuerpo del PR**. Lo que no vale es
     dejar una política que reintente indefinidamente.

4. [ ] Tests en `packages/server/src/domain/agents/__tests__/gemini-retry.test.ts`, al
       estilo de `gemini-sse.test.ts`:
   - `isRetryableTransportError` dice **sí** a 429, 500, 502, 503, 504, 408 y a
     `status: null`;
   - dice **no** a 400, 401, 403, 404 y 422;
   - un efecto que falla con `GeminiTransportError({ status: 503 })` dos veces y luego
     acierta, **acaba en éxito** bajo `Effect.retry(…, geminiRetryPolicy)`;
   - un efecto que falla siempre con `status: 401` se ejecuta **una sola vez** (cuenta las
     invocaciones con un contador) y propaga el fallo;
   - un efecto que falla siempre con `status: 503` se ejecuta **exactamente 4 veces**
     (1 inicial + 3 reintentos) y acaba fallando.

   El último es el que impide que alguien suba `times` sin darse cuenta. Usa
   `Effect.runPromise` / `Effect.runPromiseExit` como ya hacen los tests del repo.

### Paso 2 — `toAiError` deja de mentir

Fichero: `packages/server/src/domain/agents/gemini.ts`.

1. [ ] Añade el parámetro **delante**, para que en cada sitio de llamada se lea primero
       cuál es la operación:

   ```ts
   type GeminiMethod = "generateText" | "streamText";

   const toAiError = (method: GeminiMethod, description: string) =>
     AiError.make({
       module: "GeminiLanguageModel",
       method,
       reason: new AiError.UnknownError({ description })
     });
   ```

   El tipo literal, no `string`: así un tercer método futuro no entra sin decidirlo.

2. [ ] Actualiza los **diez** sitios de llamada. Los del camino no streaming
       (`:374`, `:379`, `:439`, `:461`) pasan `"generateText"`; los del streaming
       (`:485`, `:491`, `:493`, `:498`, `:510` y el del `catchCause` final) pasan
       `"streamText"`.

3. [ ] Comprobación: `grep -n 'toAiError(' packages/server/src/domain/agents/gemini.ts`
       — **ninguna** línea puede quedar con un solo argumento. El compilador lo caza, pero
       míralo igual.

### Paso 3 — `callGeminiOnce` reintenta

Fichero: `packages/server/src/domain/agents/gemini.ts`.

1. [ ] Parte la función en dos. La de dentro hace **una** petición y falla con el error
       tipado, conservando el status:

   ```ts
   const fetchGeminiOnce = (url: string, body: unknown): Effect.Effect<unknown, GeminiTransportError> =>
     Effect.tryPromise({
       try: async (signal) => {
         const response = await fetch(url, {
           method: "POST",
           headers: { "content-type": "application/json" },
           body: JSON.stringify(body),
           signal
         });

         if (!response.ok) {
           // El status viaja en el error, no en un string: es lo que decide el reintento.
           throw new GeminiTransportError({ status: response.status, body: await response.text() });
         }

         return response.json();
       },
       catch: (cause) =>
         cause instanceof GeminiTransportError
           ? cause
           : new GeminiTransportError({ status: null, body: cause instanceof Error ? cause.message : String(cause) })
     });
   ```

   **Cuidado con el `catch` de `Effect.tryPromise`**: lo que lanzas dentro del `try`
   también pasa por él. Sin el `instanceof` de la primera rama, el status recién capturado
   se perdería otra vez y todo el paso 1 no serviría de nada. Verifica además que un
   `AbortError` (por la señal) cae en `status: null` y **no** se reintenta en bucle: si el
   `signal` ya está abortado, el reintento vuelve a fallar igual y la política se agota
   sola, pero anota en el PR lo que observaste.

2. [ ] `callGeminiOnce` mantiene **su firma actual**
       (`(url, body) => Effect<GeminiCallResult, AiError.AiError>`) para que
       `generateText` no cambie ni una línea. Por dentro:

   ```ts
   const callGeminiOnce = (url: string, body: unknown): Effect.Effect<GeminiCallResult, AiError.AiError> =>
     Effect.gen(function* () {
       const rawJson = yield* fetchGeminiOnce(url, body).pipe(
         Effect.tapError((error) =>
           isRetryableTransportError(error)
             ? Effect.log("gemini.retry").pipe(
                 Effect.annotateLogs({ method: "generateText", status: error.status, bodyPreview: error.body.slice(0, 200) })
               )
             : Effect.void
         ),
         Effect.retry(geminiRetryPolicy),
         Effect.mapError((error) => toAiError("generateText", error.body))
       );

       // …el resto, decodeGeminiResponse incluido, tal cual está hoy.
     });
   ```

   Verifica el nombre de `Effect.tapError` en v4 beta antes de escribirlo; si no existe,
   `Effect.tapErrorCause` o un `Effect.catchAll` que loguee y re-falle valen igual. Lo que
   importa es que **cada reintento deje rastro**: sin log, "a veces tarda 3 segundos" es
   indepurable.

3. [ ] El `Effect.log("gemini.retry")` sigue la convención de los que ya hay en el fichero
       (`gemini.request`, `gemini.response`, `agent.tool_call_leak`,
       `agent.tool_call_retry`). **No inventes otro formato.**

4. [ ] **No metas el reintento alrededor de `generateText` entero.** `generateText`
       contiene la lógica de reintento por `MALFORMED_FUNCTION_CALL` del PR-12
       (`gemini.ts:443-470`): envolverla multiplicaría los reintentos entre sí (hasta 8
       llamadas por turno) y cambiaría un comportamiento que ya está probado. El reintento
       va **dentro** de `callGeminiOnce`, que es justo el punto por el que pasan las dos
       llamadas de esa lógica.

### Paso 4 — El streaming reintenta, pero sólo antes del primer byte

Fichero: `packages/server/src/domain/agents/gemini.ts`, dentro de `streamText`.

1. [ ] Extrae la apertura de la conexión a un efecto propio, que es **todo lo que se
       reintenta**:

   ```ts
   const openGeminiStream = (url: string, body: unknown): Effect.Effect<globalThis.Response, GeminiTransportError> =>
     Effect.tryPromise({
       try: async (signal) => {
         const response = await fetch(url, {
           method: "POST",
           headers: { "content-type": "application/json" },   // faltaba: ver Problema §4
           body: JSON.stringify(body),
           signal
         });
         if (!response.ok) {
           throw new GeminiTransportError({ status: response.status, body: await response.text() });
         }
         return response;
       },
       catch: (cause) =>
         cause instanceof GeminiTransportError
           ? cause
           : new GeminiTransportError({ status: null, body: cause instanceof Error ? cause.message : String(cause) })
     });
   ```

2. [ ] En `streamText`, sustituye el `fetch` + la comprobación de `!response.ok`
       (`gemini.ts:482-493`) por:

   ```ts
   const response = yield* openGeminiStream(url, requestBody(options)).pipe(
     Effect.tapError(/* mismo log que el paso 3, con method: "streamText" */),
     Effect.retry(geminiRetryPolicy),
     Effect.mapError((error) => toAiError("streamText", error.body))
   );
   ```

3. [ ] **El bucle del lector (`reader.read()`) no se reintenta.** Ni lo envuelvas ni lo
       muevas dentro del efecto reintentable. Si el stream se corta a mitad, el profe
       falla, `Effect.all(…, { mode: "result" })` del motor lo absorbe y el Juez recibe
       *"Not available (failed to generate)."* — que es el comportamiento que ya está
       probado. Reintentar aquí reenviaría desde cero un texto que el alumno **ya está
       leyendo en pantalla** y lo vería duplicarse.

       Deja escrito ese motivo como comentario en el código, justo encima del `while`.

4. [ ] Comprobación: la línea del `fetch` de streaming ya lleva `content-type`, igual que
       la de `callGeminiOnce`.

### Paso 5 — Los 20 segundos del profe ya no dan

Fichero: `packages/server/src/domain/evaluation/engine.ts`.

1. [ ] `TEACHER_TIMEOUT_MS` (`engine.ts:28`) envuelve **el stream entero** de cada profe
       desde el paso 13 del PR-14. Con hasta 3 reintentos, el backoff añade ~3,5 s de
       espera pura antes de que empiece a generar. 20 s se quedan cortos justo en el caso
       que este PR viene a salvar: el pico de demanda.

       Súbelo a `30_000` y deja el porqué en el comentario:

   ```ts
   // 30 s, no 20: desde el PR-15 el timeout cubre también el backoff de los reintentos
   // (hasta ~3,5 s) además de la generación completa del profe.
   const TEACHER_TIMEOUT_MS = 30_000;
   ```

2. [ ] **No toques** el timeout de 30 s de la tool `cli`
       (`harness/harness.ts:76-82`): es de otra cosa y no está en el camino del modelo.

3. [ ] Comprueba que ningún test asume 20 000:
       `grep -rn "20_000\|20000" packages/server/src/`.

### Paso 6 — Tests del cableado

1. [ ] Los tests del paso 1.4 son el grueso y ya cubren la política. Aquí sólo falta que
       lo que existe siga verde: `engine.test.ts` y `review-streaming.test.ts` usan un
       `LanguageModel` falso y **no pasan por `gemini.ts`**, así que no deberían moverse.
       Si alguno se pone rojo, es señal de que el paso 3 o el 4 cambiaron algo más que el
       transporte: **para y notifica.**
2. [ ] `gemini-sse.test.ts` y `gemini-thought-signature.test.ts` no se tocan.
3. [ ] Recuento final `>= 190` y, con los ~5 casos nuevos, del orden de **195**.

### Paso 7 — Documentación

1. [ ] `documentacion/funcionamiento-actual.md` §6 (Gemini): documenta que las tres
       llamadas al proveedor reintentan los transitorios (408/429/5xx) con backoff
       exponencial y jitter, 3 reintentos, y que **el streaming sólo reintenta antes del
       primer byte**. Di también que el bucle del agente (`session.ts`) no reintenta: lo
       hace el proveedor.
2. [ ] `documentacion/contexto-repo.md`, si tiene una sección de trampas: el `catch` de
       `Effect.tryPromise` traga también lo que lanzas dentro del `try`, así que un error
       tipado lanzado ahí hay que dejarlo pasar con un `instanceof` explícito. Esa es la
       trampa que se paga cara en este PR.
3. [ ] `planes/GUIA-DOER.md` §3: fila del PR-15 en la tabla, y actualiza la cifra de
       referencia de tests.
4. [ ] `docs/testing.md`: cómo se prueba a mano un 503 (paso 4 de la QA).

---

## Criterio de aceptación

1. [ ] Un `503` transitorio de Google **no** llega al alumno: la llamada se reintenta y el
       turno termina normal.
2. [ ] Un `503` permanente (el modelo sigue caído tras 4 intentos) sí llega, con el mensaje
       de `modelErrorResponse` de siempre. La red de seguridad no se ha roto.
3. [ ] Un `401` (API key inválida) **no se reintenta**: falla al primer intento, sin
       esperas. Se nota en que el error aparece al instante, no tres segundos después.
4. [ ] Un error durante el streaming de un profe se reporta como
       `GeminiLanguageModel.streamText`, y uno del chat o del Juez como
       `GeminiLanguageModel.generateText`. Nunca al revés.
5. [ ] Cada reintento deja una línea `gemini.retry` en el log con `method` y `status`.
6. [ ] Si el stream de un profe se corta **a mitad**, el texto ya pintado en la UI **no se
       duplica**: ese profe cuenta como fallido y el panel sigue con el otro y el Juez.
7. [ ] El panel completo sigue funcionando end-to-end: `panel:check` en verde en los dos
       modos.
8. [ ] El recuento de `pnpm -r test` no baja de 190.

## Checks

```bash
pnpm run typecheck
pnpm -r test                                   # >= 190
pnpm --filter @proxus/web run build            # la web no se toca, pero el gate es el gate

# el reintento existe y está donde tiene que estar
grep -rn "Effect.retry" packages/server/src/   # 2 aciertos: callGeminiOnce y openGeminiStream
grep -n "toAiError(" packages/server/src/domain/agents/gemini.ts   # ninguna con 1 argumento
```

Con API key:

```bash
pnpm --filter @proxus/server run panel:check "el método get" "get" <materialId> <page>
pnpm --filter @proxus/server run panel:check "el método get" "get" - - ungrounded
pnpm --filter @proxus/server run structured-output:check
```

Si no hay API key, `docs/testing.md` obliga a **decirlo explícitamente** en el cuerpo del
PR. No lo des por probado.

## QA manual

El 503 no se puede pedir a voluntad, así que se provoca.

1. Con `pnpm run dev` y todo bien: usa el chat y corrige un test con respuestas cortas.
   Nada ha cambiado, y en el log no aparece ni un `gemini.retry`.
2. **API key inválida.** Cambia `GOOGLE_GENERATIVE_AI_API_KEY` por basura y reinicia.
   Manda un mensaje al tutor → el error aparece **inmediato**, no tras varios segundos, y
   no hay líneas `gemini.retry`. Esto prueba que el 4xx no se reintenta.
3. **Transitorio simulado.** La forma barata sin tocar código de producción: apunta
   `geminiUrl`/`geminiStreamUrl` a un servidor local de un solo fichero que devuelva `503`
   las dos primeras veces y luego haga de proxy —o directamente que devuelva `503`
   siempre— y comprueba en el log las **tres** líneas `gemini.retry` con sus esperas
   crecientes. **Revierte ese cambio antes de commitear**; `git status` tiene que quedar
   limpio de él.
4. **Corte a mitad de stream.** Con el mismo servidor local, corta la conexión después de
   haber mandado unos cuantos eventos SSE. En la UI: el texto del profe se queda a medias,
   **no vuelve a empezar desde el principio**, y la corrección termina igualmente con la
   nota determinista. Éste es el criterio nº 6 y es el que de verdad justifica el diseño
   del paso 4.
5. Comprueba que en los logs de los pasos 3 y 4 el campo `method` dice `streamText` cuando
   era un profe, y `generateText` cuando era el chat.

## Riesgos y decisiones

- **Reintentar añade latencia justo cuando ya va lento.** Un pico de demanda con tres
  reintentos suma ~3,5 s de espera pura. Se asume: el alumno prefiere esperar tres
  segundos a perder la respuesta. Por eso el jitter —los dos profes salen a la vez y sin
  él chocarían sincronizados contra el mismo pico— y por eso el tope es 3 y no más.
- **El `catch` de `Effect.tryPromise` es la trampa del PR.** Traga también lo que lanzas
  dentro del `try`, así que sin el `instanceof GeminiTransportError` explícito el status
  se vuelve a perder y el reintento pasa a ser a ciegas, **sin que nada se ponga rojo**.
  Está señalado en el paso 3.1 y merece una segunda lectura al revisar.
- **No reintentar a mitad de stream es una decisión, no una limitación.** Técnicamente se
  podría reabrir la conexión; lo que no se puede es deshacer el texto que el alumno ya
  leyó. Un profe a medias es honesto; un profe que se reescribe solo, no.
- **El timeout sube de 20 s a 30 s** y eso alarga el peor caso de una corrección. Es
  consecuencia directa de meter backoff dentro de la ventana del profe. La alternativa
  —dejar 20 s— haría que el reintento se comiera su propio margen y el profe muriese por
  timeout justo en el caso que este PR quiere salvar.
- **`gemini.ts` es el fichero más delicado del repo.** Mitigación: la lógica de decisión
  del PR-12 (fuga de tool calls, `mode:ANY`, `thoughtSignature`) **no se toca**; el
  reintento se mete por debajo, en el transporte, y `callGeminiOnce` conserva su firma
  exacta para que `generateText` no cambie ni una línea.
- **Los 5xx podrían no ser todos transitorios.** Un `500` persistente por un cuerpo mal
  formado se reintentaría tres veces en balde. Se asume: cuesta 3,5 s y el log lo deja
  visible, mientras que no reintentar los 5xx dejaría fuera precisamente el 503 del
  incidente.
- **`RetryInfo` de Google se ignora.** Ver *Fuera de alcance*. Si los reintentos resultan
  insuficientes en uso real, leer ese campo es la siguiente mejora, no subir `times`.

## Historial

_(Vacío. Lo rellena el thinker si el doer reporta que algo de este plan no cuadra con el
código.)_
