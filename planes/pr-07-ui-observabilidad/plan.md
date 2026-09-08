# PR-07 — UI: observabilidad del panel y citas verificadas

- **Rama**: `feat/ui-observabilidad`
- **Depende de**: PR-05 (stream y lector NDJSON). Se apoya en PR-04 para el contenido del `review`.
- **Bloquea a**: nada.
- **Estado**: borrador
- **Contiene LLM**: no. Solo pinta lo que llega.
- **Origen**: [ADR-02 §1](../../documentacion/adr-02-evaluacion-transporte-observabilidad.md) y [Tech Spec §4](../../documentacion/tech-spec.md).

> Normas de trabajo en [`../plan.md`](../plan.md). Contexto técnico obligatorio en
> [`../../documentacion/contexto-repo.md`](../../documentacion/contexto-repo.md) y
> [`../../documentacion/funcionamiento-actual.md`](../../documentacion/funcionamiento-actual.md).
> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.

---

## Problema

El PR-05 dejó el servidor emitiendo el progreso real del panel por NDJSON, y **nadie lo
consume**. El alumno sigue viendo lo de siempre: `ExerciseSolver` llama a
`submitArtifactAttemptAction` en modo promesa (`ArtifactWorkspace.tsx:86`) y el único
indicio de vida es el botón cambiando a `"Submitting…"` (`:142-177`) durante decenas de
segundos.

Y cuando por fin llega la respuesta, el trabajo del panel es invisible: `CorrectionDetails`
(`:308-334`) pinta para `short-answer` únicamente el campo `feedback`, así que el
`review` con su prosa razonada y sus `citas_pdf` verificadas —lo que de verdad distingue a
este producto— no aparece por ninguna parte.

Hay además un detalle de arquitectura que la Tech Spec §4 señala y hoy no se cumple: el
estado de la resolución vive en cuatro `useState` dentro de `ExerciseSolver`
(`:82-86`), no en atoms.

## Objetivo

Que el alumno vea a los tres agentes trabajando mientras se corrige su intento, y que el
feedback final muestre las citas del PDF distinguiendo con claridad las verificadas de las
que no lo están.

## Fuera de alcance

- Rediseño visual del producto. La Tech Spec §4 es explícita: *"el objetivo en UI no es un
  rediseño visual, sino Observabilidad del Razonamiento"*. Se respeta el aspecto actual,
  Tailwind v4 y el `color-scheme: dark` de `styles.input.css`.
- El chat. El PR-05 ya hizo el cambio mínimo para que no se rompa, y **no lo hizo en
  `Chat.tsx`**: la lógica de estado y el bucle de eventos del stream viven desde el PR-10 en
  el hook `packages/web/src/domain/tutor/use-tutor-chat.ts:56-75`, y `Chat.tsx` quedó como
  presentación pura (su única línea de lógica es `const chat = useTutorChat();`,
  `Chat.tsx:13`). **No se toca ninguno de los dos en este PR.**
- Streaming de tokens. No existe (`streamText` es `Stream.empty`).
- Multiple-choice y true-false: se corrigen igual que siempre y no pasan por el panel.
- Subida de PDFs, rutas, router, o cualquier endpoint nuevo.

## Contratos afectados

Ninguno. Este PR solo consume lo que ya definieron el PR-04 (`ShortAnswerCorrection.review`)
y el PR-05 (`AttemptStreamEvent`).

## Pasos

### Paso 1 — El estado en un atom

- [ ] Crear `packages/web/src/domain/artifacts/evaluation-atoms.ts`:

```ts
import * as Atom from "effect/unstable/reactivity/Atom";

export type EvaluationRunState =
  | { readonly phase: "idle" }
  | {
      readonly phase: "running";
      readonly activeStages: readonly AttemptEvaluationStage[];
      readonly questionId: string;
      readonly questionIndex: number;
      readonly questionTotal: number;
    }
  | { readonly phase: "done"; readonly attempt: ArtifactAttempt }
  | { readonly phase: "error"; readonly message: string };

export const evaluationRunAtom = Atom.family((artifactId: string) =>
  Atom.make<EvaluationRunState>({ phase: "idle" })
);
```

- [ ] Import namespace `import * as Atom from "effect/unstable/reactivity/Atom"`, que es el
      estilo que ya usa `domain/artifacts/atoms.ts:3`. **No** importar `Atom` desde
      `@effect/atom-react`: ese paquete solo aporta los hooks de React.
- [ ] `Atom.make` con un valor plano crea un **atom escribible**; se lee y escribe con
      `useAtom` de `@effect/atom-react`, que devuelve una tupla al estilo `useState`.
- [ ] `activeStages` es un **array**, no un único valor. Los dos profes corren en paralelo
      y sus dos eventos llegan casi a la vez: el estado tiene que poder tener dos etapas
      activas simultáneamente.

### Paso 2 — Migrar `ExerciseSolver` al stream

En `packages/web/src/components/ArtifactWorkspace.tsx`:

- [ ] `answers` se queda en `useState`: es estado de formulario, efímero y local, y meterlo
      en un atom no aporta nada. Lo que se mueve al atom es **el estado de la evaluación**,
      que es lo que la Tech Spec §4 pide observar.
- [ ] Sustituir `attempt`, `error` e `isSubmitting` por el `evaluationRunAtom(artifactId)`.
      Las tres variables son fases del mismo proceso y tenerlas sueltas permite estados
      imposibles (`isSubmitting` y `error` a la vez).
- [ ] En `submit()` (`:97-114`), cambiar `submitAttempt(...)` por el consumo del stream del
      PR-05:
      ```ts
      for await (const event of streamAttemptSubmission(artifactId, input, signal)) {
        switch (event.type) {
          case "status": /* actualizar activeStages / questionIndex */ break;
          case "done":   /* phase: "done" */ break;
          case "error":  /* phase: "error" */ break;
        }
      }
      ```
- [ ] `buildSubmitInput` (`:339-380`) **no se toca**: el contrato de entrada es el mismo
      `SubmitAttemptInput`.
- [ ] Mantener `disabled={attempt !== null}` en los inputs (`:132`) atándolo ahora a
      `phase === "done"`.

**Regla de acumulación de `status`:** un `evaluating_good` añade su etapa a `activeStages`;
la llegada de `deliberating` las sustituye por sí solo, porque el Juez arranca cuando los
dos profes han terminado. Un cambio de `questionId` vacía `activeStages` antes de empezar.

### Paso 3 — Invalidación que se pierde al usar `fetch`

Trampa fácil de pasar por alto. `submitArtifactAttemptAction`
(`domain/artifacts/atoms.ts:35-48`) se declara con
`apiRuntime.fn(..., { reactivityKeys: ["artifacts"] })`, así que al enviar refrescaba los
atoms de artifacts sola. **El stream del PR-05 va por `fetch` crudo y no dispara nada.**

- [ ] Tras recibir el frame `done`, refrescar a mano con `useAtomRefresh(artifactsQuery)`,
      exactamente el mismo mecanismo que ya usa el chat tras un tool result. **Ese código
      ya no está en `Chat.tsx`**: desde el PR-10 vive en el hook
      `packages/web/src/domain/tutor/use-tutor-chat.ts`, que declara los refrescos en
      `:33-34` (`useAtomRefresh(artifactsQuery)` y `useAtomRefresh(materialsQuery)`) y los
      dispara en `:69-74` al llegar un `tool-result` que no es fallo, vía
      `applyInvalidations` (`domain/tutor/invalidation.ts:31`). Es el patrón a copiar.
- [ ] De paso, limpiar el ternario muerto de `atoms.ts:37-45`: sus dos ramas son idénticas.

### Paso 4 — Degradación si el streaming no está disponible

- [ ] Si el `fetch` del stream falla antes del primer frame (404, proxy, red), **caer a
      `submitArtifactAttemptAction`**, que sigue existiendo y llama al endpoint tipado.
      El alumno recibe su corrección sin estados intermedios en vez de un error.
- [ ] Un frame `error` a mitad **no** se reintenta: se muestra el mensaje y se ofrece
      reintentar a mano. Reenviar automáticamente dispararía otra tanda de llamadas al LLM.

### Paso 5 — El panel en marcha

- [ ] Componente `EvaluationProgress` en el mismo fichero, renderizado cuando
      `phase === "running"`, en el pie pegajoso que ya existe (`:142-177`).
- [ ] Tres filas fijas, siempre visibles, cada una con su estado — pendiente, en curso o
      terminada:

```
┌─────────────────────────────────────────────┐
│  Pregunta 2 de 3                            │
│                                             │
│  ◐ Profe Bueno analizando…                  │
│  ◐ Profe Malo criticando…                   │
│  ○ Juez deliberando validaciones del PDF…   │
└─────────────────────────────────────────────┘
```

- [ ] **Los dos profes se muestran activos a la vez.** No es un detalle estético: corren en
      paralelo con `Effect.all({ concurrency: "unbounded" })` y enseñarlos en secuencia
      mentiría sobre la arquitectura que el proyecto quiere demostrar.
- [ ] Los textos son los de la Tech Spec §4, en español: *"Profe Bueno analizando…"*,
      *"Profe Malo criticando…"*, *"Juez deliberando validaciones del PDF…"*.
- [ ] Animación **leve**, como pide la spec: pulso de opacidad o un spinner pequeño. Nada
      de barras de progreso ni porcentajes: **no sabemos cuánto falta**, y fingirlo sería
      mentir. Tampoco cuenta atrás.
- [ ] Contenedor con `aria-live="polite"` y `aria-busy={true}`, siguiendo lo que ya hace
      la lista de mensajes del chat (`Chat.tsx:49`). Esta referencia a `Chat.tsx` **es
      correcta**: es presentación, no estado, y ese atributo sigue ahí. (El `aria-busy` del
      chat está en el `textarea`, `Chat.tsx:148`, no en la lista.)
- [ ] Botón **Cancelar** que aborte el `AbortController` que el PR-05 dejó preparado en
      `readNdjson`. Al cancelar se vuelve a `phase: "idle"` con los inputs habilitados.

### Paso 6 — Feedback del Juez y citas

- [ ] Ampliar `CorrectionDetails` (`:308-334`): en la rama `short-answer`, si
      `correction.review` existe, pintar `review.feedback` con `Streamdown` (ya se usa para
      markdown en `NoteViewer` `:69-79`) y debajo las citas.
- [ ] Componente `CitationList`: una tarjeta por cita con el texto entrecomillado, el
      material y la página, y un badge de verificación.

```
┌────────────────────────────────────────────────┐
│ ✅ Verificada · estadistica-tema-3 · pág. 4    │
│ “es el promedio de todos los valores”          │
├────────────────────────────────────────────────┤
│ ⚠️ Sin verificar en el PDF                     │
│ “se calcula con la mediana”                    │
└────────────────────────────────────────────────┘
```

Reglas de honestidad visual, y son el criterio de diseño de todo el PR:

- Una cita `verified: false` **no puede parecerse** a una verificada. Color distinto, icono
  distinto y texto explícito: *"Sin verificar en el PDF"*. No basta con quitar el ✅.
- Una cita sin verificar **no lleva número de página**: no se sabe de dónde salió.
- Si el `review` existe pero **no cambió la nota** por falta de citas verificadas, decirlo:
  una línea *"Evaluación orientativa: no se pudo verificar ninguna cita, la nota es la
  automática."* Es exactamente la regla dura del PR-04 y el alumno merece saberlo.
- Si no hay `review` (panel caído, sin evidencia), la corrección se muestra como siempre,
  sin hueco vacío ni error.

### Paso 7 — Documentación

- [ ] `docs/testing.md`: ampliar la QA manual con el flujo de respuesta corta, los estados
      del panel y la revisión de las citas.
- [ ] `documentacion/funcionamiento-actual.md` §7: la sección sobre la ausencia de
      observabilidad deja de ser cierta para el workspace. Ajustar, **manteniendo** lo que
      sigue siendo verdad del chat.
- [ ] `planes/plan.md` §9: actualizar el límite duro **"El estado del chat no está en
      atoms"**, precisando que sigue siendo cierto para el chat —vive en cinco `useState`
      dentro de `domain/tutor/use-tutor-chat.ts:27-31`, no en `Chat.tsx` y no en atoms— y ya
      no para el workspace. Referenciar por texto y no por número: la lista se renumera.

## Criterio de aceptación

1. Al enviar un test con respuestas cortas aparecen las tres filas del panel, con **Profe
   Bueno y Profe Malo activos simultáneamente** y el Juez después.
2. Con varias respuestas cortas, el contador *"Pregunta N de M"* avanza.
3. Al terminar, cada `short-answer` muestra el feedback del Juez y sus citas.
4. Una cita `verified: true` sale con su página; una `verified: false` sale visualmente
   distinta, con aviso explícito y **sin página**.
5. Si el panel no cambió la nota por falta de citas verificadas, la UI lo dice.
6. El botón Cancelar aborta la petición y devuelve el formulario a editable.
7. Con el endpoint de streaming caído, el envío sigue funcionando por la ruta tipada.
8. Tras corregir, la sidebar refleja el cambio sin recargar la página.
9. Multiple-choice y true-false se ven y se comportan exactamente igual que antes.
10. Un artifact sin `review` (creado antes del PR-04) se renderiza sin huecos ni errores.
11. `pnpm run typecheck` y `pnpm --filter @proxus/web run build` en verde.
12. `packages/web/src/styles.generated.css` **no** aparece en el diff: es generado.

## Checks

```bash
pnpm run typecheck
pnpm --filter @proxus/web run build
pnpm run dev
```

## QA manual

1. PDF con capa de texto en `packages/server/.data/materials/pdfs/`, `pnpm run dev`.
2. Pedir al tutor un test con **tres** preguntas de respuesta corta de la misma página.
3. Responder: una paráfrasis correcta, una equivocada y una en blanco. Enviar.
4. Observar el panel: los dos profes a la vez, luego el Juez, y el contador avanzando.
5. Pulsar **Cancelar** en mitad de otro envío y comprobar que el formulario vuelve a ser
   editable y no queda ningún estado colgado.
6. Revisar el resultado: feedback razonado, citas con su badge, y contrastar una cita
   verificada abriendo el PDF por esa página.
7. Con `GEMINI_MODEL` apuntando a un modelo inexistente, repetir: debe salir la corrección
   determinista sin `review` y sin romper el layout.
8. Estrechar la ventana. El workspace comparte rejilla con el chat en `App.tsx:12-17`: el
   panel no puede desbordar ni empujar el pie fuera de pantalla.

## Riesgos y decisiones

- **`answers` se queda en `useState` a propósito.** La Tech Spec §4 pide *"UI States
  (Effect Atom)"* para los estados del razonamiento, no para el buffer de un formulario.
  Meter cada tecleo en un atom global añadiría re-renders y ruido sin ganar nada.
- **La invalidación se pierde al dejar el action atom.** `reactivityKeys: ["artifacts"]`
  dejaba de aplicarse en cuanto se envía por `fetch`. Es el bug más probable del PR y por
  eso tiene paso propio: se arregla con `useAtomRefresh`, igual que hace el chat.
- **Nada de porcentajes ni tiempos estimados.** Un `status` dice que una llamada empezó, no
  cuánto le queda. La honestidad del indicador es parte del producto que vendemos.
- **Riesgo de que la UI "valide" citas falsas.** Si un `verified: false` se pinta parecido
  a uno verificado, el producto pasa de combatir alucinaciones a legitimarlas. Por eso el
  criterio 4 es explícito y por eso una cita sin verificar no muestra página.
- **`ArtifactWorkspace.tsx` ya son 380 líneas** y este PR le suma dos componentes. Si pasa
  de ~500, extraer `EvaluationProgress` y `CitationList` a
  `components/evaluation/`. No se hace por adelantado: el repo hoy tiene todos los
  componentes en un solo nivel y romper esa convención en el último PR de UI es peor.
- **`styles.generated.css` es generado** por el script del paquete. Si hace falta CSS
  propio va en `styles.input.css`. Tocar el generado se pierde en el siguiente build.
- **Deuda que se deja anotada, no se arregla**: `ArtifactDetail` (`:49-54`) y `Sidebar`
  (`:31-34`, `:59-62`) solo tratan `onInitial` en su `AsyncResult.matchWithError`, así que
  un refresco en segundo plano enseña datos viejos sin avisar. Es un arreglo pequeño pero
  ajeno al objetivo del PR; va al README como próximo paso.

## Historial

- **Referencias a `Chat.tsx` puestas al día tras el PR-10.** El PR-10 movió el estado y el
  bucle de eventos del chat a `packages/web/src/domain/tutor/use-tutor-chat.ts` y dejó
  `Chat.tsx` como presentación pura (`Chat.tsx:13`). Corregidos tres puntos:
  - *Fuera de alcance*, bullet del chat: el cambio mínimo del PR-05 se hace en el hook, no
    en `Chat.tsx`.
  - *Paso 3*: el patrón de `useAtomRefresh` a copiar está en `use-tutor-chat.ts:33-34` y
    `:69-74` (vía `invalidation.ts:31`), no en `Chat.tsx:22-23`.
  - *Paso 7*: el límite duro de `planes/plan.md` §9 sobre el estado del chat se precisa
    contra `use-tutor-chat.ts:27-31`.
  **No se ha tocado** la referencia del *Paso 5* al `aria-live` de la lista de mensajes: es
  presentación legítima y sigue en `Chat.tsx`; solo se corrigió el número de línea
  (`:89` → `:49`).

_El thinker anota aquí cualquier corrección al plan que venga del doer, con fecha y motivo._
