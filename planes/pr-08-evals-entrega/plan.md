# PR-08 — Evals del panel, QA y README de entrega

- **Rama**: `feat/evals-entrega`
- **Depende de**: PR-02, PR-03, PR-04, PR-06. El PR-07 solo para la QA final.
- **Bloquea a**: nada. Es el último.
- **Estado**: borrador
- **Contiene LLM**: **no**. Las evals nuevas corren sin API key: ese es medio objetivo del PR.
- **Origen**: [Tech Spec §5 (Testing LLM) y §6 Fase 4](../../documentacion/tech-spec.md), y `CHALLENGE.md` — *Cómo entregar*.

> Normas de trabajo en [`../plan.md`](../plan.md). Contexto técnico obligatorio en
> [`../../documentacion/contexto-repo.md`](../../documentacion/contexto-repo.md) y
> [`../../documentacion/funcionamiento-actual.md`](../../documentacion/funcionamiento-actual.md).
> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.
>
> **Este PR no es recortable.** Sin evals ni README no hay entrega: `CHALLENGE.md` evalúa
> explícitamente *"capacidad de evaluación"* y *"comunicación"*.

---

## Problema

Tras el PR-07 el producto funciona, pero no hay forma de demostrar que **no miente**. La
Tech Spec §5 exige validaciones a nivel de código para tres cosas concretas: que el LLM
responde con la estructura JSON requerida, que `citas_pdf` existe y no está vacío cuando
hay correcciones, y que un fallo del LLM no tumba el servidor.

La única eval que existe (`domain/agents/academic-tutor/evals/artifact-authoring.eval.ts`,
473 líneas) **llama a Gemini de verdad**: `makeEvalLayer` (`:288-292`) mete
`GeminiModel` directamente, así que sin API key no se ejecuta, cuesta dinero, y su
resultado depende de lo que decida el modelo ese día. Sirve para comprobar que el tutor
sabe crear artifacts; **no sirve para garantizar comportamiento**.

Y falta lo que `CHALLENGE.md` pide entregar: qué problema se eligió, cómo se resolvió, cómo
probarlo, qué checks se ejecutaron y qué vendría después.

## Objetivo

Que existan evals **deterministas y sin API key** que demuestren las garantías del sistema,
y un README que explique las decisiones de principio a fin.

## Fuera de alcance

- Introducir vitest, jest o cualquier runner. El repo no tiene ninguno y meterlo el último
  día es exactamente el *"framework nuevo sin razón fuerte"* que `CHALLENGE.md` desaconseja.
  Se sigue el patrón de script Effect que ya existe.
- Refactorizar `artifact-authoring.eval.ts`. Su `criteria` es un `const` de módulo
  compartido por todos los casos (`:391-395`): meterle criterios por caso es un refactor
  con riesgo y sin premio. La eval nueva nace con su propio mecanismo.
- Medir si el Juez es "listo". Eso depende del modelo. Lo que se mide es que **el sistema
  no se rompe ni miente** cuando el Juez se equivoca.
- Cambios de producto. Si una eval descubre un fallo real, se anota y se arregla en su PR.

## Arquitectura de las evals

Dos niveles, y el primero es el que más valor da por línea escrita:

**1. Funciones puras — sin modelo, sin layers, sin disco.** Todo el roadmap se diseñó
poniendo la lógica crítica en funciones puras precisamente para esto:

| Función | Origen |
|---|---|
| `verifyQuote`, `verifyCitations`, `normalizeForMatch` | PR-02 |
| `resolveAllRefs`, `toGeminiResponseSchema` | PR-03 |
| `formatTraceEntry` | PR-06 |

**2. El panel completo con un `LanguageModel` falso.** Aquí está la pieza nueva.

`generateObject` no habla con ningún proveedor: concatena las partes de tipo `text` de la
respuesta y las decodifica con `Schema.fromJsonString(schema)`
(`LanguageModel.js:1109-1133`). Así que un modelo falso solo tiene que devolver
`[{ type: "text", text: "<json>" }]`. Eso hace posible guionizar respuestas exactas
—incluidas las malas— y comprobar qué hace el sistema con ellas.

## Pasos

### Paso 1 — `LanguageModel` falso

- [ ] Crear `packages/server/src/domain/evaluation/evals/test-language-model.ts`:

```ts
export interface ScriptedResponse {
  readonly kind: "text" | "fail";
  readonly text?: string;
}

/** Devuelve las respuestas en orden; agotado el guion, repite la última. */
export const TestLanguageModel = (script: readonly ScriptedResponse[]) =>
  Layer.effect(LanguageModel.LanguageModel, LanguageModel.make({
    generateText: (options) => /* consume el guion; "fail" produce un AiError */,
    streamText: () => Stream.empty
  }));
```

- [ ] Llevar la cuenta con un `Ref`, igual que hace `ArtifactRepositoryTestRef`
      (`artifact-authoring.eval.ts:113-125`).
- [ ] `streamText: () => Stream.empty`, exactamente como el adaptador real
      (`gemini.ts:285`). El falso no debe ser más capaz que el de verdad.
- [ ] El guion se consume en el orden en que el panel llama: **Profe Bueno, Profe Malo,
      Juez**. Como los dos profes corren con `concurrency: "unbounded"`, el orden entre
      ellos no está garantizado: por eso en los casos donde importe, **los dos profes deben
      tener respuestas intercambiables**. Anotarlo en el fichero.

### Paso 2 — Repositorio de materiales de prueba

- [ ] Un `MaterialRepository` falso que sirva `extractText` desde un texto fijo, siguiendo
      `makeMaterialRepository(fixtures)` (`artifact-authoring.eval.ts:249-278`).
- [ ] **Aprovechar `MaterialPageFixture.text`, que ya existe y hoy no lo usa nadie**
      (`:36`). El repo actual lo codifica en base64 y lo hace pasar por un PNG (`:263-270`)
      porque no había canal de texto. Con el PR-02 sí lo hay: este es el canal para el que
      ese campo se creó.

### Paso 3 — Eval del panel

- [ ] Crear `packages/server/src/domain/evaluation/evals/feedback-panel.eval.ts`,
      copiando la estructura de la eval existente: schemas de caso y de informe,
      `runEvalCase`, `runDataset`, `formatReport` con `✓`/`✗`, guarda
      `if (import.meta.main)` y fallo final con un `Data.TaggedError` propio para que el
      **código de salida sea distinto de cero**.
- [ ] **Criterios por caso**, no globales: cada caso declara qué espera. Es la diferencia
      con la eval de authoring y lo que permite tener casos de fallo.
- [ ] Script `eval:panel` en `packages/server/package.json`, **sin `--env-file`**:
      `node --import tsx <fichero>`.

> **Trampa verificada.** `node --env-file=<fichero>` **aborta si el fichero no existe**
> (`node: .env: not found`), así que copiar el patrón de los scripts existentes haría
> imposible el criterio de aceptación nº1 de este mismo plan. Las evals deterministas no
> leen configuración: van sin la bandera. Si en algún momento hiciera falta, la
> alternativa es `--env-file-if-exists`, disponible en el Node de este proyecto.

**Los casos. Los tres primeros son literalmente los que exige la Tech Spec §5:**

| # | Caso | Guion | Se espera |
|---|------|-------|-----------|
| 1 | `judge-returns-valid-structure` | Juez devuelve JSON válido con una cita literal del texto | Review presente, `is_correct` respetado, una cita `verified: true` |
| 2 | `citations-not-empty-when-corrections` | Juez devuelve `citas_pdf: []` | Se detecta: no hay cita verificada → **la nota no se modifica** |
| 3 | `llm-failure-does-not-crash` | Juez falla | La corrección determinista se conserva; el efecto **no falla** |
| 4 | `malformed-json-is-rejected` | Juez devuelve prosa, no JSON | `AiError.StructuredOutputError`; sin review; nota determinista |
| 5 | `hallucinated-citation-is-flagged` | Cita que no está en el texto | Llega con `verified: false` y **no altera la nota** |
| 6 | `paraphrase-is-upgraded` | Paráfrasis correcta + cita literal | La nota **sube** respecto al `===` determinista |
| 7 | `one-teacher-down-still-works` | Profe Bueno falla, Malo y Juez responden | Hay review; el panel no se cae |
| 8 | `both-teachers-down-still-works` | Los dos profes fallan, Juez responde | Hay review |
| 9 | `no-evidence-skips-panel` | Pregunta sin `sourcePage` ni `source` | No se llama al modelo; nota determinista |

Los casos 5 y 6 son el corazón: **el 6 demuestra el valor de producto y el 5 demuestra que
ese valor no se compra a cambio de tragarse invenciones.**

### Paso 4 — Evals de funciones puras

- [ ] `packages/server/src/domain/evaluation/evals/pure.eval.ts`, mismo formato de informe,
      cubriendo:
      - `verifyQuote`: cita literal ✓; cita inventada ✗; cita partida por salto de línea ✓;
        cita con guión de corte ✓; cita de menos de `MIN_QUOTE_LENGTH` ✗ aunque aparezca;
        diferencias de acentos y mayúsculas ✓.
      - `verifyCitations`: devuelve **un elemento por cada string de entrada**, ninguno
        descartado.
      - `resolveAllRefs` + `toGeminiResponseSchema`: un schema con `$ref` a `definitions`
        produce el cuerpo **inlineado**, y el resultado no contiene `$schema`, `$defs`,
        `$ref` ni `additionalProperties`.
      - `formatTraceEntry`: con un profe caído aparece `_No disponible_`; el texto de
        evidencia se trunca; las citas salen entrecomilladas con su marca.
- [ ] Script `eval:pure` en `package.json`, **sin `--env-file`** por el mismo motivo que
      `eval:panel`. Es el que puede ejecutar sin API key quien evalúe la prueba.

### Paso 5 — README de entrega

Reescribir `README.md`. `CHALLENGE.md` pide cinco cosas concretas y el README debe
responderlas en este orden:

1. **Qué problema elegí.** La corrección de respuestas cortas por igualdad exacta de
   strings (`artifact.ts:463`): un alumno que parafrasea saca cero. Y el riesgo obvio de
   arreglarlo con un LLM: que el tutor se invente la justificación.
2. **Cómo lo resolví.** Panel de tres agentes con los dos profes concurrentes vía
   `Effect.all`, Juez con salida estructurada, y **verificación literal de cada cita contra
   el texto extraído del PDF**. Incluir el diagrama del flujo.
3. **Cómo probarlo manualmente.** Los pasos exactos, empezando por *colocar un PDF en
   `packages/server/.data/materials/pdfs/`*, que no existe en un checkout limpio y sin lo
   cual nada funciona.
4. **Qué checks ejecuté.** Los comandos y su resultado real. Si algo no se pudo probar por
   falta de API key, **decirlo explícitamente**: `docs/testing.md` ya lo pide.
5. **Qué haría después.**

Y tres secciones más que el README debe llevar porque `CHALLENGE.md` valora que se puedan
explicar las decisiones de principio a fin:

- **Trade-offs**, con las decisiones incómodas dichas en voz alta:
  - Por qué el scoring determinista sigue siendo la fuente de verdad y el panel va encima
    (degradación estructural, no `try/catch`).
  - Por qué el `===` sobrevive como ruta de reserva pese a que el ADR pedía eliminarlo.
  - Por qué se cita por página y no con RAG.
  - Por qué se evalúa pregunta a pregunta pese a multiplicar las llamadas.
  - Por qué no se construyó un servicio de structured output: `generateObject` ya existía.
- **Dónde mirar para auditar**: `packages/server/.data/sessions/<attemptId>.md`. **Es lo
  primero que va a abrir quien evalúe la prueba y hay que decírselo.**
- **Limitaciones conocidas**, sin adornos:
  - `streamText` es `Stream.empty`: no hay streaming de tokens, solo estados discretos.
  - Las rutas de streaming no salen en OpenAPI ni en el cliente tipado.
  - PDFs escaneados sin capa de texto: no se puede citar; el sistema lo dice y degrada.
  - `AgentMessage` sigue duplicado entre `shared/schemas/agent-message.ts` y
    `harness/message.ts`.
  - `toolParameters` (`gemini.ts:124-154`) hardcodea esquemas por nombre de tool con un
    `default` de `{a, b}`: añadir una tool al harness sin tocarlo la rompe.
  - `packages/ai-google` es dependencia declarada del server y no la importa nadie.
  - `ArtifactDetail` y `Sidebar` solo tratan `onInitial`: un refresco en segundo plano
    muestra datos viejos sin avisar.

### Paso 6 — Cierre de documentación

- [ ] `docs/testing.md`: añadir los dos comandos de eval nuevos y la QA del panel.
- [ ] `documentacion/funcionamiento-actual.md` §8: ya no es cierto que no exista modelo
      falso ni que las evals necesiten API key. Revisar además que las tablas §9 y la
      lista de límites duros de `planes/plan.md` §9 reflejen el estado final tras los ocho
      PRs.
- [ ] `planes/plan.md` §6: marcar los ocho planes como `mergeado`.

### Paso 7 — QA final completa

- [ ] Ejecutar `docs/testing.md` de principio a fin sobre un checkout limpio, con
      `pnpm install` incluido, y anotar los resultados **reales** en el README.
- [ ] Probar el arranque sin `pdftotext` en el PATH: debe fallar rápido con mensaje claro.
- [ ] Probar con `GEMINI_MODEL` inexistente: el producto degrada, no se rompe.

## Criterio de aceptación

1. `pnpm --filter @proxus/server run eval:pure` pasa **sin fichero `.env` y sin API key**.
2. `pnpm --filter @proxus/server run eval:panel` pasa sin API key y **sin ninguna llamada
   de red**.
3. Los nueve casos del paso 3 existen y cada uno declara sus propios criterios.
4. Rompiendo a propósito la regla de "solo sube la nota con cita verificada", **falla el
   caso 5**. Una eval que no puede fallar no vale nada: hay que comprobarlo.
5. Ambas evals salen con código distinto de cero cuando falla un caso.
6. `pnpm --filter @proxus/server run eval:tutor:artifact-authoring` sigue pasando con API
   key: no se ha roto nada de lo que había.
7. El README responde las cinco preguntas de `CHALLENGE.md`, con los comandos y sus
   resultados reales.
8. El README lista las limitaciones conocidas de arriba, sin omitir ninguna.
9. Un lector que no conozca el repo puede, siguiendo solo el README, dejar el sistema
   funcionando y ver una cita verificada.
10. `pnpm run typecheck` y el build de web en verde.

## Checks

```bash
pnpm run typecheck
pnpm --filter @proxus/web run build
pnpm --filter @proxus/server run eval:pure     # sin API key
pnpm --filter @proxus/server run eval:panel    # sin API key
pnpm --filter @proxus/server run eval:tutor:artifact-authoring   # requiere API key
```

## QA manual

1. `git clone` limpio en otro directorio, `pnpm install`, **sin crear `.env`**.
2. `eval:pure` y `eval:panel` deben pasar igualmente. Si piden la key, el paso 1 del
   criterio de aceptación ha fallado.
3. Crear `.env`, colocar un PDF con capa de texto y ejecutar la QA completa de
   `docs/testing.md`.
4. Leer el README **como si no se conociera el proyecto** y seguirlo al pie de la letra. Si
   algún paso obliga a abrir el código para entenderlo, reescribir ese paso.
5. Abrir una traza de `.data/sessions/` y confirmar que se entiende sin ayuda.

## Riesgos y decisiones

- **El orden entre los dos profes no es determinista.** Corren con
  `concurrency: "unbounded"`, así que el guion del modelo falso no puede asumir cuál
  consume primero. En los casos donde importe, las dos respuestas deben ser
  intercambiables. Es la trampa más probable de este PR y sale como test intermitente,
  que es la peor forma de descubrirla.
- **Un modelo falso prueba el sistema, no el prompt.** Estas evals garantizan que ante una
  respuesta X del Juez el sistema hace Y. No dicen nada sobre si los prompts son buenos:
  eso solo lo dice `panel:check` contra Gemini de verdad, y es manual. Hay que escribirlo
  en el README para no vender más de lo que hay.
- **Criterio 4 es incómodo y por eso está.** Hay que romper el código a propósito y
  comprobar que la eval se pone roja. Una suite que pasa siempre da falsa seguridad, que es
  peor que no tenerla.
- **El README es la mitad del valor de este PR.** `CHALLENGE.md` puntúa la comunicación al
  mismo nivel que el código, y `docs/testing.md` ya avisa de que hay que reportar checks y
  limitaciones. Escribir limitaciones reales —incluidas las feas, como `toolParameters` o
  el `AgentMessage` duplicado— demuestra que se conoce el sistema; ocultarlas se nota.
- **Presupuesto.** Este PR cae el martes por la tarde, que es cuando se va el tiempo. Si
  hay que recortar **dentro** del PR, el orden es: primero `eval:pure` (barata y cubre las
  garantías centrales), después el README, y por último los casos 7, 8 y 9 del panel. Lo
  que no se recorta es el README: sin él la entrega está incompleta por definición.

## Historial

_Sin cambios todavía. El thinker anota aquí cualquier corrección al plan que venga del
doer, con fecha y motivo._
