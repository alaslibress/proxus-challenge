# PR-01 — SSOT de schemas: eliminar la duplicación shared/server

- **Rama**: `refactor/ssot-schemas`
- **Depende de**: nada. Es el primer PR del roadmap.
- **Bloquea a**: PR-02 en adelante. Todos tocan estos schemas.
- **Estado**: borrador
- **Contiene LLM**: no. Refactor puro, sin cambio de comportamiento.
- **Origen**: [ADR-01, Decisión 3](../../documentacion/adr-motor-evaluacion.md) — *Single Source of Truth (SSOT) para Schemas*.

> Normas de trabajo en [`../plan.md`](../plan.md). Contexto técnico obligatorio en
> [`../../documentacion/contexto-repo.md`](../../documentacion/contexto-repo.md) y
> [`../../documentacion/funcionamiento-actual.md`](../../documentacion/funcionamiento-actual.md).
> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.

---

## Problema

Los modelos de datos de artifacts están declarados **dos veces**, de forma independiente:

- `packages/shared/src/schemas/artifact.ts` — la copia de contrato, la que codifica y
  decodifica el HTTP.
- `packages/server/src/domain/artifacts/artifact.ts` (líneas 3-265) — la copia de
  dominio, la que usa todo el backend.

Son **29 nombres duplicados** y hoy están byte a byte idénticos. El peligro no es que
estén distintos: es que nada obliga a que sigan iguales. El server no importa la copia
compartida para nada de artifacts (solo importa `@proxus/shared` para `ProxusApi` y los
tipos del tutor: `transport/http/server.ts:7`, `handlers.ts:3`,
`tutor-chat-service.ts:3`); todo encaja por compatibilidad estructural.

Consecuencia práctica, y es la que va a doler en los PRs siguientes: **si se añade un
campo a la copia de dominio y no a la de contrato, el proyecto compila igual, pero
`Schema.Struct` descarta al codificar las propiedades que no declara y el campo
desaparece silenciosamente por HTTP.** Un fallo sin error, sin traza y sin test que lo
detecte, porque no hay tests.

Los PR-02, PR-03 y PR-04 añaden campos a estos mismos schemas (`source`,
`FinalFeedbackSchema`, el review del panel). Hacer la consolidación *después*, como
figura en el ADR, obliga a editar dos copias durante tres PRs y a deshacer ese trabajo
al final. Por eso este PR va primero.

## Objetivo

Que exista **una sola declaración** de cada schema de artifacts, en `packages/shared`, y
que el dominio del server la importe en lugar de redeclararla.

## Fuera de alcance

- Cualquier cambio de comportamiento. Este PR no debe alterar ni un byte de lo que sale
  por la API. Es un refactor de declaraciones.
- Los schemas de materiales (`domain/materials/material.ts`): ahí las declaraciones del
  server son **interfaces TypeScript**, no `Schema`, y no participan en la serialización
  HTTP de la misma forma. Se dejan como están; el PR-02 añadirá lo suyo.
- `AgentMessage`, que también está duplicado (schema en `shared/src/schemas/agent-message.ts`
  + interfaces en `domain/agents/harness/message.ts`). Es una duplicación distinta
  —interfaces contra schema, con un `switch` exhaustivo colgando en
  `harness/session.ts:155-197`— y tocarla ahora mete riesgo en el harness sin resolver
  ningún bloqueo. Queda anotada como deuda conocida.
- El motor multi-agente, Gemini, la UI y el streaming.

## Contratos afectados

Todo el cambio es en `packages/shared/src/schemas/artifact.ts` (crece) y
`packages/server/src/domain/artifacts/artifact.ts` (adelgaza).

### Inventario exacto

**29 nombres duplicados y byte-idénticos** — se borran del server y se importan de shared:

```
QuestionOption · MultipleChoiceQuestion · TrueFalseQuestion · ShortAnswerQuestion
QuizQuestion · TestQuestion · NoteArtifact · QuizArtifact · TestArtifact
Artifact · ArtifactKind
MultipleChoiceAnswer · TrueFalseAnswer · ShortAnswerAnswer · QuizAnswer · TestAnswer
MultipleChoiceCorrection · TrueFalseCorrection · ShortAnswerCorrection
AutoQuestionCorrection · QuestionCorrection
UngradedQuizAttempt · GradedQuizAttempt · UngradedTestAttempt · GradedTestAttempt
ArtifactAttempt · SubmitQuizAttemptInput · SubmitTestAttemptInput · SubmitAttemptInput
```

**5 schemas que solo existen en el server** — se **suben** a shared:

```
CreateNoteArtifactInput · CreateQuizArtifactInput · CreateTestArtifactInput
CreateArtifactInput · ListArtifactsInput
```

Suben porque son contratos de entrada de verdad: `CreateArtifactInput` es lo que el
agente decodifica en `artifact-commands.ts:99-104`, y `ListArtifactsInput` es lo que el
handler construye desde la query (`handlers.ts:48`). Que vivan en `shared` es la
definición de SSOT, y además deja la puerta abierta a exponer creación por REST más
adelante sin volver a mover nada.

**2 schemas que solo existen en shared** — no se tocan: `ArtifactSummary`,
`ArtifactListResponse`. Son forma de respuesta HTTP, no de dominio.

**Lo que se queda en el server** — es dominio puro, no contrato, y no debe subir:

```
ArtifactNotFound · AttemptNotFound · ArtifactTypeMismatch · QuestionNotFound
AnswerTypeMismatch · ArtifactRepositoryStorageError · ArtifactRepositorySerializationError
ArtifactRepositoryError (union de tipos)
ArtifactRepository (puerto + Context.Service)
makeArtifact · makeUngradedAttempt · gradeAttempt
scoreAutoCorrections · scoreQuestionCorrections
```

## Pasos

### Paso 0 — Verificar el punto de partida

- [ ] Confirmar que los 29 schemas comunes siguen siendo idénticos antes de borrar nada:

```bash
sed -n '1,265p' packages/server/src/domain/artifacts/artifact.ts | grep -v '^import' > /tmp/srv.ts
grep -v '^import' packages/shared/src/schemas/artifact.ts > /tmp/shr.ts
diff /tmp/shr.ts /tmp/srv.ts
```

El diff esperado contiene **únicamente** los bloques de `ArtifactSummary` /
`ArtifactListResponse` (lado shared) y los `Create*ArtifactInput` / `ListArtifactsInput`
(lado server). **Si aparece cualquier otra diferencia, el doer para y lo notifica**: eso
significaría que las copias ya han divergido y hay que decidir cuál gana antes de seguir.

### Paso 1 — Subir los 5 schemas que faltan a shared

- [ ] Copiar `CreateNoteArtifactInput`, `CreateQuizArtifactInput`,
      `CreateTestArtifactInput` y `CreateArtifactInput` a
      `packages/shared/src/schemas/artifact.ts`, colocándolos **justo después** de
      `Artifact` / `ArtifactKind` (que acaban en `:79`), que es el orden que ya tienen en
      el server.
- [ ] Copiar `ListArtifactsInput` al final del fichero, después de `SubmitAttemptInput`.
- [ ] Verbatim: no reescribir, no "mejorar", no reordenar campos. Cualquier cambio de
      forma aquí es un cambio de contrato encubierto.

Comprobación: `pnpm --filter @proxus/shared run typecheck`.

### Paso 2 — Vaciar la copia de dominio y re-exportar

En `packages/server/src/domain/artifacts/artifact.ts`:

- [ ] Borrar las líneas 3-265 completas (todas las declaraciones de schema).
- [ ] Ajustar el import de la línea 1: `Schema` deja de usarse en la parte de
      declaraciones pero **sigue haciendo falta** si algún sitio del fichero lo usa;
      comprobarlo y quitarlo solo si queda huérfano (`noUnusedLocals: true` lo cazará).
      `Context`, `Data` y `EffectNumber` se quedan.
- [ ] Añadir arriba un re-export explícito, para que **los 6 ficheros que importan de
      aquí no tengan que cambiar**:

```ts
export {
  QuestionOption, MultipleChoiceQuestion, TrueFalseQuestion, ShortAnswerQuestion,
  QuizQuestion, TestQuestion, NoteArtifact, QuizArtifact, TestArtifact, Artifact,
  CreateNoteArtifactInput, CreateQuizArtifactInput, CreateTestArtifactInput,
  CreateArtifactInput, MultipleChoiceAnswer, TrueFalseAnswer, ShortAnswerAnswer,
  QuizAnswer, TestAnswer, MultipleChoiceCorrection, TrueFalseCorrection,
  ShortAnswerCorrection, AutoQuestionCorrection, QuestionCorrection,
  UngradedQuizAttempt, GradedQuizAttempt, UngradedTestAttempt, GradedTestAttempt,
  ArtifactAttempt, SubmitQuizAttemptInput, SubmitTestAttemptInput, SubmitAttemptInput,
  ListArtifactsInput
} from "@proxus/shared";
export type { ArtifactKind } from "@proxus/shared";
```

Notas de tipado que el doer debe tener presentes:

- En este repo cada schema es un `const` **y** un `type` con el mismo nombre. Un
  `export { X } from ...` re-exporta ambos significados; no hace falta duplicar la lista
  con `export type`.
- `ArtifactKind` es **solo** un tipo (`Artifact["kind"]`), por eso va aparte en
  `export type`. Con `verbatimModuleSyntax: true` esto no es opcional.
- Los imports a `@proxus/shared` son de paquete, **no** llevan extensión `.ts`. La regla
  de `rewriteRelativeImportExtensions` aplica solo a rutas relativas.

Comprobación: `pnpm --filter @proxus/server run typecheck`.

### Paso 3 — Decidir si el re-export se queda o se disuelve

El re-export del paso 2 mantiene el PR pequeño, pero deja `artifact.ts` haciendo de
proxy. Dos opciones, y **este plan elige la segunda**:

- (a) Dejar el re-export. Cero cambios en los 6 importadores.
- (b) **Elegida**: apuntar cada importador directamente a `@proxus/shared` para los
      schemas, y dejar `artifact.ts` conteniendo solo dominio.

Razón: la primera opción conserva la ilusión de que el dominio "posee" esos tipos, que es
exactamente el malentendido que causó la duplicación. Son 6 ficheros y los imports ya
están agrupados.

- [ ] `packages/server/src/infra/artifacts/file-artifact-repository.ts:21` — separar el
      import en dos: schemas desde `@proxus/shared`, errores + puerto + funciones de
      dominio desde `../../domain/artifacts/artifact.ts`.
- [ ] `packages/server/src/domain/agents/academic-tutor/artifact-commands.ts:16` — igual.
- [ ] `packages/server/src/domain/agents/academic-tutor/evals/artifact-authoring.eval.ts:18` — igual.
- [ ] `packages/server/src/transport/http/handlers.ts:5` — `type Artifact` pasa a venir de
      `@proxus/shared`; `ArtifactRepository` se queda donde está.
- [ ] `packages/server/src/domain/agents/academic-tutor.ts:8` y
      `.../tutor-chat-service.ts:4` — solo importan `ArtifactRepository`: **no se tocan**.
- [ ] Quitar el bloque de re-export del paso 2 una vez que nadie lo necesita.
      `noUnusedLocals` no avisa de re-exports muertos, así que hay que borrarlo a mano.

### Paso 4 — Comprobar que la serialización no cambió

Este es el paso que justifica el PR entero. Un refactor de tipos que altera la respuesta
HTTP es un fallo, y sin tests hay que verificarlo a mano.

- [ ] Antes de empezar (o con `git stash`), levantar el server sobre `main`, crear un
      quiz con el tutor y guardar las respuestas crudas:
      ```bash
      curl -s localhost:3000/api/artifacts/ > /tmp/before-list.json
      curl -s localhost:3000/api/artifacts/<id> > /tmp/before-get.json
      ```
- [ ] Con el PR aplicado y **el mismo `.data`**, repetir contra `/tmp/after-*.json` y
      comprobar `diff` vacío en ambos.
- [ ] Lo mismo para un `POST /api/artifacts/:id/submit` con el mismo cuerpo: el attempt
      corregido debe salir idéntico.

### Paso 5 — Documentación

- [ ] `documentacion/funcionamiento-actual.md` §5: la duplicación de artifacts deja de
      ser cierta. Actualizar el párrafo y la mención en §9. **Dejar** la nota sobre
      `AgentMessage`, que sigue duplicado.
- [ ] `documentacion/contexto-repo.md`: misma corrección donde se mencione.
- [ ] `docs/architecture.md`: si describe la duplicación, actualizar.

## Criterio de aceptación

1. `grep -c "Schema.Struct" packages/server/src/domain/artifacts/artifact.ts` devuelve `0`.
2. `packages/shared/src/schemas/artifact.ts` es el único sitio donde se declaran: los 29
   deduplicados, los 5 que suben del server y los 2 que ya sólo vivían en shared
   (`ArtifactSummary`, `ArtifactListResponse`). Uno de los 29, `ArtifactKind`, es un alias
   de tipo derivado de `Artifact`, no una declaración propia, así que el recuento de
   declaraciones queda en **35**:
   `grep -c '^export const ' packages/shared/src/schemas/artifact.ts` → `35`. Es el número
   que hay que comprobar, no memorizar: crecerá con cualquier PR que añada un contrato.
3. `pnpm run typecheck` en verde en los cuatro paquetes.
4. `pnpm --filter @proxus/web run build` en verde.
5. Las respuestas de `GET /api/artifacts/`, `GET /api/artifacts/:id` y
   `POST /api/artifacts/:id/submit` son **byte a byte idénticas** antes y después, con el
   mismo `.data`.
6. `pnpm --filter @proxus/server run eval:tutor:artifact-authoring` sigue pasando.
7. El flujo manual completo (chat → crear quiz → resolver → corregir) funciona igual.
8. `git diff --stat` no muestra cambios en `packages/web/`.

## Checks

```bash
pnpm run typecheck
pnpm --filter @proxus/web run build
pnpm --filter @proxus/server run eval:tutor:artifact-authoring   # requiere API key
```

## QA manual

`packages/server/.data/` no existe en un checkout limpio. Antes de nada:

1. `mkdir -p packages/server/.data/materials/pdfs` y copiar ahí un PDF.
2. `pnpm run dev`, abrir `http://localhost:5173`.
3. Pedir al tutor un quiz de 2 preguntas. Debe crearse y aparecer en la sidebar.
4. Resolverlo y enviarlo. Debe devolver nota, corrección por pregunta y `try again`.
5. Repetir la captura de `curl` del paso 4 y confirmar diff vacío.

Si el `.data` viene de antes del PR, **mejor**: es la prueba de que los artifacts ya
guardados siguen decodificando.

## Riesgos y decisiones

- **Riesgo real: cero.** Los 29 schemas son byte-idénticos hoy (verificado con `diff`), y
  el paso 0 obliga a comprobarlo otra vez antes de borrar. Si alguien ha tocado algo entre
  medias, el plan se detiene en lugar de machacarlo.
- **`packages/shared` no puede importar del server.** La dirección de dependencia es
  `web → shared ← server`. Todo lo que sube a shared debe ser autocontenido: los 5
  schemas que suben solo dependen de otros schemas, así que no hay ciclo.
- **Los errores de dominio no suben.** Son `Data.TaggedError`, forman parte del canal de
  error de Effect y hoy ni siquiera llegan al cliente: todos los handlers terminan en
  `Effect.orDie` y ningún endpoint declara `error:`. Subirlos sería un cambio de
  arquitectura HTTP, no un SSOT de schemas.
- **`AgentMessage` sigue duplicado y se queda así.** Es la otra deuda del mismo tipo,
  pero su radio de explosión incluye el `switch` exhaustivo de `session.ts:155-197` bajo
  `noFallthroughCasesInSwitch`, y ningún PR del roadmap necesita tocarla: los eventos
  nuevos van en las uniones de frames, discriminadas por `type`. Va al README de entrega
  como próximo paso.
- **Coste de oportunidad.** Es un PR sin valor de producto visible, gastado en el primer
  hueco de dos días. Se hace igual porque los tres PRs siguientes escriben sobre estos
  ficheros, y pagar el refactor después significaría hacerlo tres veces mal y una bien.

## Hallazgo de la fase — el PR-1.5

> **Nota añadida a posteriori (2026-09-08).** No forma parte del plan original ni cambia
> nada de lo de arriba: se anota aquí porque es el sitio donde un lector futuro lo va a
> buscar.

Con este PR ya mergeado (`946f894`) y antes de arrancar la fase 2 del roadmap
([`tech-spec.md §6`](../../documentacion/tech-spec.md)) apareció un problema que el
roadmap no contemplaba: **no había sistema visual**. Cada componente pintaba con clases
literales de Tailwind (`bg-slate-900`, `border-sky-400`, `bg-blue-600`), así que todo PR
posterior que tocase UI —PR-09, PR-10, PR-07— habría nacido con colores que después
tocaría repintar uno a uno.

La respuesta fue [`../pr-1.5-sistema-visual/plan.md`](../pr-1.5-sistema-visual/plan.md):
capa de tokens `@theme`, fuentes Geist, tema claro, repintado de los cuatro componentes y
[`documentacion/design-system.md`](../../documentacion/design-system.md) como norma para
todo lo que venga detrás.

**Por eso lleva número fraccionario.** No es un PR más al final de la lista: es un hallazgo
de esta primera fase, resuelto dentro de ella e inmediatamente detrás de este PR-01, antes
que ningún otro. El orden real de ejecución empieza así: **PR-01 → PR-1.5 → …**

## Historial

- **2026-09-08** — Se añade la sección *Hallazgo de la fase — el PR-1.5*, que documenta por
  qué el sistema visual salió de esta fase y por qué su plan tiene numeración fraccionaria.
  No se toca ninguna decisión ni ningún paso del plan original.
