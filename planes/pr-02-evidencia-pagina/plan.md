# PR-02 — Evidencia por página: texto extraíble y citas verificables

- **Rama**: `feat/evidencia-pagina`
- **Depende de**: PR-01 (SSOT de schemas). Sin él habría que editar dos copias.
- **Bloquea a**: PR-04 (el motor necesita el texto y el verificador).
- **Estado**: borrador
- **Contiene LLM**: no. En este PR no se llama a Gemini ni una vez.
- **Origen**: [ADR-01, Decisión 1](../../documentacion/adr-motor-evaluacion.md) — *Evaluación Semántica por Página*, y la nota del thinker nº1 del mismo documento.

> Normas de trabajo en [`../plan.md`](../plan.md). Contexto técnico obligatorio en
> [`../../documentacion/contexto-repo.md`](../../documentacion/contexto-repo.md) y
> [`../../documentacion/funcionamiento-actual.md`](../../documentacion/funcionamiento-actual.md).
> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.

---

## Problema

El ADR-01 decide evaluar al alumno enviando al LLM *"el texto extraído de la página
específica asociada a la pregunta"*, y exige que el Juez devuelva `citas_pdf` con
extractos literales. Nada de eso es posible hoy, por tres razones independientes:

1. **No existe extracción de texto.** El ADR asume que `pdfinfo + pdftoppm` extraen
   contexto a nivel de página; lo que hacen es **rasterizar la página a PNG**.
   `PdfService` tiene exactamente dos métodos, `pageCount` y `renderPage`
   (`packages/server/src/domain/materials/pdf-service.ts:8-15`), y la implementación
   Poppler solo exige `pdfinfo` y `pdftoppm`
   (`packages/server/src/infra/materials/poppler-pdf-service.ts:25-26`). Lo único que el
   modelo recibe de un PDF es un PNG a 144dpi inyectado como parte `file`
   (`domain/agents/harness/session.ts:173-190`).

2. **No existe "la página asociada a la pregunta".** Ni los artifacts ni las preguntas
   guardan de qué material ni de qué página salieron
   (`packages/shared/src/schemas/artifact.ts:9-79`). El dato que el ADR da por supuesto
   hay que crearlo.

3. **Sin texto, `citas_pdf` es indemostrable.** Una cita transcrita a ojo desde una
   imagen no se puede contrastar contra nada. Es exactamente la alucinación que el
   producto dice eliminar; un prompt que "obligue" a citar no obliga a nada si no hay
   contra qué comparar.

## Objetivo

Que el servidor pueda obtener el texto literal de una página concreta, que cada pregunta
sepa de qué página salió, y que exista una función pura que decida si una cita aparece de
verdad en ese texto.

## Fuera de alcance

No se toca en este PR, y el doer **no debe adelantarlo**:

- El motor multi-agente, los prompts, el Juez, `Effect.all`.
- Cualquier llamada a Gemini, `generationConfig` y `responseSchema`.
- Tocar `gradeAttempt` o eliminar la comparación `===` de `short-answer`. Eso es PR-04.
- El endpoint NDJSON, los estados discretos, la trazabilidad y `packages/web` entero.
- RAG, chunking, embeddings o búsqueda semántica. Descartado explícitamente en el ADR-01.
- Endpoint HTTP para leer texto: el texto lo consumen el motor y el CLI del agente.

## Contratos afectados

El PR-01 ya dejó una sola copia de los schemas, así que **todo esto se edita únicamente
en `packages/shared/src/schemas/`**. Si el doer se encuentra con que el server sigue
declarando sus propios schemas de artifact, el PR-01 no está mergeado: para y lo notifica.

### Nuevo fichero: `packages/shared/src/schemas/citation.ts`

```ts
export const PdfCitation = Schema.Struct({
  materialId: Schema.String,
  page: Schema.Number,
  quote: Schema.String,
  verified: Schema.Boolean
});
export type PdfCitation = typeof PdfCitation.Type;

export const ArtifactSource = Schema.Struct({
  materialId: Schema.String,
  pages: Schema.Array(Schema.Number)
});
export type ArtifactSource = typeof ArtifactSource.Type;
```

`PdfCitation` es la **forma enriquecida en servidor**. El contrato del Juez sigue siendo
`citas_pdf: string[]` tal como fija el ADR-01: el modelo copia texto, que es lo que
mejor hace, y el servidor le añade `materialId`, `page` y `verified` tras comprobarla.

### `packages/shared/src/schemas/material.ts`

Añadir junto a `MaterialPageImages` (`:19-24`), imitando su forma:

```ts
export const PageText = Schema.Struct({ page: Schema.Number, text: Schema.String });
export const MaterialPageTexts = Schema.Struct({
  type: Schema.Literal("material-page-texts"),
  material: PdfMaterial,
  pages: Schema.Array(PageText)
});
```

### `packages/shared/src/schemas/artifact.ts` — el enlace con el PDF

Dos niveles, porque el ADR necesita los dos:

- **Artifact**: `source: Schema.optional(ArtifactSource)` en `NoteArtifact`,
  `QuizArtifact`, `TestArtifact` y en los tres `Create*ArtifactInput`. Dice de qué
  material y qué páginas nació el artifact entero.
- **Pregunta**: `sourcePage: Schema.optional(Schema.Number)` en
  `MultipleChoiceQuestion`, `TrueFalseQuestion` y `ShortAnswerQuestion`. Es *"la página
  específica asociada a la pregunta"* que el ADR-01 quiere inyectar en el prompt.

Ambos **opcionales a propósito**: los artifacts ya guardados en `.data/artifacts/` no los
tienen y deben seguir cargando sin error.

Cuidado con `exactOptionalPropertyTypes: true` (`tsconfig.json:15`): no se puede pasar
`{ source: undefined }`. Al construir objetos, spread condicional:
`...(source === undefined ? {} : { source })`.

## Pasos

Cada paso deja el repo compilando. El doer ejecuta `pnpm run typecheck` al terminar cada
uno; si algo no compila, para y lo notifica antes de improvisar.

### Paso 1 — Schemas

- [ ] Crear `packages/shared/src/schemas/citation.ts` con `PdfCitation` y `ArtifactSource`.
- [ ] Añadir `PageText` y `MaterialPageTexts` a `packages/shared/src/schemas/material.ts`.
- [ ] Añadir `export * from "./schemas/citation.ts";` a `packages/shared/src/index.ts`
      (hoy 7 líneas de `export *`), manteniendo el orden alfabético.
- [ ] Añadir `source` a los 3 artifacts y a los 3 `Create*ArtifactInput`, y `sourcePage`
      a los 3 tipos de pregunta, en `packages/shared/src/schemas/artifact.ts`.

Comprobación: `pnpm --filter @proxus/shared run typecheck`.

### Paso 2 — Interfaces gemelas en el dominio de materiales

`domain/materials/material.ts` usa **interfaces TypeScript**, no `Schema`, y el PR-01 no
las tocó. Junto a `PageImage` (`:11-15`) y `MaterialPageImages` (`:17-21`):

- [ ] ```ts
      export interface PageText { readonly page: number; readonly text: string }
      export interface MaterialPageTexts {
        readonly type: "material-page-texts";
        readonly material: PdfMaterial;
        readonly pages: readonly PageText[];
      }
      ```
- [ ] Añadir el guard `isMaterialPageTexts`, análogo a `isMaterialPageImages` (`:83-90`).

**No tocar** `renderMessage` en `harness/session.ts:155-197`: el texto viaja como tool
result normal, no necesita el caso multimodal que sí necesitan las imágenes.

### Paso 3 — `extractPageText` en el puerto `PdfService`

- [ ] En `packages/server/src/domain/materials/pdf-service.ts`, añadir a la interfaz:
      ```ts
      readonly extractPageText: (input: {
        readonly path: string;
        readonly page: number;
      }) => Effect.Effect<PageText, PdfServiceError>;
      ```
      importando `PageText` con `import type` desde `./material.ts`, igual que ya se hace
      con `PageImage` (`:2`).

### Paso 4 — Implementación Poppler

En `packages/server/src/infra/materials/poppler-pdf-service.ts`:

- [ ] Añadir `yield* assertExecutable("pdftotext");` después de la línea 26.
- [ ] Actualizar los dos mensajes de error de `assertExecutable` (`:15` y `:20`) para que
      nombren los tres binarios.
- [ ] Implementar `extractPageText` con `spawner.string`, el mismo patrón que `pageCount`
      (`:28-39`). No hace falta directorio temporal: `pdftotext` escribe a stdout con `-`.
      ```ts
      const extractPageText: PdfServiceType["extractPageText"] = ({ path: pdfPath, page }) =>
        spawner.string(
          ChildProcess.make("pdftotext", [
            "-f", String(page), "-l", String(page), "-enc", "UTF-8", pdfPath, "-"
          ])
        ).pipe(
          Effect.map((text) => ({ page, text })),
          Effect.mapError((reason) => new PdfServiceError({ reason }))
        );
      ```
- [ ] Añadirlo al objeto devuelto en `:80`.

**Decidido a propósito: sin `-layout`.** Conserva columnas metiendo rachas de espacios; el
texto en orden de lectura cita mejor y la normalización del paso 6 colapsa espacios de
todas formas. Si hiciera falta para tablas, se cambia aquí y en un solo sitio.

### Paso 5 — `extractText` en `MaterialRepository`

- [ ] En `domain/materials/material.ts:36-43`, añadir al puerto:
      ```ts
      readonly extractText: (
        id: string, pages: readonly number[]
      ) => Effect.Effect<MaterialPageTexts, MaterialNotFound | MaterialRepositoryError>;
      ```
- [ ] Implementarlo en `infra/materials/file-material-repository.ts` **copiando la
      estructura de `renderPages` (`:72-93`)**: `getFile(id)`, la misma validación de
      página fuera de rango (`:77-82`) y `Effect.forEach(..., { concurrency: 1 })` sobre
      `pdf.extractPageText`. Devolver `type: "material-page-texts" as const`.
- [ ] Añadirlo al objeto devuelto en `:95`.

Mantener `concurrency: 1`: es un proceso externo y el repositorio ya lo trata así.

### Paso 6 — Verificador de citas (funciones puras)

- [ ] Crear `packages/server/src/domain/materials/citation.ts`. **Sin Effect**: funciones
      puras, para que la eval del PR-08 las pruebe sin layers ni API key.

```ts
export const normalizeForMatch = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // diacríticos
    .replace(/\u00ad/g, "")            // soft hyphen
    .replace(/-\s*\n\s*/g, "")         // palabra partida al final de línea
    .replace(/\s+/g, " ")              // colapsar espacio en blanco
    .trim()
    .toLowerCase();

export const MIN_QUOTE_LENGTH = 12;

export const verifyQuote: (
  quote: string,
  pages: readonly PageText[]
) => { readonly verified: boolean; readonly page: number | null };

export const verifyCitations: (
  quotes: readonly string[],
  pages: readonly PageText[],
  materialId: string
) => readonly PdfCitation[];
```

Reglas que deben cumplirse:

- `verifyQuote` normaliza cita y texto de página y comprueba `includes`. Devuelve la
  **primera** página que casa.
- Si la cita normalizada mide menos de `MIN_QUOTE_LENGTH`, devuelve
  `{ verified: false, page: null }`. Sin este guarda, `"el"` "se verifica" contra
  cualquier documento y la garantía no vale nada.
- `verifyCitations` es el puente entre el contrato del ADR y el nuestro: recibe el
  `citas_pdf: string[]` del Juez y devuelve `PdfCitation[]` con `verified` y `page`
  resueltos. **No descarta las no verificadas**: las marca `verified: false` para que la
  UI pueda enseñar la diferencia y la eval pueda contarlas.

El criterio de normalización es el mismo espíritu que `optionId` en
`artifact-commands.ts:55-61` (NFD + quitar acentos).

### Paso 7 — Comando `materials text`

En `domain/agents/academic-tutor/material-commands.ts`:

- [ ] Añadir `AgentCli.Command.exec("text", ...)` calcado de `view` (`:43-65`): mismos dos
      argumentos posicionales, mismo `parsePageSelection` + `Effect.andThen`, mismo
      `Effect.catch(renderMaterialError)`.
- [ ] Devolver texto plano legible, no el objeto crudo (a diferencia de `view`, aquí no
      hace falta que el harness lo detecte):
      ```
      --- <materialId> page 3 ---
      <texto de la página>
      ```
- [ ] Si el texto queda vacío tras `trim()`, emitir
      `--- <materialId> page 3 (no extractable text; use materials view instead) ---`.
- [ ] Registrar el comando: `AgentCli.Command.group("materials", [list, view, text] as const)` (`:67`).
- [ ] Ejemplos en `withExamples`, imitando los de `view`.

### Paso 8 — Skills

- [ ] `skills/use-uploaded-materials.ts`: documentar `materials text` y **cuándo usar cada
      uno**. Regla explícita: `text` es la fuente para citar literalmente; `view` es para
      diagramas, fórmulas, tablas y escaneos. Si `text` sale vacío, caer a `view` y decir
      que esa página no se puede citar literalmente.
- [ ] `skills/create-study-artifacts.ts`: exigir `source` en el artifact y `sourcePage` en
      cada pregunta cuando se crea a partir de un material. Actualizar los ejemplos JSON
      inline de `CreateArtifactInput` para que los incluyan.

### Paso 9 — Documentación

- [ ] `docs/data.md`: `pdftotext` en los binarios requeridos y `materials text` en los
      comandos del tutor.
- [ ] `docs/development.md` y `README.md`: `pdftotext` en los requisitos de instalación.
- [ ] `docs/api.md`: corregir la ruta obsoleta `packages/web/src/api/client.ts` →
      `packages/web/src/api-client/client.ts`.
- [ ] `documentacion/funcionamiento-actual.md`: actualizar §4 y la tabla de §9.

## Criterio de aceptación

1. Con Poppler completo, el server arranca igual que antes.
2. Sacando `pdftotext` del PATH, el server **falla al arrancar** nombrando el binario.
3. `materials text <id> 1` sobre un PDF con capa de texto devuelve el texto de la
   página 1, no un error ni JSON crudo.
4. `materials text <id> 999` devuelve el mismo error de rango que `materials view`.
5. Una frase copiada literal de esa salida se verifica; una inventada de longitud
   parecida no.
6. Una frase partida por un salto de línea, o por un guión de corte, también se verifica.
7. Una cita de menos de 12 caracteres normalizados **no** se verifica, aunque aparezca.
8. `verifyCitations` devuelve un elemento por cada string de entrada, ninguno descartado.
9. Un artifact creado por el tutor desde un material llega al frontend con `source`
   relleno y con `sourcePage` en sus preguntas: se comprueba en `GET /api/artifacts/:id`,
   no solo en el JSON de `.data`.
10. Un artifact antiguo sin `source` ni `sourcePage` sigue cargando sin error.

## Checks

```bash
pnpm run typecheck
pnpm --filter @proxus/web run build
pnpm --filter @proxus/server run agent:tutor "lista mis materiales"
pnpm --filter @proxus/server run agent:tutor "muéstrame el texto de la página 1 del material <id>"
pnpm --filter @proxus/server run eval:tutor:artifact-authoring   # requiere API key
```

La eval de authoring existía antes de este PR y debe seguir pasando. Si los campos nuevos
la rompen, es fallo del PR, no de la eval.

## QA manual

`packages/server/.data/` **no existe en un checkout limpio**. Antes de nada:

1. `mkdir -p packages/server/.data/materials/pdfs` y copiar ahí un PDF real **con capa de
   texto** (apuntes, no un escaneo). El id será el nombre del fichero sin `.pdf`.
2. `pnpm run dev`, `http://localhost:5173`, comprobar que el material sale en la sidebar.
3. En el chat: *"lista mis materiales"*, luego *"lee la página 2 de \<id\> y créame un
   quiz de 2 preguntas a partir de ella"*.
4. Abrir el JSON en `packages/server/.data/artifacts/artifacts/` y verificar `source` y
   `sourcePage`.
5. Copiar una frase de la salida de `materials text` y comprobar que `verifyQuote` da
   `true`; inventarse otra parecida y comprobar que da `false`.
6. Probar con un PDF escaneado sin capa de texto: `materials text` avisa, no peta.

## Riesgos y decisiones

- **`pdftotext` es un requisito de instalación nuevo.** Viene en el mismo paquete
  `poppler-utils` que `pdfinfo` y `pdftoppm`, así que quien ya tenía el proyecto
  funcionando lo tiene. Aun así es un fallo de arranque nuevo: por eso se cambian los
  mensajes de error y la documentación en el mismo PR. Se mantiene el fail-fast, que es
  comportamiento deliberado del repo.
- **PDFs escaneados sin capa de texto.** `pdftotext` devuelve vacío. Decisión: no se añade
  OCR (fuera de presupuesto y de las restricciones). El sistema degrada de forma
  explícita y la skill instruye al modelo para que lo diga. Limitación documentada en el
  README de entrega, no un bug.
- **Verificación por `includes` sobre texto normalizado, no *fuzzy matching*.** Una cita
  con una palabra cambiada no se verifica, y así debe ser: el objetivo es detectar
  invención, y un umbral difuso abriría justo la puerta que intentamos cerrar. El coste
  es algún falso negativo con ligaduras o guiones raros; aceptado.
- **`MIN_QUOTE_LENGTH = 12` es un número elegido a ojo.** Suficiente para que una cita
  genérica no cuele, corto para no invalidar citas legítimas de una línea. Si en el PR-04
  molesta, se ajusta ahí y se anota en el Historial.
- **Se cita por página, no por chunk.** El ADR-01 descarta RAG explícitamente. La unidad
  de evidencia es la página, que además es lo que un estudiante puede ir a mirar.
- **`sourcePage` lo rellena el modelo**, así que puede equivocarse o dejarlo vacío. Por
  eso el motor del PR-04 debe caer a `source.pages` completo cuando falte, y por eso las
  citas se verifican pase lo que pase.

## Historial

_Sin cambios todavía. El thinker anota aquí cualquier corrección al plan que venga del
doer, con fecha y motivo._
