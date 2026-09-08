# API

La API principal se define en `packages/shared/src/api/*` con Effect HTTP API.

En local:

- Docs interactivas: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`

## Endpoints

### Tutor

```http
POST /api/tutor/chat
POST /api/tutor/chat/stream
```

`/stream` devuelve NDJSON:

```json
{ "type": "message", "message": {} }
{ "type": "done" }
```

La ruta streaming está implementada manualmente para soportar eventos incrementales.

### Materials

```http
GET    /api/materials/
GET    /api/materials/:id
POST   /api/materials
DELETE /api/materials/:id
```

Los materiales representan PDFs disponibles para el tutor. El server puede renderizar páginas vía Poppler para que Gemini las procese como imágenes.

`POST /api/materials` sube un PDF. Es `multipart/form-data` con un único campo `file`, máximo 25 MB. Devuelve **200** con el `PdfMaterial` creado, o **400** con `{"_tag":"InvalidPdf","message":"..."}` si el fichero no es un PDF legible.

El nombre de fichero llega del cliente, así que se sanea antes de guardarlo: se descarta cualquier componente de directorio y se filtran los caracteres que el sistema de ficheros no admite. Si el nombre ya está ocupado se añade un sufijo (`apuntes-2.pdf`), nunca se sobrescribe. El PDF se valida con `pdfinfo` **antes** de entrar en el directorio de materiales: un fichero ilegible ahí dentro rompería el listado completo.

El multipart se consume **como stream**, no bufferizado. El decodificador bufferizado escribe el temporal usando el nombre original del cliente, así que un nombre con `: ? * " < > |` no se podía escribir en Windows y la petición moría con 500 antes de que el saneado existiera. Consumiendo las partes como stream, el servidor elige el nombre del temporal (`upload.pdf` dentro de un directorio propio) y el nombre del cliente nunca toca el sistema de ficheros. El temporal se borra siempre, con éxito o con error.

Otras respuestas de error, todas **400** con el mismo `_tag`:

- petición sin ninguna parte de fichero → `"No file was uploaded."`
- fichero por encima del límite o cuerpo truncado → `"That upload could not be read. The file may be larger than 25 MB."`

`DELETE /api/materials/:id` borra el PDF del disco. Devuelve 204, o 404 con `{"_tag":"MaterialNotFound","materialId":"..."}`.

### Artifacts

```http
GET /api/artifacts/
GET /api/artifacts/:id
POST /api/artifacts/:id/submit
POST /api/artifacts/:id/submit/stream
```

`submit` crea y corrige un intento, devolviendo un attempt con estado `graded` cuando aplica.

`submit/stream` es la misma operación (`submitAttempt` → `gradeAttempt` → revisión del Juez) pero
en NDJSON, para que el alumno vea progreso mientras se corrigen las respuestas cortas. Igual que
`/api/tutor/chat/stream`, es una ruta manual de `HttpRouter` y por tanto **no aparece en OpenAPI ni
en `/docs`**: se consume con `fetch` crudo. `POST /api/artifacts/:id/submit` sigue existiendo sin
cambios como ruta tipada y como degradación si el streaming falla en el navegador.

Tres tipos de frame:

```json
{ "type": "status", "value": "evaluating_good", "questionId": "q1", "questionIndex": 0, "questionTotal": 2 }
{ "type": "status", "value": "evaluating_bad", "questionId": "q1", "questionIndex": 0, "questionTotal": 2 }
{ "type": "status", "value": "deliberating", "questionId": "q1", "questionIndex": 0, "questionTotal": 2 }
{ "type": "done", "payload": {} }
{ "type": "error", "message": "..." }
```

`value` es uno de `evaluating_good` (profe optimista), `evaluating_bad` (profe crítico, corre en
paralelo con el anterior) o `deliberating` (el Juez, después de los dos). `questionId`/`questionIndex`/
`questionTotal` identifican a cuál de las respuestas cortas del test corresponde el estado, porque con
varias preguntas cortas los tres estados se repiten una vez por pregunta. `done.payload` es el
`ArtifactAttempt` corregido completo (nota, resumen y una corrección por pregunta), idéntico al que
devuelve `POST /api/artifacts/:id/submit` con el mismo cuerpo. Un fallo del motor produce un frame
`error` y el stream se cierra limpiamente: nunca se corta la conexión sin un frame terminal.

## Tipos de artifact

- `note`: contenido markdown.
- `quiz`: preguntas cerradas.
- `test`: preguntas cerradas o `short-answer`.

Tipos de pregunta y campos obligatorios (`sourcePage` es siempre opcional):

| Tipo | Dónde | Obligatorios | Opcionales |
|---|---|---|---|
| `multiple-choice` | quiz y test | `type`, `id`, `prompt`, `options`, `correctOptionId`, `explanation` | `sourcePage` |
| `true-false` | quiz y test | `type`, `id`, `prompt`, `correctAnswer` (boolean), `explanation` | `sourcePage` |
| `short-answer` | solo test | `type`, `id`, `prompt`, `expectedAnswer` | `maxScore` (por defecto `1`), `sourcePage` |

`short-answer` usa `expectedAnswer`, no `correctAnswer`. Las cerradas valen 1 punto fijo,
por eso `maxScore` solo existe en `short-answer` y ahora se rellena solo si se omite.

No existe pregunta de selección múltiple con varias respuestas correctas:
`correctOptionId` es un único id.

Formato correcto para multiple choice:

```json
{
  "type": "multiple-choice",
  "options": [
    { "id": "a", "text": "Respuesta A" },
    { "id": "b", "text": "Respuesta B" }
  ]
}
```

El CLI tolera options como strings y las normaliza, pero el contrato estable usa `{ id, text }`.

## Cliente web

- Cliente API: `packages/web/src/api-client/client.ts`
- Runtime Effect: `packages/web/src/lib/runtime.ts`
- Streaming tutor: `packages/web/src/domain/tutor/stream.ts`
