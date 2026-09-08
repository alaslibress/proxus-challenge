# PR-03 — Structured output: contrato de evaluación y modo JSON nativo en Gemini

- **Rama**: `feat/structured-output`
- **Depende de**: PR-01 (SSOT). Usa `PdfCitation` del PR-02, pero puede ir en paralelo si ese schema ya está mergeado.
- **Bloquea a**: PR-04 (el Juez no puede existir sin contrato ni sin modo JSON).
- **Estado**: borrador
- **Contiene LLM**: sí, pero solo para verificar el adaptador. Aquí no hay prompts de producto ni agentes.
- **Origen**: [ADR-01, Decisión 2](../../documentacion/adr-motor-evaluacion.md) — *Habilitación de Structured Output*.

> Normas de trabajo en [`../plan.md`](../plan.md). Contexto técnico obligatorio en
> [`../../documentacion/contexto-repo.md`](../../documentacion/contexto-repo.md) y
> [`../../documentacion/funcionamiento-actual.md`](../../documentacion/funcionamiento-actual.md).
> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.

---

## Problema

El Juez debe devolver una estructura predecible. Hoy es imposible: `requestBody` en
`packages/server/src/domain/agents/gemini.ts:205-210` envía exactamente cuatro campos
—`systemInstruction`, `contents`, `tools`, `toolConfig`— y **ningún `generationConfig`**.
Sin él no se puede pedir `responseMimeType: "application/json"` ni `responseSchema`, así
que la única salida del modelo es texto libre.

Hay un segundo hecho, y este cambia el diseño del PR entero: **Effect v4 beta ya trae
generación de objetos estructurados, y el adaptador del repo ya está construido sobre la
API que la soporta.**

- `LanguageModel.make({ generateText, streamText, codecTransformer? })` devuelve un
  servicio que implementa `generateText`, `generateObject` **y** `streamText`
  (`effect/dist/unstable/ai/LanguageModel.d.ts:478`).
- `gemini.ts:265` ya llama a `LanguageModel.make`. Lo que hace es **ignorar
  `options.responseFormat`**, que es el campo por el que `generateObject` le dice al
  proveedor que quiere JSON conforme a un schema
  (`LanguageModel.d.ts:410-415`).
- `generateObject` prepara para el hook del proveedor: `tools: []`,
  `toolChoice: "none"` y `responseFormat: { type: "json", objectName, schema }` con el
  `Schema` **sin transformar** (`LanguageModel.js:280-302`). Después decodifica la
  respuesta con el `codecTransformer` y, si el modelo se inventa la estructura, falla con
  `AiError.InvalidOutputError` (`LanguageModel.js:318-323`).

Conclusión: no hace falta inventarse un servicio de structured output ni un bucle de
reparación. **Basta con que el adaptador de Gemini honre `responseFormat`.** El resto
—decodificación, validación y error tipado— ya lo hace Effect.

Nota sobre el enunciado del PR: no hay hoy "parseos frágiles con expresiones regulares"
que eliminar. Lo que hay es la ausencia total de salida estructurada. El objetivo se
cumple igual, pero conviene que la descripción del PR no prometa borrar código que no
existe.

## Objetivo

Que `LanguageModel.generateObject` funcione contra Gemini con validación tipada de la
salida, y que el contrato de evaluación exista en `packages/shared`.

## Fuera de alcance

- Los tres prompts, el `EvaluationEngineService`, `Effect.all` y el Juez. Eso es PR-04.
- Tocar `gradeAttempt` o la corrección de `short-answer`.
- El endpoint NDJSON, la trazabilidad y `packages/web`.
- Implementar `streamText` de verdad. Sigue siendo `Stream.empty` y así se queda:
  el ADR-02 ya decidió que la UI muestra estados discretos, no tokens.
- Tocar `toolParameters` (`gemini.ts:124-154`) y su `default` de `{a, b}`. No aplica:
  `generateObject` fuerza `tools: []`, así que en modo JSON no se declara ninguna tool.

## Contratos afectados

### Nuevo fichero: `packages/shared/src/schemas/evaluation.ts`

```ts
import { Schema } from "effect";
import { PdfCitation } from "./citation.ts";

/** Contrato estricto de la respuesta del Juez. Lo que el LLM debe producir. */
export const FinalFeedbackSchema = Schema.Struct({
  is_correct: Schema.Boolean,
  feedback: Schema.String,
  citas_pdf: Schema.Array(Schema.String)
});
export type FinalFeedbackSchema = typeof FinalFeedbackSchema.Type;

/** Contrato enriquecido que consume la UI, tras verificar cada cita en servidor. */
export const EnrichedFeedbackSchema = Schema.Struct({
  is_correct: Schema.Boolean,
  feedback: Schema.String,
  citas_pdf: Schema.Array(PdfCitation)
});
export type EnrichedFeedbackSchema = typeof EnrichedFeedbackSchema.Type;
```

Dos decisiones sobre la forma que se pidió en el enunciado:

- **`citas_pdf` de `EnrichedFeedbackSchema` reutiliza `PdfCitation`** en lugar de repetir
  `{ quote, materialId, page, verified }` inline, tal como pide la especificación. Ya
  existe desde el PR-02. Si el PR-02 no está mergeado, este PR crea
  `packages/shared/src/schemas/citation.ts` con solo `PdfCitation` y el PR-02 lo amplía.
- **La ruta del import es `"./citation.ts"`, no `"./artifact"`.** Dos correcciones sobre
  la especificación: `PdfCitation` vive en `citation.ts` (el PR-02 lo puso ahí, no en
  `artifact.ts`), y **los imports relativos de este repo llevan siempre la extensión
  `.ts`** por `rewriteRelativeImportExtensions` (`tsconfig.json:9`). Un
  `from "./artifact"` no compila.
- **`snake_case` en `is_correct` y `citas_pdf` se respeta tal cual.** Chirría contra el
  `camelCase` del resto del repo, pero es el contrato que fija el ADR-01 y es el nombre
  que ve el modelo en el JSON Schema. Cambiarlo aquí sería una decisión de producto que
  este PR no tiene por qué tomar.

Exportar el fichero desde `packages/shared/src/index.ts`, manteniendo el orden alfabético.

### Sin cambios de contrato HTTP

`EnrichedFeedbackSchema` todavía no se cuelga de ningún endpoint. Eso pasa en el PR-05,
cuando exista la ruta de streaming que lo emite.

## Pasos

Cada paso deja el repo compilando. `pnpm run typecheck` al terminar cada uno.

### Paso 1 — Schemas del contrato

- [ ] Crear `packages/shared/src/schemas/evaluation.ts` con los dos schemas de arriba.
- [ ] Añadir `export * from "./schemas/evaluation.ts";` a `packages/shared/src/index.ts`.

Comprobación: `pnpm --filter @proxus/shared run typecheck`.

### Paso 2 — Derivar y sanear el JSON Schema para Gemini

Gemini **no acepta un JSON Schema completo** en `responseSchema`: solo un subconjunto
tipo OpenAPI (`type`, `format`, `description`, `nullable`, `enum`, `items`, `properties`,
`required`, `propertyOrdering`, `anyOf`, `minItems`/`maxItems`). Rechaza `$schema`,
`$defs`, `$ref` y `additionalProperties`. Effect emite varios de esos.

> **Corrección importante sobre la especificación.** El enunciado pide purgar `$ref`
> junto con `$defs`. **Purgar no es resolver, y hacerlo en ese orden destruye el schema.**
> `Schema.toJsonSchemaDocument` devuelve un `Document = { dialect, schema, definitions }`
> (`JsonSchema.d.ts:113-117`), y su `schema` puede ser literalmente
> `{ "$ref": "#/$defs/FinalFeedback" }` con el cuerpo real en `definitions`. Si se borran
> `$ref` y `$defs` a la vez, a Gemini le llega `{}`. **Primero se resuelven las
> referencias, después se purga.** Para `FinalFeedbackSchema` —booleano, string y array de
> strings— probablemente no haya ni un `$ref`, pero el orden correcto no cuesta nada y
> evita que el PR-04 se rompa el día que el Juez tenga un schema anidado.

- [ ] Crear `packages/server/src/domain/agents/gemini-schema.ts` con **dos funciones
      puras**, sin Effect, para que la eval del PR-08 las pruebe sin API key:

```ts
import { JsonSchema } from "effect";

/** Inlinea el $ref de nivel superior y los anidados usando las definitions. */
export const resolveAllRefs = (
  document: JsonSchema.Document<"draft-2020-12">
): JsonSchema.JsonSchema => { ... };

/** Purga las claves que la API de Gemini rechaza. Firma tal como fija la spec. */
export const toGeminiResponseSchema = (schema: unknown): unknown => { ... };
```

`resolveAllRefs`:

1. `JsonSchema.resolveTopLevel$ref(document)` para la referencia raíz
   (`JsonSchema.d.ts:489`).
2. Recorrer el árbol y sustituir cada `{ $ref }` restante por
   `JsonSchema.resolve$ref($ref, document.definitions)` (`:453`).
3. Cortar en referencias cíclicas: si un `$ref` ya está en la pila de resolución, lanzar
   en vez de colgarse. Un schema recursivo no es representable en `responseSchema` y es
   mejor enterarse en el acto que con un 400 de Google.

`toGeminiResponseSchema`: recorrido recursivo que elimina `$schema`, `$defs`, `$ref`,
`additionalProperties`, `definitions`, `title` y `examples`, y devuelve el objeto plano.

- [ ] El orden de llamada, que vive en el adaptador y no en `shared`:

```ts
const document = Schema.toJsonSchemaDocument(schema, { additionalProperties: false });
const responseSchema = toGeminiResponseSchema(resolveAllRefs(document));
```

**La derivación se hace en el server, no en `packages/shared`.** La especificación la
coloca en la sección de contratos, pero `shared` no puede saber qué acepta Gemini: es la
capa que comparten web y server, y meterle una dependencia de proveedor rompería la
dirección `web → shared ← server`.

### Paso 3 — Honrar `responseFormat` en el adaptador

En `packages/server/src/domain/agents/gemini.ts`:

- [ ] Añadir un helper que construya el `generationConfig`:

```ts
const generationConfig = (options: LanguageModel.ProviderOptions) =>
  options.responseFormat.type === "json"
    ? {
        responseMimeType: "application/json",
        responseSchema: toGeminiResponseSchema(options.responseFormat.schema)
      }
    : undefined;
```

- [ ] Añadir `generationConfig: generationConfig(options)` al objeto de `requestBody`
      (`:205-210`). Si es `undefined`, `JSON.stringify` lo omite y la petición queda
      exactamente igual que hoy: **la ruta de texto no cambia en absoluto.**
- [ ] No hace falta tocar `geminiTools` ni `toolConfig`: en modo JSON `generateObject` ya
      pasa `tools: []` y `toolChoice: "none"` (`LanguageModel.js:292-293`), así que ambos
      helpers devuelven `undefined` por su cuenta.

### Paso 4 — `codecTransformer`

`LanguageModel.make` usa `defaultCodecTransformer` cuando no se le pasa otro
(`LanguageModel.js:248`). Ese transformador resuelve el `$ref` de nivel superior y copia
las definiciones a `$defs`, y en `generateObject` **solo se usa para decodificar**, no
para construir la petición (`LanguageModel.js:308-316`).

- [ ] Dejar el `defaultCodecTransformer`, es decir, **no pasar `codecTransformer`**.
      `FinalFeedbackSchema` no tiene tuplas, ni `Record`, ni uniones raras: no necesita la
      reescritura provider-específica que sí hacen `OpenAiStructuredOutput.toCodecOpenAI`
      o el equivalente de Anthropic.
- [ ] Si el paso 6 revelara un desajuste de decodificación, entonces —y solo entonces— se
      escribe `toCodecGoogle` siguiendo la firma de `LanguageModel.CodecTransformer`
      (`LanguageModel.d.ts:99-102`): `(schema) => ({ codec, jsonSchema })`. El doer para y
      lo notifica antes de escribirlo.

### Paso 5 — Script de verificación manual

- [ ] Crear `packages/server/src/domain/agents/structured-output.check.ts`, un script
      pequeño en la línea de `academic-tutor.ts`, que llame a
      `LanguageModel.generateObject({ schema: FinalFeedbackSchema, prompt: "..." })`
      contra Gemini y escriba el resultado por consola.
- [ ] Añadir el script a `packages/server/package.json` con el nombre
      **`structured-output:check`**, que es el que usa la sección de Checks de este plan,
      siguiendo el patrón exacto de los existentes:
      `node --env-file=../../.env --import tsx <fichero>`.
- [ ] El prompt de prueba debe forzar los tres campos, por ejemplo: *"El alumno respondió
      'la media es 4'. El texto dice 'la media aritmética es 4'. Evalúa."*

### Paso 6 — Smoke test contra la API real (obligatorio antes de mergear)

Esto no es opcional y es la condición de merge que fija la especificación: el subconjunto
de `responseSchema` que acepta Gemini no está garantizado por ningún tipo y solo se
comprueba llamando.

- [ ] Ejecutar el script del paso 5. Debe devolver un objeto ya decodificado con
      `is_correct`, `feedback` y `citas_pdf`.
- [ ] Si la API responde 400, el fallo casi seguro está en el paso 2: registrar el
      `responseSchema` enviado, comparar con el mensaje de error y ajustar. Si lo enviado
      es `{}` o casi vacío, el problema es de resolución de `$ref`, no de purga.
- [ ] Comprobar que la ruta de texto **no se ha roto**: `agent:tutor "lista mis materiales"`
      debe seguir funcionando igual, con sus tool calls.

### Paso 7 — Documentación

- [ ] `documentacion/funcionamiento-actual.md` §6: el límite nº2 ("el cuerpo de la
      petición no incluye `generationConfig`") deja de ser cierto. Actualizarlo y también
      la fila correspondiente de la tabla §9.
- [ ] `planes/plan.md` §9: quitar el límite duro **"No hay salida estructurada"**.
      Referenciar por texto y no por número: la lista se renumera cada vez que un PR
      elimina una entrada.
- [ ] `docs/ai-agent.md`: documentar el modo JSON y el script nuevo.

## Criterio de aceptación

1. `LanguageModel.generateObject({ schema: FinalFeedbackSchema, ... })` devuelve un valor
   ya tipado, sin `JSON.parse` a mano en ningún punto del código nuevo.
2. Cuando el modelo devuelve algo que no encaja, el fallo es un
   `AiError.InvalidOutputError` tipado en el canal de error de Effect, no una excepción.
3. La petición HTTP a Gemini incluye `generationConfig.responseMimeType: "application/json"`
   y un `responseSchema` **sin** `$schema`, `$defs`, `$ref` ni `additionalProperties`.
4. Un schema con `$ref` a `definitions` produce un `responseSchema` con el cuerpo
   **inlineado**, no un objeto vacío. Se comprueba con un `Schema.Struct` anidado, aunque
   `FinalFeedbackSchema` no lo necesite.
5. En modo texto, el cuerpo de la petición es **byte a byte idéntico** al de antes del PR.
6. `resolveAllRefs` y `toGeminiResponseSchema` son puras y se llaman sin layers ni API key.
7. El smoke test contra la API real de Google pasa. **Obligatorio antes de mergear**: el
   subconjunto de `responseSchema` no lo garantiza ningún tipo.
8. El flujo de chat del tutor sigue funcionando igual, con tools incluidas.
9. `pnpm run typecheck` y el build de web en verde.

## Checks

```bash
pnpm run typecheck
pnpm --filter @proxus/web run build
pnpm --filter @proxus/server run structured-output:check      # script del paso 5
pnpm --filter @proxus/server run agent:tutor "lista mis materiales"
pnpm --filter @proxus/server run eval:tutor:artifact-authoring
```

## QA manual

1. Ejecutar el script del paso 5 y comprobar que la salida es un objeto con los tres
   campos y tipos correctos.
2. Cambiar temporalmente el prompt para pedirle al modelo que responda en prosa e ignore
   el formato. La llamada debe fallar con `InvalidOutputError`, **no** colgarse ni
   devolver basura sin validar.
3. `pnpm run dev`, abrir la web, pedir un quiz al tutor y resolverlo. Todo debe comportarse
   exactamente igual que antes: este PR no toca el camino de producto.

## Riesgos y decisiones

- **Riesgo principal: el subconjunto de `responseSchema`.** Es la única parte que no
  garantiza el compilador. Por eso el paso 6 obliga a llamar a la API de verdad y el
  saneado vive en una función pura y aislada, fácil de ajustar sin tocar el adaptador.
- **Decisión: no se escribe un servicio de structured output propio.** El roadmap anterior
  contemplaba un `StructuredModel` con reintento de reparación. Se descarta:
  `generateObject` ya existe, ya decodifica y ya produce un error tipado. Añadir una capa
  encima sería reimplementar la librería, y en una prueba técnica sobre Effect eso puntúa
  en contra, no a favor.
- **Decisión: nada de reintento de reparación en este PR.** Con `responseSchema` nativo,
  el modelo devuelve JSON conforme por construcción; reintentar tiene sentido como
  política del motor, no del adaptador. Si el PR-04 lo necesita, lo pone donde debe estar:
  envolviendo la llamada, no dentro del proveedor.
- **`snake_case` en el contrato.** Se mantiene `is_correct` / `citas_pdf` porque lo fija
  el ADR-01 y porque es lo que lee el modelo. Si más adelante molesta en la UI, se resuelve
  con un `Schema` de transformación en la frontera, no renombrando el contrato.
- **`streamText` sigue siendo `Stream.empty`.** No es descuido: el ADR-02 decidió estados
  discretos. Queda anotado en el README de entrega como limitación conocida y próximo paso.
- **Deuda que este PR no toca**: `toolParameters` (`gemini.ts:124-154`) sigue con sus
  esquemas hardcodeados por nombre de tool y el `default` de `{a, b}`. No estorba aquí
  porque el modo JSON no declara tools, pero sigue siendo una trampa para cualquiera que
  añada una tool al harness. Va al README.

## Historial

_Sin cambios todavía. El thinker anota aquí cualquier corrección al plan que venga del
doer, con fecha y motivo._
