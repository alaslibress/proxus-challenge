# Plan general — proxus-challenge

> **¿Vas a implementar?** Empieza por [`GUIA-DOER.md`](./GUIA-DOER.md): entorno,
> orden de los PRs, trampas del repo y checklist previo a abrir un PR.

Documento raíz del proceso de trabajo del repositorio. Toda funcionalidad nueva
o cambio grande se ejecuta a través de un plan escrito. **Sin plan no hay
código.**

---

## 1. Roles

| Rol | Quién | Qué hace | Qué NO hace |
|-----|-------|----------|-------------|
| **Thinker** | Agente de planificación | Investiga el repo, decide alcance, escribe y mantiene los `plan.md` | No toca código, ni tests, ni config, ni docs de producto. No abre PRs. |
| **Doer** (implementador) | Agente de implementación | Lee un `plan.md`, lo ejecuta paso a paso, abre el PR | No edita ningún `plan.md`. No improvisa alcance. |

El humano es quien delega: elige qué plan se implementa y se lo pasa al doer.

---

## 2. Normas para el THINKER

1. **No modifica código.** Su único output son ficheros dentro de `planes/`.
2. Antes de escribir un plan, investiga el código real afectado y cita rutas
   concretas (`packages/server/src/...`). Nada de suposiciones.
3. Un plan debe ser ejecutable por alguien sin contexto previo: pasos
   ordenados, ficheros exactos, criterio de aceptación y checks a ejecutar.
4. Un plan cubre **un PR**. Si el alcance no cabe en un PR revisable, se parte
   en varios planes con dependencias explícitas.
5. Si el doer reporta una incongruencia, el thinker **actualiza el plan** y
   registra el cambio en la sección `Historial` del propio plan. El doer nunca
   lo hace.
6. Mantiene actualizado el índice de la sección 6 de este documento.

## 3. Normas para el DOER (implementador)

1. **No modifica ningún `plan.md`.** Ni el general ni el del PR. Los planes son
   entrada de solo lectura.
2. Implementa **exactamente lo que dicta el plan, paso a paso**, en el orden
   indicado. No añade features, refactors ni "mejoras de paso".
3. **Si detecta un fallo, una incongruencia, una ambigüedad o algo que el plan
   da por cierto y no lo es: PARA y lo notifica ANTES de implementar.** No lo
   arregla por su cuenta ni sigue adelante asumiendo una interpretación.
4. Marca progreso en su respuesta, no en el fichero del plan.
5. Ejecuta los checks listados en el plan antes de dar el paso por terminado.
6. **El doer es quien abre el PR.**

## 4. Normas de atribución (thinker y doer)

- **Nunca, bajo ninguna circunstancia, se atribuyen crédito en un PR.**
- Prohibido en commits y en descripciones de PR:
  - `Co-Authored-By: Claude ...` o cualquier `Co-Authored-By` de un agente.
  - `🤖 Generated with Claude Code` o equivalente.
  - Enlaces a sesiones de Claude / `Claude-Session:`.
  - Cualquier mención a que el cambio fue generado por un agente.
- Los commits y PRs se escriben como si los firmara el autor humano del repo,
  en inglés, formato Conventional Commits.

---

## 5. Flujo de trabajo

```
idea → thinker escribe planes/pr-NN-slug/plan.md → humano revisa
     → humano delega a doer → doer implementa paso a paso
     → doer ejecuta checks → doer abre PR → merge
     → thinker actualiza índice y estado
```

Convención de rutas:

```txt
planes/
  plan.md                     # este documento (proceso + índice)
  pr-01-<slug>/plan.md        # un directorio por PR
  pr-02-<slug>/plan.md
```

Ramas: `feat/<slug>`, `refactor/<slug>`, `fix/<slug>`. Un PR = un plan = una rama.

---

## 6. Índice de planes

Objetivo del roadmap: llevar el tutor de un MVP con validación determinista a un
**motor multi-agente concurrente aislado** (`EvaluationEngineService`) que evalúa
semánticamente, justifica con **citas literales del PDF verificadas en código**, expone
su progreso por un endpoint NDJSON dedicado y deja traza auditable en disco.

Documentos de origen, en `documentacion/`:

- [`tech-spec.md`](../documentacion/tech-spec.md) — intención de producto.
- [`adr-motor-evaluacion.md`](../documentacion/adr-motor-evaluacion.md) — ADR-01:
  sustitución de la validación determinista, structured output, SSOT de schemas.
- [`adr-02-evaluacion-transporte-observabilidad.md`](../documentacion/adr-02-evaluacion-transporte-observabilidad.md)
  — ADR-02: motor aislado, endpoint dedicado, estados discretos y trazabilidad nativa.

| PR | Plan | Alcance | Estado | Depende de |
|----|------|---------|--------|-----------|
| PR-01 | [`pr-01-ssot-schemas/plan.md`](./pr-01-ssot-schemas/plan.md) | Consolidar los 34 schemas de artifact en `packages/shared` y vaciar la copia del server. Refactor sin cambio de comportamiento. | borrador | — |
| PR-1.5 | [`pr-1.5-sistema-visual/plan.md`](./pr-1.5-sistema-visual/plan.md) | Sistema visual del canvas de Claude Design: capa de tokens `@theme`, fuentes Geist, tema claro y repintado de los cuatro componentes. Deja `documentacion/design-system.md` como norma para todo PR posterior. | borrador | PR-01 |
| PR-12 | [`pr-12-fuga-tool-calls/plan.md`](./pr-12-fuga-tool-calls/plan.md) | Bug: el modelo escribe la tool call como texto y se renderiza al alumno. Observabilidad (`finishReason`, log por paso), detección y recuperación en el adaptador, timeouts de tools y partes nativas `functionCall`/`functionResponse`. | borrador | PR-01 |
| PR-12.2 | [`pr-12-2-tool-calls-estructural/plan.md`](./pr-12-2-tool-calls-estructural/plan.md) | Quita la causa: `renderMessage` emite `Prompt.ToolCallPart`/`ToolResultPart` en vez de prosa, `gemini.ts` los traduce a `functionCall`/`functionResponse` y se borran las tres regex. Más `mode: "ANY"` en el reintento, degradación en vez de rendición y log del request. Local a `packages/server`. | borrador | PR-12.1 |
| PR-09 | [`pr-09-materiales-upload/plan.md`](./pr-09-materiales-upload/plan.md) | Subida de PDFs desde la UI: `POST /api/materials` multipart, `MaterialRepository.create` y componente `PdfUploader` con drag & drop y progreso. | borrador | PR-01 |
| PR-12.1 | [`pr-12-1-fuga-tool-calls-reintento/plan.md`](./pr-12-1-fuga-tool-calls-reintento/plan.md) | El PR-12 no cerró el bug: `finishReason` como señal primaria, patrón de fuga corregido, reintento acotado dentro del adaptador y purga de sintaxis en texto de skills y prompt. | borrador | PR-12 |
| PR-13 | [`pr-13-ux-materiales-artefactos/plan.md`](./pr-13-ux-materiales-artefactos/plan.md) | Borrar materiales (`DELETE /api/materials/:id`), botón de cierre del artefacto para recuperar el chat completo, y renombrado del producto a My Favorite Teacher. | borrador | PR-09 |
| PR-10 | [`pr-10-chat-input-lifecycle/plan.md`](./pr-10-chat-input-lifecycle/plan.md) | Ciclo de vida del input del chat: limpieza inmediata, bloqueo durante la generación, botón Stop con `AbortController` y reintento con restauración del prompt. | borrador | PR-09 |
| PR-11 | [`pr-11-agente-cortocircuito/plan.md`](./pr-11-agente-cortocircuito/plan.md) | Latencia del agente: inventario de materiales en el system prompt, reglas de cortocircuito de herramientas, descripciones de skills más estrechas y `maxSteps` a 4. | borrador | PR-10 |
| PR-02 | [`pr-02-evidencia-pagina/plan.md`](./pr-02-evidencia-pagina/plan.md) | `pdftotext` en `PdfService`, `extractText` en el repositorio, `source`/`sourcePage` para enlazar pregunta→página, verificador de citas verbatim, comando `materials text`. | borrador | PR-01 |
| PR-03 | [`pr-03-structured-output/plan.md`](./pr-03-structured-output/plan.md) | `FinalFeedbackSchema` + `EnrichedFeedbackSchema` en shared, y `generationConfig`/`responseSchema` en `gemini.ts` para que `LanguageModel.generateObject` funcione contra Gemini. | borrador | PR-01 |
| PR-04 | [`pr-04-evaluation-engine/plan.md`](./pr-04-evaluation-engine/plan.md) | `EvaluationEngineService` aislado: 3 prompts, `Effect.all([bueno, malo], { concurrency: "unbounded", mode: "result" })`, Juez vía `generateObject`, citas enriquecidas a `PdfCitation` verificadas y `short-answer` evaluado por el panel. | borrador | PR-02, PR-03 |
| PR-05 | [`pr-05-transporte-ndjson/plan.md`](./pr-05-transporte-ndjson/plan.md) | Ruta `POST /api/artifacts/:id/submit/stream` con estados discretos, lector NDJSON resiliente compartido en web y cierre siempre con frame terminal. | borrador | PR-04 |
| PR-06 | [`pr-06-trazabilidad/plan.md`](./pr-06-trazabilidad/plan.md) | Trazabilidad nativa: log determinista en Markdown bajo `.data/sessions/`, escrito con `Effect.forkDetach` fuera del camino crítico. | borrador | PR-04 |
| PR-07 | [`pr-07-ui-observabilidad/plan.md`](./pr-07-ui-observabilidad/plan.md) | UI del `ArtifactWorkspace`: estado de evaluación en un atom, los dos profes activos a la vez, Juez después, y render del feedback con las citas y su badge de verificación. | borrador | PR-05 |
| PR-08 | [`pr-08-evals-entrega/plan.md`](./pr-08-evals-entrega/plan.md) | Evals deterministas sin API key (modelo falso + funciones puras), QA final y README de entrega. **No recortable.** | borrador | PR-07 |

Estados: `por diseñar` → `borrador` → `listo para implementar` → `en curso` → `mergeado`.

**Los PRs se implementan en orden estricto, uno detrás de otro.** El orden real es
**PR-01 → PR-1.5 → PR-12 → PR-12.1 → PR-12.2 → PR-09 → PR-13 → PR-10 → PR-11 → PR-02 → … → PR-08**: los PRs de UX se numeran 1.5, 09,
10 y 11 porque se añadieron después, pero se ejecutan al principio. El PR-1.5 va el
primero de todos ellos: fija los tokens de color y tipografía, y cualquier UI escrita antes
de él habría que repintarla. El PR-09 va a continuación porque quita
el paso manual de copiar un PDF dentro de `.data/` que hoy precede a la QA de casi todos
los demás, y el PR-10 reescribe `Chat.tsx` y `domain/tutor/stream.ts`, los mismos ficheros
que toca el Paso 6 del PR-05.

**Los ocho PRs del roadmap original se implementan en orden estricto, uno detrás de otro.** Ninguno va en
paralelo: PR-05 y PR-06 tocan los mismos ficheros (`domain/evaluation/engine.ts` y
`review.ts`), y PR-05, PR-06 y PR-04 se van encadenando sobre la firma de `evaluate`.

**Al citar la lista de límites duros de §9, hacerlo por su texto y nunca por su número**:
cada PR que elimina una entrada renumera las siguientes.

### Decisiones ya cerradas

No se vuelven a abrir. Si el doer cree que alguna es errónea, para y lo notifica.

1. **El motor vive aislado**, en `EvaluationEngineService`, no dentro de
   `TutorChatService` ni del bucle de tools del harness (ADR-02 §1).
2. **La UI se alimenta de un endpoint propio**, `POST /api/artifacts/:id/submit/stream`,
   para no contaminar el historial del chat (ADR-02 §1).
3. **Solo `short-answer` deja de corregirse de forma determinista.** Multiple-choice y
   true-false siguen comparando ids y booleanos (`artifact.ts:422-452`): es correcto,
   instantáneo, gratis y es la ruta de degradación cuando el LLM falla.
4. **`citas_pdf` sigue siendo `string[]` en el contrato del Juez** y el servidor lo
   enriquece a `PdfCitation` tras verificar cada cita verbatim contra el texto extraído.
5. **El SSOT de schemas va primero**, no al final: los PR-02, PR-03 y PR-04 escriben
   sobre esos mismos ficheros.
6. **Nada de streaming de tokens.** Solo estados discretos (ADR-02 §1).
7. **Nada de RAG, ni de observabilidad de terceros, ni de logging delegado a un LLM**
   (ADR-01 Decisión 1, ADR-02 §3).
8. **No se construye un servicio propio de structured output.** Effect v4 ya trae
   `LanguageModel.generateObject`, y `gemini.ts` ya está montado sobre
   `LanguageModel.make`: el adaptador solo tiene que honrar `options.responseFormat`.
   La decodificación y el error tipado (`AiError.InvalidOutputError`) los pone Effect.

### Timeline

Dos días de desarrollo: **lunes 7 y martes 8 de septiembre de 2026**.

| Día | PRs |
|-----|-----|
| Lunes | PR-01, PR-02, PR-03, PR-04 |
| Martes | PR-05, PR-06, PR-07, PR-08 |

Orden de recorte si el martes se tuerce, de lo primero que cae a lo último:
PR-06 (trazabilidad) → el resaltado de citas del PR-07, dejando solo los estados de fase.
El PR-08 no se recorta: sin evals ni README no hay entrega.

## 7. Contexto técnico obligatorio para el doer

Antes de tocar nada, el doer lee `documentacion/contexto-repo.md` (mapa de arquitectura y comandos) y
`AGENTS.md` (convenciones). Resumen de lo que más se incumple:

- **pnpm y Node**, nunca Bun ni APIs `Bun.*`.
- **Los contratos HTTP viven en `packages/shared`.** Cambiar un `Schema` allí
  rompe server y web a propósito: se arregla hacia fuera desde `shared`.
- Effect v4 **beta** (`4.0.0-beta.83`, pineado igual en todos los paquetes).
  Mucha API está bajo `effect/unstable/*`.
- `rewriteRelativeImportExtensions`: **los imports relativos llevan `.ts`**.
- No crear `packages/web/src/api/` — colisiona con el proxy de Vite
  (`root: "src"`). El cliente vive en `src/api-client/`.
- `packages/web/src/styles.generated.css` es generado: se edita `styles.input.css`.
- Persistencia: ficheros bajo `packages/server/.data/`. No se añade base de
  datos ni auth (`CHALLENGE.md` lo excluye explícitamente como mejora principal).
- El agente expone al modelo **solo dos tools**: `load_skill` y `cli`. Añadir
  capacidad = añadir comando CLI o skill, no una tool nueva.
- Si se añade una tool de modelo, hay que tocar `toolParameters` en
  `packages/server/src/domain/agents/gemini.ts` (schemas hardcodeados por nombre).

### Checks (no hay test runner)

```bash
pnpm run typecheck                            # gate principal
pnpm --filter @proxus/web run build
pnpm --filter @proxus/server run eval:tutor:artifact-authoring   # requiere API key
```

QA manual: `docs/testing.md`.

---

## 8. Plantilla obligatoria de un plan de PR

Todo `planes/pr-NN-<slug>/plan.md` tiene estas secciones, en este orden:

```markdown
# PR-NN — <título>

## Problema
Qué duele hoy, con evidencia en el código (rutas concretas).

## Objetivo
Qué queda distinto al terminar. Una frase.

## Fuera de alcance
Lo que explícitamente NO se toca en este PR.

## Contratos afectados
Cambios en `packages/shared` (schemas, endpoints). Antes/después.

## Pasos
1. [ ] Paso atómico, ficheros exactos, qué se escribe.
2. [ ] ...
   Cada paso: fichero(s), cambio, y cómo se comprueba.

## Criterio de aceptación
Lista verificable. Comportamiento observable, no "está implementado".

## Checks
Comandos exactos a ejecutar y resultado esperado.

## QA manual
Pasos en la UI / CLI para ver que funciona.

## Riesgos y decisiones
Trade-offs asumidos y por qué.

## Historial
Cambios al plan hechos por el thinker tras feedback del doer.
```

---

## 9. Estado del repositorio

- Base: template del challenge, funcional end-to-end (chat → agente → artifacts
  → resolver quiz).
- `CHALLENGE.md` pide una **evolución sustancial** de producto/arquitectura, no
  arreglos cosméticos. Los planes deben estar a esa altura.
- Dirección elegida: panel multi-agente con citas verificables (ver §6).

### Límites duros que el doer debe dar por ciertos

Verificados en el código. Están desarrollados en
[`documentacion/funcionamiento-actual.md`](../documentacion/funcionamiento-actual.md) §9.

1. **No hay extracción de texto de PDF.** Solo `pdfinfo` + `pdftoppm`. Sin eso no hay
   citas literales que verificar.
2. **No hay RAG**: ni chunking, ni embeddings, ni índice, ni búsqueda. Se cita por
   página.
3. **No hay salida estructurada**: `gemini.ts` nunca envía `generationConfig`, así que
   `responseMimeType` y `responseSchema` son inalcanzables hoy.
4. **`streamText` es `Stream.empty`**: no hay streaming de tokens. Solo eventos de
   mensaje completo. La UI muestra fases discretas, no texto token a token.
5. **El estado del chat no está en atoms**, está en `useState` dentro de `Chat.tsx`.
6. ~~El cliente NDJSON decodifica en estricto~~ **Eliminado desde PR-05**: `readNdjson`
   (`packages/web/src/lib/ndjson.ts`) envuelve cada línea en `try/catch` y salta la que no
   decodifica con un `console.warn`, en vez de reventar el generador entero.
7. **Los artifacts no guardan su material de origen.** Hay que añadir ese enlace para
   poder citar.
8. **No existe `packages/server/.data/`** en un checkout limpio: hay que colocar un PDF
   antes de que la QA manual signifique nada.

_(Eliminado desde PR-04: "la corrección es determinista y sin LLM". `short-answer`
ahora pasa por un panel multi-agente con citas verificadas; el `===` queda como ruta de
reserva cuando el panel no está disponible.)_
