# Dificultades y decisiones técnicas

Registro de obstáculos encontrados durante la implementación, con síntoma, causa, solución adoptada y alternativas descartadas.

---

## PR-1.5 — Sistema visual: tokens, tipografía y repintado

### Guard inicial devolvía 87, no ~145

**Síntoma**: el grep de colores literales antes del PR daba 87 coincidencias, no ~145 como estimaba el plan.

**Causa**: el plan se escribió a partir de un conteo manual del canvas; el grep real cuenta matches distintos (una clase puede repetirse en la misma línea, o no ser la única clase en un atributo `className`).

**Solución**: el objetivo relevante es 0 al final, no el valor inicial. Se anotó la discrepancia y se continuó.

**Descartado**: ajustar el grep para coincidir con el plan (no aporta valor; el guard en 0 es el criterio real).

---

### Sintaxis `@theme` en Tailwind 4.3.1

**Síntoma**: riesgo documentado en el plan — los tokens `--text-*` podrían no generar utilidades de interlineado en 4.3.1.

**Causa**: Tailwind v4 tiene soporte progresivo de algunos tokens; `--text-<n>--line-height` puede variar entre betas.

**Solución**: se definieron solo los tamaños (`--text-micro: 11px`, etc.) y el interlineado se aplicó inline con `style={{ lineHeight: 1.7 }}` donde era necesario. El build compiló sin errores.

**Descartado**: usar clases `leading-*` de Tailwind (habrían introducido valores no acordados con el canvas).

---

### Tokens con `rgba()` y opacidad de Tailwind

**Síntoma**: los tokens de color semitransparente (`--color-brand-tint: rgba(131,79,240,.12)`) podrían comportarse de forma inesperada con el sufijo de opacidad de Tailwind (p.ej. `bg-brand-tint/50`).

**Causa**: cuando el token ya lleva alfa, Tailwind no puede componer la opacidad correctamente.

**Solución**: regla fija — los tokens con alfa se usan tal cual, sin sufijo de opacidad. Documentado en el design system.

**Descartado**: usar tokens opacos + sufijo (habría requerido doblar tokens o aceptar valores no canónicos del canvas).

---

### Carga de Geist desde Google Fonts

**Síntoma**: la carga de fuentes es una dependencia de red; sin conexión, la app cae al fallback del sistema.

**Causa**: el canvas carga Geist desde Google Fonts y este PR lo replica.

**Solución**: Google Fonts con `display=swap`, fallback declarado (`ui-sans-serif, system-ui, sans-serif`). Sin red, la UI funciona pero se ve distinta métricamente.

**Descartado**: autoalojar con `@fontsource/geist` (añade dependencia y peso al bundle; sin requisito de offline no se justifica).

---

### Contraste de textos pequeños (pendiente de QA visual)

**Síntoma**: `ink-faint` (`#5F5975`) sobre `surface-raised` (`#F5F2FC`) a 11px podría no llegar a 4.5:1 (WCAG AA para texto pequeño).

**Causa**: los tonos del canvas están optimizados visualmente, no validados contra WCAG.

**Solución pendiente**: verificar con DevTools o una herramienta de contraste tras levantar la app. Si no llega a 4.5:1, se notifica al thinker para ajustar el token (no se cambia por cuenta propia).

**Descartado**: bajar el umbral a 3:1 (WCAG AA para texto grande) sin confirmar con producto.

---

## PR-12 — Fuga de sintaxis de tool call como texto

### `Effect.timeoutTo` no existe en 4.0.0-beta.83

**Síntoma**: el plan referenciaba `Effect.timeoutTo`; TypeScript no lo encontraba.

**Causa**: en v4 beta el API es `Effect.timeoutOrElse` (con `orElse: () => Effect<A2>`). No hay función `timeoutTo`.

**Solución**: `Effect.timeoutOrElse({ duration, orElse: () => Effect.succeed(fallbackString) })`.

**Descartado**: `Effect.timeout` (falla con `TimeoutException`, no devuelve un fallback).

---

### `Response.makePart` devuelve `Part` (decoded) pero `LanguageModel.make` espera `PartEncoded`

**Síntoma**: la función `generateText` en `LanguageModel.make` espera `Array<Response.PartEncoded>`, pero `makePart` devuelve tipos decoded (`TextPart`, `ToolCallPart`, etc.).

**Causa**: en v4 beta los tipos decoded y encoded son estructuralmente compatibles (el decoded añade `PartTypeId` simbólico que no bloquea la asignación estructural). El código original pasaba el typecheck sin cast.

**Solución**: en el nuevo código (donde el tipo se hace explícito a través de `ResponsePartsResult`), se usa `as unknown as Response.PartEncoded` para no perder tiempo en un problema de tipos no observable en runtime.

**Descartado**: cambiar la interfaz `ResponsePartsResult.parts` a `AnyPart[]` (más ruidoso en tipos downstream).

---

### `promptContents` necesita sincronía con `renderMessage` (deuda PR-12 Opción A)

**Síntoma**: las dos regex `TOOL_CALL_RE` / `TOOL_RESULT_RE` en `gemini.ts:promptContents` reconocen el formato que produce `renderMessage` en `session.ts`. Si uno cambia sin el otro, el historial deja de traducirse a partes nativas.

**Causa**: la Opción A del plan es un parche local. La solución correcta (Opción B) exige cambiar `AgentMessage` y el contrato NDJSON; se postergó al PR-05.

**Solución**: comentario en el código señalando la dependencia. El doer la ha marcado como deuda.

**Descartado**: implementar la Opción B en este PR (4 sitios afectados + cambio de contrato de streaming).

---

### `yield* Effect.fail(new TaggedError(...))` lint error TS29 en poppler

**Síntoma**: el compilador (regla TS29 de Effect) rechaza `yield* Effect.fail(new PdfServiceError(...))`.

**Causa**: `TaggedError` implementa la interfaz `Yieldable`, así que `yield* new PdfServiceError(...)` es la forma correcta en v4.

**Solución**: `return yield* new PdfServiceError({ reason: ... })`.

**Descartado**: `throw new PdfServiceError(...)` (no es una operación de Effect y rompe el tipo de retorno).

---

## PR-12.1 — La fuga sigue: señal fiable y reintento acotado

### El patrón de detección del PR-12 no casaba con la cadena real

**Síntoma**: el log del 7-sep 22:29 mostró `textPreview: 'Tool call load_skill: ...'` pasando sin ser detectado por `buildLeakPattern`. El bug seguía vivo.

**Causa**: el patrón `\bload_skill\b\s*[({]` exige `(` o `{` inmediatamente tras el nombre. En el texto real hay `: ` entre el nombre y los argumentos. Error de diseño en el plan PR-12, implementado sin verificación.

**Solución**: patrón de dos formas (a) nuestro formato de historial `Tool call <name>:` y (b) forma narrada `default_api:load_skill{`. Validado contra 5 cadenas de prueba con un node one-liner antes de commitear.

**Descartado**: añadir más alternativas sin probarlas primero.

---

## PR-12.2 — Eliminar la causa: partes estructuradas en el contrato

### El arreglo estructural se aplazó dos veces por un coste que nunca se verificó

**Síntoma**: el PR-12 y el PR-12.1 aplazaron el cambio a partes nativas de tool call asumiendo que exigía tocar `AgentMessage`, `packages/shared` y el contrato NDJSON.

**Causa**: la suposición era falsa. `Prompt.ToolCallPartEncoded` (`Prompt.ts:543`), `Prompt.ToolResultPartEncoded` (`:660`) y el rol `"tool"` (`:1584`) ya existen en `effect@4.0.0-beta.83`. El cambio es local a `packages/server`.

**Solución**: `renderPrompt` emite partes estructuradas directamente; `promptContents` las consume sin regex. Eliminados `TOOL_CALL_RE`, `TOOL_RESULT_RE` y `buildLeakPattern`. Verificado con `pnpm run typecheck` sin tocar `packages/shared` ni `packages/web`.

**Descartado**: aplazar de nuevo a PR-05 (ya no hay razón para ello).

---

### Caso multimodal necesita dos mensajes, no uno

**Síntoma**: `ToolMessageEncoded` solo admite partes `tool-result` y `tool-approval-response` — no partes `file`. El caso de MaterialPageImages emitía un mensaje de usuario con imágenes, que no cabe en ese rol.

**Causa**: la API de Gemini recibe imágenes en mensajes de usuario, no en mensajes de función.

**Solución**: cuando el resultado es `MaterialPageImages`, se emiten dos mensajes: (1) mensaje `tool` con resultado textual corto y (2) mensaje `user` con las imágenes. El id de la tool call es compartido por ambos. La QA manual del caso "resume la página 1" verifica que las imágenes siguen llegando.

**Descartado**: emitir solo el mensaje de usuario con imágenes (pierde la correlación tool-call/tool-result en el historial de Effect).

---

### Gemini 2.5 Flash exige `thoughtSignature` en partes `functionCall` del historial

**Síntoma**: tras implementar PR-12.2, el segundo turno con tool calls devuelve HTTP 400 `INVALID_ARGUMENT`: *"Function call is missing a thought_signature in functionCall parts… function call `default_api:load_skill`, position 2."*

**Causa**: Gemini 2.5 Flash es un modelo de pensamiento (*thinking model*). Cada parte `functionCall` en la respuesta incluye un campo `thoughtSignature` (base64). Cuando esa función aparece de nuevo en el historial de la siguiente petición, la API exige que la `thoughtSignature` original esté presente. PR-12.2 envía partes nativas `functionCall` en el historial, pero la signature se perdía: `session.ts` construía `AgentMessage.toolCall(name, params)` descartando el `id` que la contenía, y `renderPrompt` sintetizaba `call_0` sin ninguna signature.

**Solución** (ebc3a69):
1. Añadir `id?: string` a `ToolCallMessage` en `message.ts`.
2. Pasar `toolCall.id` al construir el mensaje: `AgentMessage.toolCall(name, params, toolCall.id)`.
3. En `renderPrompt`, usar `message.id ?? \`call_${callIndex}\`` como id de la parte estructurada.
4. Exportar `encodeToolCallId` y `decodeThoughtSignature` en `gemini.ts` y usarlas en `toResponseParts` (encode) y `messageParts` (decode) respectivamente.
5. El id viaja como `call_uuid||base64sig`: el `||` separa el uuid de la signature; `messageParts` lo decodifica y lo inyecta en el campo `thoughtSignature` de la parte `functionCall` enviada a Gemini.

**Descartado**: eliminar las partes nativas y volver a texto (deshace la causa raíz de PR-12); parchear los tipos internos de Effect para añadir un campo `thoughtSignature` explícito (invasivo y frágil con el beta).

---

### La corrección del PR-12 llegaba al alumno en vez de al modelo

**Síntoma**: cuando se detectaba la fuga, `toResponseParts` devolvía un texto de corrección como parte del response. Ese texto se emitía como respuesta del asistente al alumno. El modelo nunca lo veía.

**Causa**: la corrección estaba en `responseParts`, que `session.ts` emite directamente cuando no hay tool results. El diseño del PR-12 asumía que ese texto volvería al modelo en el siguiente turno, pero el turno ya terminaba.

**Solución**: PR-12.1 extrae la lógica en `callGeminiOnce` y hace UN reintento interno dentro del adaptador cuando detecta un paso malformado. El mensaje correctivo va como turno extra en `contents` (invisible al historial del chat). Si el reintento recupera → devuelve la respuesta correcta. Si no → frase legible para el usuario.

**Descartado**: hacer el reintento desde `session.ts` (consumiría un paso de `maxSteps` y sería visible en el historial).

---

## PR-13 — Borrar materiales, cerrar artefactos y renombrar

### `Effect.orDie` tras `catchTag` convierte el error tipado en defecto (500)

**Síntoma**: `DELETE /api/materials/no-existe` devolvía HTTP 500 en lugar del 404 tipado declarado en el schema del endpoint.

**Causa**: la cadena `Effect.catchTag("MaterialNotFound", e => Effect.fail({...})).pipe(Effect.orDie)` parece correcta, pero `Effect.orDie` convierte **todos** los errores del canal en defectos — incluido el `Effect.fail` re-emitido por el propio `catchTag`. El `HttpApiBuilder` nunca ve el error tipado: ya llegó como defecto.

**Solución**: sustituir `Effect.orDie` final por `Effect.catchTag("MaterialRepositoryError", e => Effect.die(e))`. Así solo los errores de infraestructura mueren; el error tipado `MaterialNotFound` permanece en el canal y el framework lo serializa como 404.

**Descartado**: `Effect.catchTag("MaterialRepositoryError", Effect.orDie)` — `orDie` no es una función de un argumento válida para `catchTag`; hay que usar `e => Effect.die(e)`.

---

### `exactOptionalPropertyTypes` prohíbe pasar una prop opcional con valor `undefined`

**Síntoma**: TS2375 al pasar `onClose={onClose}` a `ArtifactDetail` cuando `onClose` es `(() => void) | undefined`.

**Causa**: con `exactOptionalPropertyTypes: true` (activo en `tsconfig.json`), el tipo de `{ onClose?: () => void }` NO incluye `undefined` como valor asignable a `onClose`: la prop puede **estar ausente** pero no puede estar **presente con valor `undefined`**. TypeScript los distingue.

**Solución**: renderizar condicionalmente según el valor:
```tsx
onClose !== undefined
  ? <ArtifactDetail onClose={onClose} ... />
  : <ArtifactDetail ... />
```

**Descartado**: cambiar el tipo a `onClose?: (() => void) | undefined` (habría requerido marcar `exactOptionalPropertyTypes` como excepción y rompería la semántica de la flag).

---

---

## PR-10 — Ciclo de vida del input del chat

### `AbortError` se pintaba como mensaje de error rojo

**Síntoma**: al pulsar *Stop*, el textarea recuperaba el texto (correcto) pero también aparecía un mensaje de error rojo en la interfaz.

**Causa**: el bloque `catch` del hook hacía `setError(cause.message)` sin filtrar el caso de aborto. `fetch` con una señal abortada rechaza con `DOMException{name:"AbortError"}`; eso no es un error del sistema sino una acción voluntaria del usuario.

**Solución**: exportar `isAbortError` en `stream.ts` y usarlo en el `catch`:
```ts
if (!isAbortError(cause)) setError(cause instanceof Error ? cause.message : "...");
```

**Descartado**: comparar el mensaje de string (`"The user aborted a request."`), que varía por navegador.

---

### `event.nativeEvent.isComposing` impide entrada en japonés/chino y teclados con acentos muertos

**Síntoma**: sin el guard de `isComposing`, pulsar `Enter` durante la composición IME (p.ej. seleccionar un kanji) enviaba el mensaje incompleto.

**Causa**: el evento `keydown` de `Enter` se dispara durante la composición para confirmar el carácter, no para enviar el formulario. Sin el guard, el handler lo interpreta como envío.

**Solución**:
```ts
if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { ... }
```

**Descartado**: escuchar solo `compositionend` (complica el manejo general del teclado).

---

### `reader.cancel()` faltaba → socket colgado tras `break` o excepción del consumidor

**Síntoma**: al abortar el fetch (botón *Stop*), el `ReadableStream` interno del body seguía abierto y la conexión TCP no se cerraba inmediatamente.

**Causa**: el generador `streamTutorMessage` tenía el bucle `while(true)` sin `finally`. Cuando el consumidor sale del `for await` (por un `break` o por lanzar), el runtime cierra el generador pero no el reader subyacente.

**Solución**: envolver el bucle en `try { ... } finally { await reader.cancel().catch(() => {}); }`. El `.catch(() => {})` silencia el error si el reader ya estaba cerrado.

**Descartado**: no hacer nada (las conexiones se agotan eventualmente, pero supone un leak bajo carga).

---

### Restaurar el historial parcial al fallar a mitad de stream

**Síntoma**: si el stream muere a mitad (red cortada, server caído tras el primer frame), en `messages` quedaban un `user`, quizá un `tool-call` y un `tool-result` huérfanos. Reintentar con ese historial le mandaba al modelo una conversación mutilada.

**Causa**: el hook acumulaba mensajes en el estado de forma incremental. Un fallo no deshacía los mensajes parciales que ya habían llegado.

**Solución**: en el `catch`, restaurar al historial previo al envío:
```ts
setMessages(history);  // history capturado antes del run
setInput(prompt);      // devolver también el texto
```
El usuario pierde la vista parcial del stream, pero el modelo recibirá un historial coherente en el reintento.

**Descartado**: dejar los mensajes parciales (manda un historial con tool calls sin cerrar al modelo, que puede generar respuestas incoherentes).

---

### `signal: AbortSignal | undefined` no asignable a `RequestInit.signal: AbortSignal | null`

**Síntoma**: TS2769 al pasar `signal: options?.signal` a `fetch` — `RequestInit.signal` admite `AbortSignal | null`, no `AbortSignal | undefined`, y `exactOptionalPropertyTypes` prohíbe el paso de `undefined` explícito.

**Causa**: `exactOptionalPropertyTypes: true` distingue "propiedad ausente" de "propiedad presente con valor `undefined`". La firma de `fetch` usa `null` como sentinel de ausencia de señal, no `undefined`.

**Solución**: conditional spread:
```ts
...(options?.signal !== undefined ? { signal: options.signal } : {})
```

**Descartado**: cambiar el tipo de `StreamOptions.signal` a `AbortSignal | null` (interfaz más difícil de usar desde el callsite).

---

### Rate limit de 20 peticiones/día (free tier) bloquea el QA del agente

**Síntoma**: tras varios runs de debug y QA, el agente devuelve 429 `RESOURCE_EXHAUSTED`: *"Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash"*.

**Causa**: el tier gratuito de Gemini impone 20 peticiones por día por proyecto por modelo. Una conversación de agente con 3 pasos usa 3 peticiones; 5 runs de QA = ~15; los runs de debug anteriores habían agotado el resto.

**Solución**: esperar al reseteo diario (medianoche UTC). No hay solución técnica sin cambiar de plan. El QA del agente (PR-12.2 + thoughtSignature) se ejecuta al día siguiente.

**Descartado**: cambiar el modelo mid-session para usar el cupo de otro modelo (cambia el comportamiento y no es QA del cambio implementado).

---

## PR-11 — Cortocircuito de herramientas y latencia percibida

### El harness se construía una vez en el layer, haciendo el prompt estático

**Síntoma**: el inventario de materiales en el prompt no reflejaba PDFs subidos durante la sesión; era el listado del momento de arranque del servidor. Además, si no había materiales al arrancar, el agente nunca lo sabía sin gastar un round-trip.

**Causa**: `TutorChatServiceLive` era un `Layer.effect` que construía `makeAcademicTutorHarness` **una sola vez** al crear el layer. El sistema prompt (el campo `name` de `AgentHarness.make`) era una cadena estática capturada en ese momento.

**Solución**: mover la construcción del harness y la sesión a un helper `makeSession` ejecutado por petición dentro de `sendMessage` y `streamMessage`. Cada petición llama a `materialRepository.list()` (con `Effect.orElseSucceed(() => [])` para que un fallo de disco no tumbe el chat) y construye el prompt con el inventario fresco.

**Descartado**: inyectar el inventario como header HTTP o como primer mensaje del usuario (viola el contrato `TutorChatRequest`).

---

### `Stream.unwrap` disponible en effect@4.0.0-beta.83

**Síntoma**: el plan señalaba que había que verificar si `Stream.unwrap` existía antes de usarlo.

**Causa**: el plan asumía incertidumbre sobre la API de Effect v4 beta.

**Solución**: verificado con grep en `node_modules/.pnpm/effect@4.0.0-beta.83/.../Stream.js`: `export const unwrap = effect => fromChannel(Channel.unwrap(...))` existe. Se usa en `streamMessage` para desplegar el `Effect<Stream<...>>` que devuelve `makeSession`.

**Descartado**: `Stream.flatMap(Stream.fromEffect(makeSession), ...)` (más verboso, innecesario).

---

### `makeAcademicTutorHarness` en eval necesitaba el tercer parámetro

**Síntoma**: `artifact-authoring.eval.ts:411` generaba TS2554 ("Expected 3 arguments, but got 2") tras añadir `materialsContext` a la firma.

**Causa**: el eval construye el harness directamente con repositorios en memoria y no pasa por `TutorChatService`.

**Solución**: pasar `"No PDF materials have been uploaded yet."` como tercer argumento en el eval. El eval no sube PDFs, así que el inventario vacío es correcto.

**Descartado**: hacer `materialsContext` opcional con valor por defecto (habría enmascarado otros callsites olvidados).

---

## Testing automático — PR-10 y PR-11 (sesión 8-sep-2026)

### `packages/web` no tenía test runner; se añadió vitest de forma mínima

**Síntoma**: `isAbortError` (PR-10) era una función pura exportable pero no había forma de ejecutar tests en el paquete web.

**Causa**: el setup inicial del repo no instaló vitest en `packages/web` porque no había nada que testear. El PR-13 instaló vitest solo en `packages/server`.

**Solución**: añadir `vitest@^5.0.0` a `devDependencies` de `packages/web`, un `vitest.config.ts` mínimo (`environment: "node"`) y los scripts `test`/`test:watch`. Los tests de componentes React (que necesitan `@testing-library/react` y un DOM) se dejan para cuando haya cobertura de presentación. Solo se testean funciones puras.

**Descartado**: mover `isAbortError` al paquete `packages/server` o `packages/shared` para aprovechar el runner ya existente (rompe la cohesión: la función vive donde se usa).

---

### Inline helper `makeSession` bloqueaba el test de `buildMaterialsContext`

**Síntoma**: el builder del inventario era un bloque de código dentro del cuerpo de un `Effect.gen`, sin nombre ni export. Imposible de testear sin montar un `Layer` con mocks.

**Causa**: la lógica fue escrita inline para no añadir exports innecesarios en PR-11. Correcto para producción, pero opaco para tests.

**Solución**: extraer la lógica a `export const buildMaterialsContext = (materials: ReadonlyArray<...>): string => ...` justo antes de `TutorChatServiceLive`. Es una función pura de datos; el export no expone estado ni efectos.

**Descartado**: testear vía `Layer` con repositorio en memoria (mucho más código de test para el mismo grado de confianza sobre una transformación de strings).

---

## Fix post-PR-13 — Uploader de PDF desapareció del sidebar

### `PdfUploader` y `upload.ts` eliminados accidentalmente en la reescritura del PR-13

**Síntoma**: con al menos un PDF ya subido, no había forma de subir otro: el uploader no aparecía en ninguna parte del sidebar.

**Causa**: el PR-13 reescribió `Sidebar.tsx` desde cero para añadir `MaterialRow` con borrado inline. La nueva versión no importaba `PdfUploader` ni la acción `uploadMaterial` de `upload.ts`, que habían quedado fuera del alcance visible al redactar el PR. El componente y la acción seguían existiendo en disco pero sin ningún callsite.

**Solución** (95e1ef6): restaurar las importaciones de `PdfUploader` y `upload.ts` y añadir `<PdfUploader onUploaded={refreshMaterials} />` siempre visible al final de la sección de materiales, independientemente de si ya hay PDFs o no.

**Descartado**: mostrar el uploader solo cuando la lista está vacía (reproduce el bug en cuanto el primer PDF es subido).

---

## PR-14 — Subida de PDFs y parada real del chat

### El botón `Stop` no detenía nada, según el usuario

**Síntoma**: al pulsar `Stop` durante una respuesta, "el razonamiento no se detiene".

**Causa**: no era lo que parecía. El servidor **sí** cancela. Medido con un servidor
aislado en `:3010`, cortando el cliente a los 7 s: el `http.span` cierra en ese instante,
la llamada a Gemini en vuelo se queda sin `gemini.response` y no se registra un
`agent.step` más. Idéntico por la ruta directa (7135 ms) y a través del proxy de Vite
(6810 ms). La cadena estaba bien desde el principio: `NodeHttpServer.ts:195-197` interrumpe
el fiber cuando la conexión se cierra antes de tiempo, `Stream.callback`
(`harness/session.ts:51`) ata el bucle del agente al scope del stream, y `gemini.ts:335-341`
pasa el `signal` al `fetch`.

El fallo real estaba en el cliente, en `use-tutor-chat.ts`: el `catch` trataba **fallo** y
**parada voluntaria** como el mismo caso. Solo el mensaje de error se distinguía con
`isAbortError`; el rollback (`setMessages(history)` + `setInput(prompt)`) se aplicaba a los
dos. Al pulsar `Stop` desaparecían los mensajes del turno y el prompt volvía al textarea:
el chat quedaba como si nunca se hubiera enviado nada, que es exactamente lo que se lee
como "no ha parado".

**Solución**: extraer la decisión a `resolveStreamFailure` (`domain/tutor/stream.ts`),
función pura que devuelve `{ keepMessages, restoreInput, showError }`. Una parada conserva
los mensajes, deja el textarea vacío y no ofrece `Retry`; un fallo mantiene el
comportamiento anterior. El turno detenido se marca con una línea *"Stopped"*.

**Nota**: la afirmación previa de `funcionamiento-actual.md` de que cancelar el fiber del
servidor "no está verificado en `4.0.0-beta.83`" era incorrecta. Queda verificada.

### Un `throw` dentro de `Effect.map` hacía imposible el 400

**Síntoma**: subir un fichero que no es PDF devolvía 500, no el 400 tipado previsto.

**Causa**: `poppler-pdf-service.ts` lanzaba `throw new Error(...)` dentro de `Effect.map`
cuando `pdfinfo` no imprimía la línea `Pages:`. Un `throw` ahí produce un **defect**, no un
fallo tipado, así que ni el `Effect.mapError` de la línea siguiente ni el del repositorio
podían convertirlo: se propagaba como defecto hasta el 500.

**Solución**: `Effect.flatMap` + `Effect.fail(new PdfServiceError(...))`. Efecto colateral
útil: un PDF corrupto ya presente en el directorio también pasa a ser error tipado en
`list`, en vez de un defecto.

### El multipart bufferizado escribe el temporal con el nombre del cliente

**Síntoma**: subir `Tema 1: variables.pdf` o `Que es?.pdf` devolvía 500. Con espacios o
acentos, 200. El error salía de sitios distintos según el carácter: `?` moría en
`NodeMultipart.ts:72` con `MultipartError`, `:` llegaba hasta el repositorio (en NTFS los
dos puntos abren un *alternate data stream*, así que la escritura no falla, produce algo
que no es el fichero esperado).

**Causa**: `HttpApiSchema.asMultipart` persiste cada fichero en un temporal **nombrado con
el nombre original del cliente**. Nuestro saneado vivía en el repositorio, es decir después
de esa escritura: llegaba tarde. En Windows, `: ? * " < > |` no son válidos en un nombre de
fichero.

**Intento descartado**: capturar `MultipartError` en el handler. No es posible — el payload
se decodifica antes de que el handler corra, y ese error no está en su canal de error. El
typecheck lo rechaza (`"MultipartError" is not assignable to "InvalidPdf"`).

**Solución**: `HttpApiSchema.asMultipartStream` y un módulo de transporte
(`transport/http/upload.ts`) que recorre las partes, escribe la primera parte de fichero en
un temporal **con nombre elegido por el servidor** (`upload.pdf` dentro de un directorio
propio) y borra ese directorio con `Effect.ensuring` pase lo que pase. El nombre del cliente
ya no toca el sistema de ficheros: solo se usa, saneado, para decidir el nombre final. De
paso, dos casos que antes eran 500 pasan a ser 400 con mensaje: petición sin fichero y
fichero por encima del límite.

### Validar el PDF antes de moverlo, no después

**Síntoma**: ninguno todavía; es un fallo que se evitó por diseño.

**Causa**: `listFiles()` ejecuta `pdfinfo` sobre **todos** los `.pdf` del directorio en cada
`list`, `get` y `renderPages`. Un solo fichero ilegible ahí dentro hace fallar el
`Effect.forEach` entero, y el handler `list` termina en `Effect.orDie`: 500 y sidebar vacía.
Un fichero malo rompe el catálogo completo, no solo su propia entrada.

**Solución**: `save` valida con `pdfinfo` sobre el temporal y solo mueve el fichero al
directorio de materiales si esa validación pasa. La verificación incluye un check explícito
de que `GET /api/materials/` sigue devolviendo 200 después de un upload rechazado.
