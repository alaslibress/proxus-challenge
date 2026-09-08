# PR-10 — Ciclo de vida del input del chat

- **Rama**: `fix/chat-input-lifecycle`
- **Depende de**: PR-01. Es independiente del PR-09, pero se implementa después.
- **Orden de ejecución**: después del PR-09 y **antes del PR-02**.
- **Conflicto conocido**: **sí, con el PR-05.** El PR-05 §Paso 6 toca `Chat.tsx` y
  `domain/tutor/stream.ts` para hacer el decodificador NDJSON resiliente. Este PR
  reescribe los dos ficheros. **Se implementa antes que el PR-05**, y el thinker
  actualizará el Paso 6 del PR-05 sobre el resultado. No van en paralelo.
- **Bloquea a**: PR-05 y PR-07 sólo en el sentido de orden, no de contenido.
- **Estado**: borrador
- **Contiene LLM**: no. No añade ni cambia prompts.
- **Origen**: hallazgo de usabilidad. No sale de los ADR.

> Normas de trabajo en [`../plan.md`](../plan.md). Contexto técnico obligatorio en
> [`../../documentacion/contexto-repo.md`](../../documentacion/contexto-repo.md) y
> [`../../documentacion/funcionamiento-actual.md`](../../documentacion/funcionamiento-actual.md).
> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.

---

## Problema

Los tres síntomas reportados son el mismo bug: **el input no tiene ciclo de vida**, tiene
un `setInput("")` mal colocado.

`packages/web/src/components/Chat.tsx:26-70`, la función `submit`:

```tsx
      for await (const event of streamTutorMessage({ input: trimmed, messages, maxSteps: 8 })) {
        ...
      }

      setInput("");            // ← línea 64
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSending(false);
    }
```

De ahí salen los tres:

1. **El textarea no se vacía al enviar.** `setInput("")` está en la línea 64, *después*
   del `for await` completo. Mientras el agente razona —que son varios round-trips a
   Gemini, ver PR-11— el texto enviado sigue ahí.
2. **Se puede seguir editando durante la generación.** El `<textarea>`
   (`Chat.tsx:123-129`) tiene exactamente cinco props: `className`, `value`, `onChange`,
   `placeholder`, `rows`. **No tiene `disabled`.** El único bloqueo es el del botón
   (`:133`, `disabled={isSending || input.trim().length === 0}`), así que se puede escribir
   pero no enviar: se pierde lo escrito cuando por fin se limpia.
3. **Se vacía al terminar.** Que es justo el momento en que el usuario ya ha reescrito
   otra cosa.

Y dos más que salen del mismo sitio y hay que arreglar a la vez:

4. **No se puede cancelar.** `domain/tutor/stream.ts:10-16` llama a `fetch` sin `signal`;
   no hay ni un `AbortController` en todo `packages/web`. Con el harness en `maxSteps: 8`
   (`Chat.tsx:40`), una petición desbocada se aguanta hasta el final.
5. **Los errores se pintan crudos.** `stream.ts:19` hace
   `throw new Error(await response.text())` y `Chat.tsx:114` renderiza ese texto tal cual.
   Un 500 del servidor Node deja caer HTML o un stack en la interfaz.

Contexto que evita arreglar lo que no está roto: el servidor **sí** emite el eco del
mensaje del usuario antes de llamar al modelo (`harness/session.ts:77`,
`appendMessage(AgentMessage.user(input.input))`), así que la burbuja del usuario aparece
casi al instante. No hay que insertarla de forma optimista.

## Objetivo

Que al enviar el input quede vacío y bloqueado en el mismo frame, que se pueda parar la
generación, y que un fallo devuelva el texto al usuario con un botón de reintentar.

## Fuera de alcance

- **Cancelar el trabajo en el servidor.** Ver *Riesgos y decisiones*.
- **El decodificador NDJSON resiliente** (`Schema.decodeUnknownSync` → variante que no
  lanza). Es el PR-05 y toca el contrato de frames.
- **Estados de fase del panel de evaluación.** PR-05 y PR-07.
- **Historial persistente del chat.** Sigue viviendo en memoria del navegador.
- **Auto-scroll, contador de pasos, temporizador.** Observabilidad es el PR-07.
- **Mover el estado del chat a atoms.** Se extrae a un hook de React, que es el paso
  mínimo. Convertirlo en atom es del PR-07, que ya lo planifica para el workspace.

## Contratos afectados

**Ninguno en `packages/shared`.** El protocolo NDJSON no cambia: mismos dos frames
(`shared/src/api/tutor.ts:19-28`).

Cambio de firma interno de `packages/web`:

```ts
// domain/tutor/stream.ts — antes
export async function* streamTutorMessage(input: TutorChatRequest): AsyncGenerator<TutorChatStreamEvent>

// después
export interface StreamOptions { readonly signal?: AbortSignal }
export async function* streamTutorMessage(
  input: TutorChatRequest,
  options?: StreamOptions
): AsyncGenerator<TutorChatStreamEvent>
```

Fichero nuevo: `packages/web/src/domain/tutor/use-tutor-chat.ts`.

## Pasos

### Paso 0 — Comprobación previa

1. [ ] `git switch -c fix/chat-input-lifecycle` sobre la rama con el PR-09 dentro.
2. [ ] Confirmar que `Chat.tsx:64` sigue siendo `setInput("");` dentro del `try` y que el
       `<textarea>` de `:123` no tiene `disabled`. Si ya no es así, **para**.
3. [ ] `pnpm run typecheck` en verde.

### Paso 1 — `stream.ts`: señal de aborto y cierre del lector

En `packages/web/src/domain/tutor/stream.ts`:

1. [ ] Añadir el segundo parámetro `options` y pasarlo a `fetch`:
       `signal: options?.signal`.
2. [ ] Envolver el bucle de lectura en `try { ... } finally { await reader.cancel().catch(() => {}); }`.
       Motivo: si el consumidor sale del `for await` con un `break` o una excepción, el
       generador se cierra pero el `ReadableStream` se queda abierto y la conexión
       colgada. Hoy no pasa porque nadie hace `break`; con el botón de Stop, sí.
3. [ ] Distinguir el aborto. `fetch` con una señal abortada rechaza con
       `DOMException{name:"AbortError"}`. Exportar el predicado para que lo use el hook:

   ```ts
   export const isAbortError = (cause: unknown): boolean =>
     cause instanceof DOMException && cause.name === "AbortError";
   ```

4. [ ] **Sanear el error de respuesta no-OK.** Sustituir
       `throw new Error(await response.text())` (`:19`) por:

   ```ts
   if (!response.ok) {
     const raw = await response.text().catch(() => "");
     console.error("tutor stream failed", response.status, raw);
     throw new Error(
       response.status >= 500
         ? "The tutor service failed while answering. Try again."
         : "The tutor service rejected the request."
     );
   }
   ```

   El cuerpo crudo va a la consola, nunca a la interfaz.

5. [ ] `pnpm run typecheck`.

### Paso 2 — El hook `useTutorChat`

Fichero nuevo `packages/web/src/domain/tutor/use-tutor-chat.ts`. Esta es la estructura
exacta a implementar; el doer completa el cuerpo respetando esta forma:

```ts
export type TutorChatStatus = "idle" | "sending";

export interface TutorChatState {
  readonly messages: readonly AgentMessage[];
  readonly input: string;
  readonly status: TutorChatStatus;
  readonly error: string | undefined;
  readonly canRetry: boolean;
  readonly setInput: (value: string) => void;
  readonly submit: (value: string) => void;
  readonly stop: () => void;
  readonly retry: () => void;
  readonly clear: () => void;
}

export const useTutorChat = (): TutorChatState => {
  const [messages, setMessages] = useState<readonly AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<TutorChatStatus>("idle");
  const [error, setError] = useState<string | undefined>();

  const refreshArtifacts = useAtomRefresh(artifactsQuery);
  const refreshMaterials = useAtomRefresh(materialsQuery);

  const pendingInvalidations = useRef<Array<ReturnType<typeof invalidationsForToolCall>>>([]);
  const abortRef = useRef<AbortController | undefined>(undefined);
  // lo necesario para reintentar: el prompt y el historial ANTES de enviarlo
  const lastAttempt = useRef<{ prompt: string; messages: readonly AgentMessage[] } | undefined>(undefined);

  const run = async (prompt: string, history: readonly AgentMessage[]) => {
    const controller = new AbortController();
    abortRef.current = controller;
    lastAttempt.current = { prompt, messages: history };

    setStatus("sending");
    setError(undefined);
    setInput("");                       // ← inmediato, antes del await
    pendingInvalidations.current = [];

    try {
      for await (const event of streamTutorMessage(
        { input: prompt, messages: history },
        { signal: controller.signal }
      )) {
        if (event.type === "done") continue;
        // …mismo cuerpo que hoy: append + invalidaciones (Chat.tsx:46-61)
      }
      lastAttempt.current = undefined;
    } catch (cause) {
      setMessages(history);             // descarta los mensajes parciales del intento fallido
      setInput(prompt);                 // devuelve el texto al textarea
      if (!isAbortError(cause)) {
        setError(cause instanceof Error ? cause.message : "Something went wrong. Try again.");
      }
    } finally {
      abortRef.current = undefined;
      setStatus("idle");
    }
  };

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || status === "sending") return;
    void run(trimmed, messages);
  };

  const retry = () => {
    const attempt = lastAttempt.current;
    if (attempt === undefined || status === "sending") return;
    void run(attempt.prompt, attempt.messages);
  };

  const stop = () => abortRef.current?.abort();

  const clear = () => { setMessages([]); setError(undefined); lastAttempt.current = undefined; };

  return { messages, input, status, error, canRetry: lastAttempt.current !== undefined, setInput, submit, stop, retry, clear };
};
```

Decisiones que el doer **no** cambia:

1. [ ] `setInput("")` va **antes** del primer `await`, no después del bucle.
2. [ ] En el `catch` se restaura `setInput(prompt)` **y** `setMessages(history)`.
       Motivo: si el stream muere a mitad, en `messages` han quedado un `user`, quizá un
       `tool-call` y un `tool-result` huérfanos. Reintentar con ese historial le manda al
       modelo una conversación mutilada. Se vuelve al estado previo al envío.
3. [ ] Un aborto **no** es un error: restaura el texto, no pinta mensaje rojo.
4. [ ] Se deja de mandar `maxSteps` desde el cliente. Lo decide el servidor
       (`tutor-chat-service.ts:33`); el PR-11 lo baja. Hoy `Chat.tsx:40` manda un `8` a
       pelo que duplica el default del servidor.
5. [ ] `useEffect` de desmontaje: `return () => abortRef.current?.abort();`.
       Sin esto, navegar fuera deja la petición viva.

### Paso 3 — `Chat.tsx` consume el hook

1. [ ] Sustituir los cuatro `useState` y el `useRef` de `Chat.tsx:18-24`, y toda la
       función `submit` (`:26-70`), por `const chat = useTutorChat();`. El fichero se
       queda sólo con presentación.
2. [ ] `<textarea>` (`:123-129`), añadir:
   - `disabled={chat.status === "sending"}`
   - `aria-busy={chat.status === "sending"}`
   - `className` con el sufijo `disabled:cursor-not-allowed disabled:opacity-60`
   - `placeholder={chat.status === "sending" ? "Waiting for the tutor…" : "Ask your tutor something…"}`
3. [ ] El botón (`:130-136`) **conmuta**:

   ```tsx
   {chat.status === "sending"
     ? (
         <button type="button" onClick={chat.stop}
           className="self-end rounded-full border border-slate-700 bg-slate-900 px-5 py-3 text-slate-100 hover:border-blue-500">
           Stop
         </button>
       )
     : (
         <button type="submit" disabled={chat.input.trim().length === 0}
           className="self-end rounded-full border border-slate-700 bg-slate-900 px-5 py-3 text-slate-100 hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50">
           Send
         </button>
       )}
   ```

   El botón de Stop **nunca** va `disabled`: es la salida de emergencia.
4. [ ] Los tres botones de `starterPrompts` (`:98-107`) llevan
       `disabled={chat.status === "sending"}`.
5. [ ] El botón *Clear chat* (`:79-86`) pasa a `disabled={chat.messages.length === 0 || chat.status === "sending"}`
       y llama a `chat.clear`.

### Paso 4 — Enviar con Enter

1. [ ] `onKeyDown` en el textarea: `Enter` sin `shift` → `event.preventDefault()` y
       `chat.submit(chat.input)`; `Shift+Enter` inserta salto de línea.
2. [ ] Respetar la composición IME: no enviar si `event.nativeEvent.isComposing` es
       `true`, o se rompe la escritura en japonés/chino y los teclados con acentos
       muertos.

### Paso 5 — El error, con reintento

Sustituir `Chat.tsx:114` por una fila propia dentro del grid:

```tsx
{chat.error === undefined ? null : (
  <div className="mx-6 mb-3 flex items-center justify-between gap-4 rounded-xl border border-red-900 bg-red-950/50 px-4 py-3">
    <p className="m-0 text-red-100 text-sm">{chat.error}</p>
    {chat.canRetry && (
      <button type="button" onClick={chat.retry}
        className="shrink-0 rounded-full border border-red-800 px-3 py-1 text-red-100 text-sm hover:border-red-500">
        Retry
      </button>
    )}
  </div>
)}
```

1. [ ] Mismo lenguaje visual que el error de `ArtifactWorkspace.tsx:137`.
2. [ ] El error se limpia al empezar cualquier envío nuevo (ya lo hace `run`).

### Paso 6 — Burbuja de "pensando"

1. [ ] Mientras `status === "sending"` y el último mensaje **no** es `assistant`,
       renderizar al final de la lista una burbuja con la misma caja que la del tutor
       (`Chat.tsx:159`) y tres puntos animados con `animate-pulse`.
2. [ ] Va dentro de la `<section aria-live="polite">` que ya existe (`:89`).
3. [ ] Es el único indicador de progreso de este PR. Las fases reales del agente son el
       PR-07.

### Paso 7 — CSS y documentación

1. [ ] `pnpm --filter @proxus/web run build` para regenerar `styles.generated.css` (clases
       nuevas: `disabled:opacity-60`, `animate-pulse`, `bg-red-950/50`…). El fichero está
       en `.gitignore`; **no debe aparecer en `git status`**.
2. [ ] `documentacion/funcionamiento-actual.md` §7: la frase *"No hay burbuja de
       pendiente, ni contador de pasos, ni temporizador, ni botón de parar"* deja de ser
       cierta en dos de sus cuatro partes. Corregirla con precisión, no borrarla.
       Y §2: *"No hay `AbortSignal`: no se puede cancelar una petición en curso"* pasa a
       decir que el cliente cancela, con la salvedad de que el servidor sigue trabajando.
3. [ ] **`documentacion/dificultades.md`** — añadir la entrada del PR-10 con el formato
       que fija el PR-09 §Paso 9. Candidatas: el `AbortError` que se colaba como error
       visible, el `isComposing` del IME, el `reader.cancel()` que faltaba, la restauración
       del historial parcial.

## Criterio de aceptación

- [ ] Al pulsar *Send*, el textarea queda vacío **antes** de que llegue ninguna respuesta.
- [ ] Durante la generación el textarea está deshabilitado: teclear no cambia nada y el
      cursor es `not-allowed`.
- [ ] Durante la generación el botón dice *Stop* y está habilitado.
- [ ] Pulsar *Stop* corta la petición: en DevTools → Network aparece como cancelada, los
      mensajes dejan de llegar y el prompt vuelve al textarea.
- [ ] Tras un *Stop* no queda ningún mensaje rojo de error.
- [ ] Con el servidor apagado, enviar produce una frase legible + botón *Retry*, el prompt
      vuelve al textarea y **no** se ve HTML, ni un stack, ni "Failed to fetch" a secas.
- [ ] *Retry* reenvía el mismo prompt con el mismo historial y funciona si el servidor ha
      vuelto.
- [ ] Tras un fallo a mitad de stream no quedan mensajes huérfanos en la conversación.
- [ ] `Enter` envía; `Shift+Enter` hace salto de línea.
- [ ] Los botones de prompt sugerido no se pueden pulsar mientras se genera.
- [ ] Mientras el agente trabaja se ve una burbuja de "pensando".
- [ ] Recargar la página durante una generación no deja peticiones colgadas.
- [ ] `Chat.tsx` ya no contiene lógica de red: sólo presentación y llamadas al hook.
- [ ] `documentacion/dificultades.md` tiene al menos una entrada del PR-10.

## Checks

```bash
pnpm run typecheck                        # gate, en verde
pnpm --filter @proxus/web run build       # en verde

grep -n "disabled" packages/web/src/components/Chat.tsx      # el textarea entre los aciertos
grep -rn "maxSteps" packages/web/src                          # 0 aciertos tras el Paso 2
grep -n "AbortController\|signal" packages/web/src/domain/tutor/*.ts   # presentes
```

## QA manual

1. `pnpm run dev`, abrir `http://localhost:5173`.
2. Escribir *"explícame la regla de la cadena"* y enviar. El textarea se vacía al
   instante; intentar escribir mientras responde no hace nada.
3. Enviar *"crea un quiz de 5 preguntas sobre mis materiales"* y pulsar *Stop* a los dos
   segundos. Comprobar en Network que la petición se cancela y que el prompt reaparece en
   el textarea.
4. Parar el servidor (`Ctrl+C` en el proceso del backend) y enviar cualquier cosa:
   mensaje legible, prompt recuperado, botón *Retry* visible.
5. Levantar el servidor y pulsar *Retry*: la respuesta llega.
6. Con DevTools → Network en modo *Offline*, enviar, volver a *Online*, *Retry*.
7. Probar `Shift+Enter` (salto de línea) y `Enter` (envío).
8. Empezar una generación y recargar la página: no queda ninguna petición pendiente.

## Riesgos y decisiones

- **El aborto es sólo del cliente.** `abort()` cierra el socket, pero el fiber del
  servidor sigue el bucle de `session.ts:80-113` hasta terminar y seguirá gastando
  llamadas a Gemini. Cortarlo de verdad exige que `HttpServerResponse.stream` propague la
  desconexión como interrupción, y eso no está verificado en `4.0.0-beta.83`. **Decisión:
  se acepta.** El usuario recupera el control de la interfaz, que es el problema
  reportado. Queda anotado en el cuerpo del PR y en la documentación: *"Stop cancela la
  espera, no el trabajo del servidor."*

- **Restaurar el historial al fallar borra mensajes que el usuario ya vio.** La
  alternativa —dejarlos— manda al modelo un historial con un `tool-call` sin cierre en el
  reintento. Se elige la coherencia del historial sobre la persistencia visual.

- **Hook de React, no atom.** El PR-07 planea llevar el estado de evaluación a atoms, y
  §9 de `plan.md` registra como límite duro que el chat vive en `useState`. Este PR no
  cambia esa arquitectura, sólo saca la lógica de dentro del componente para poder
  probarla y para que el PR-05 y el PR-07 aterricen sobre algo con forma. Convertirlo en
  atom cuando toque será un cambio local a un fichero.

- **`Enter` para enviar es una decisión de producto**, no técnica: con un `rows={3}` el
  usuario espera escribir varias líneas. Se mitiga con `Shift+Enter` y con el guard de
  IME. Si producto lo rechaza, quitar el Paso 4 no afecta a nada más.

- **Conflicto con el PR-05, asumido.** El PR-05 hará resiliente el decodificador de
  `stream.ts` y ampliará el manejo de frames en `Chat.tsx`. Al ir este PR antes, el PR-05
  encontrará esos dos ficheros distintos de como los describe su plan. **El thinker
  actualizará el Paso 6 del PR-05 tras el merge de éste.** El doer no lo hace por su
  cuenta.

## Historial

- **Tras el PR-1.5**: los fragmentos de este plan llevan clases literales
  (`bg-slate-900`, `border-sky-400`, `blue-600`…). El PR-1.5 las prohíbe. **Estos
  fragmentos hay que retokenizarlos antes de implementar este PR**; los tokens y las
  recetas equivalentes están en `documentacion/design-system.md`.

- *(vacío)*
