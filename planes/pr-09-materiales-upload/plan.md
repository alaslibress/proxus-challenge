# PR-09 — Subida de PDFs desde la UI

- **Rama**: `feat/materiales-upload`
- **Depende de**: PR-01 (mergeado, `21eff12`).
- **Orden de ejecución**: **inmediatamente después del PR-01 y antes del PR-02.** La
  numeración 09–11 es identidad, no orden: estos tres PRs se intercalan al principio del
  roadmap porque son de producto visible y baratos.
- **Bloquea a**: nada del roadmap. **Desbloquea** la QA manual del PR-02, PR-04, PR-07 y
  PR-08, que hoy exige copiar un PDF a mano dentro de `.data/`.
- **Conflicto conocido**: ninguno. Ningún PR del roadmap toca
  `shared/src/api/materials.ts`, `infra/materials/file-material-repository.ts` ni
  `Sidebar.tsx` salvo el PR-02, que añade `extractText` al mismo repositorio: **este PR
  va antes**.
- **Estado**: borrador
- **Contiene LLM**: no.
- **Origen**: hallazgo de usabilidad. No sale de los ADR.

> Normas de trabajo en [`../plan.md`](../plan.md). Contexto técnico obligatorio en
> [`../../documentacion/contexto-repo.md`](../../documentacion/contexto-repo.md) y
> [`../../documentacion/funcionamiento-actual.md`](../../documentacion/funcionamiento-actual.md).
> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.

---

## Problema

La sección `MATERIALS` del sidebar dice *"No uploaded PDFs yet."*
(`packages/web/src/components/Sidebar.tsx:36`) y no ofrece ninguna forma de arreglarlo.
No es un fallo de la UI: **la capacidad no existe en ninguna capa**.

Evidencia, de fuera hacia dentro:

- **Contrato**: `packages/shared/src/api/materials.ts:5-17` declara exactamente dos
  endpoints, `GET /api/materials/` y `GET /api/materials/:id`. No hay `POST`.
- **Web**: un grep de `FormData|multipart|type="file"|Blob` sobre `packages/web/src`
  devuelve dos aciertos, y los dos son `<input type="radio">` de
  `ArtifactWorkspace.tsx:243` y `:274`. No hay input de fichero, ni drag & drop, ni
  `AbortController`, ni barra de progreso en todo el paquete.
- **Servidor**: `packages/server/src/transport/http/handlers.ts:21-34` sólo implementa
  `list` y `get`. Nada en `packages/server` importa `Multipart`.
- **Dominio**: el puerto `MaterialRepository`
  (`packages/server/src/domain/materials/material.ts:36-43`) tiene `list`, `get` y
  `renderPages`. **No tiene ningún método de escritura.**
- **Operación**: `docs/data.md:71-78` y `planes/GUIA-DOER.md` §2 documentan el
  procedimiento real de alta de un material: `mkdir -p
  packages/server/.data/materials/pdfs` y copiar el fichero con el explorador. El id del
  material es el nombre del fichero sin `.pdf`
  (`infra/materials/file-material-repository.ts:43-44`).

Consecuencia de producto: la demo del challenge arranca vacía y no hay forma de llenarla
sin acceso al sistema de ficheros del servidor. Consecuencia de proyecto: la QA manual de
casi todos los PRs siguientes empieza con un paso manual fuera de la aplicación.

Detalle que confirma que el hueco estaba previsto: el contenedor del encabezado de la
sección (`Sidebar.tsx:28`) ya es `flex items-center justify-between gap-4` con **un solo
hijo**. Está pintado para alojar un botón a la derecha.

## Objetivo

Que un alumno arrastre un PDF sobre el sidebar y lo vea listado en `MATERIALS`, sin tocar
el sistema de ficheros ni reiniciar el servidor.

## Fuera de alcance

- **Borrar o renombrar materiales.** Sólo alta.
- **Extracción de texto.** Es el PR-02. Aquí el PDF se guarda y se cuenta con `pdfinfo`,
  nada más.
- **Subida múltiple en paralelo.** Se acepta un fichero por vez; el segundo se rechaza en
  cliente mientras haya uno en vuelo.
- **Comando CLI `materials import` para el agente.** `invalidation.ts:58` ya lo
  contempla, pero no existe en el servidor y no se añade aquí: el agente no sube
  ficheros, los sube la persona.
- **Autenticación, cuotas por usuario y antivirus.** `CHALLENGE.md` excluye auth
  explícitamente.
- **Almacenamiento fuera de `packages/server/.data/`.** Ni S3 ni base de datos.
- **Previsualización del PDF en el navegador.**
- **Rebrand global de la paleta.** Ver *Riesgos y decisiones*.

## Contratos afectados

### `packages/shared/src/schemas/material.ts` — añadir el error tipado

```ts
export const MaterialUploadRejected = Schema.Struct({
  _tag: Schema.Literal("MaterialUploadRejected"),
  reason: Schema.Union([
    Schema.Literal("not-a-pdf"),
    Schema.Literal("empty-file"),
    Schema.Literal("unreadable-pdf"),
    Schema.Literal("storage-failure")
  ]),
  message: Schema.String
});
export type MaterialUploadRejected = typeof MaterialUploadRejected.Type;
```

`message` es texto para leer, ya redactado en servidor. **Nunca lleva rutas, stack ni
`String(cause)`.**

### `packages/shared/src/api/materials.ts` — endpoint nuevo

Antes: dos `GET`. Después:

```ts
import { Schema } from "effect";
import { Multipart } from "effect/unstable/http";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";
import { MaterialListResponse, MaterialUploadRejected, PdfMaterial } from "../schemas/material.ts";

export const MaterialUploadPayload = Schema.Struct({
  file: Multipart.SingleFileSchema
}).pipe(HttpApiSchema.asMultipart({
  maxParts: 2,
  maxFileSize: "25 MB",
  maxTotalSize: "25 MB"
}));

export class MaterialsApi extends HttpApiGroup.make("materials")
  .add(
    HttpApiEndpoint.get("list", "/", { success: MaterialListResponse }),
    HttpApiEndpoint.get("get", "/:id", { params: { id: Schema.String }, success: PdfMaterial }),
    HttpApiEndpoint.post("upload", "/", {
      payload: MaterialUploadPayload,
      success: PdfMaterial,
      error: MaterialUploadRejected.pipe(HttpApiSchema.status(400))
    })
  )
  .prefix("/materials")
{}
```

Ruta resultante: **`POST /api/materials`** (el `.prefix("/materials")` del grupo más el
`.prefix("/api")` de `ProxusApi` en `shared/src/api/Api.ts:6-13`).

Hechos verificados en `effect@4.0.0-beta.83` que sostienen esto:

- `Multipart` se exporta desde el barrel `effect/unstable/http`
  (`src/unstable/http/index.ts:125`).
- `Multipart.SingleFileSchema` existe (`src/unstable/http/Multipart.ts:312`) y decodifica
  el array de partes a un único `PersistedFile`.
- `PersistedFile` es `{ _tag, key, name, contentType, path }`
  (`Multipart.ts:152-157`): **el fichero ya está escrito en un directorio temporal** cuyo
  ciclo de vida es el `Scope` de la petición (`Multipart.ts:637-645`, `toPersisted`).
  Copiarlo a `.data/` **dentro** del handler es obligatorio; después del handler
  desaparece.
- `HttpApiSchema.asMultipart(options)` existe (`HttpApiSchema.ts:537`) y las opciones
  válidas son `maxParts`, `maxFieldSize`, `maxFileSize`, `maxTotalSize`, `fieldMimeTypes`
  (`Multipart.ts:765-771`).
- `HttpApiSchema.status(code)` existe (`HttpApiSchema.ts:160-166`).
- El persistido necesita `FileSystem | Path | Scope`
  (`HttpServerRequest.ts:318-326`). `NodeHttpServer.layer` ya aporta `NodeServices`
  (`@effect/platform-node/src/NodeHttpServer.ts:414-418`), que es de donde ya se sirve
  hoy `FileMaterialRepository`. **No hay que añadir ningún layer nuevo en `server.ts`.**

### `packages/shared/src/index.ts`

Exportar `MaterialUploadRejected` y `MaterialUploadPayload` siguiendo el patrón de
re-export ya existente.

### Puerto de dominio — `packages/server/src/domain/materials/material.ts`

```ts
export interface UploadMaterialInput {
  readonly fileName: string;
  readonly sourcePath: string;
}

// dentro de MaterialRepository:
readonly create: (
  input: UploadMaterialInput
) => Effect.Effect<PdfMaterial, InvalidMaterialFile | MaterialRepositoryError>;
```

Y un error de dominio nuevo, al lado de los tres que ya hay (`material.ts:23-34`):

```ts
export class InvalidMaterialFile extends Data.TaggedError("InvalidMaterialFile")<{
  readonly reason: "not-a-pdf" | "empty-file" | "unreadable-pdf";
}> {}
```

## Pasos

### Paso 0 — Comprobación previa

1. [ ] `git switch -c feat/materiales-upload` desde `main` con el PR-01 dentro
       (`git log --oneline -1` debe mostrar `21eff12` o un descendiente).
2. [ ] `grep -rn "multipart\|FormData" packages/*/src` → **0 aciertos**. Si hay alguno,
       para: alguien ya empezó esto.
3. [ ] `pnpm run typecheck` en verde antes de tocar nada.

### Paso 1 — Contrato en `packages/shared`

1. [ ] `packages/shared/src/schemas/material.ts`: añadir `MaterialUploadRejected` tal
       cual está en *Contratos afectados*.
2. [ ] `packages/shared/src/api/materials.ts`: añadir `MaterialUploadPayload` y el
       endpoint `upload`.
3. [ ] `packages/shared/src/index.ts`: re-exportar lo nuevo.
4. [ ] `pnpm run typecheck`. **Debe romper `packages/server`**: `HttpApiBuilder.group`
       exige que el grupo `materials` implemente todos sus endpoints. Esa rotura es la
       señal de que el contrato llegó; se arregla en el Paso 4.

### Paso 2 — Puerto de dominio

1. [ ] `packages/server/src/domain/materials/material.ts`: añadir `InvalidMaterialFile`,
       `UploadMaterialInput` y el método `create` al interfaz `MaterialRepository`.
2. [ ] Nada más en este fichero. La lógica va en infraestructura.

### Paso 3 — `FileMaterialRepository.create`

En `packages/server/src/infra/materials/file-material-repository.ts`, dentro de
`make(directory)`, junto a los helpers ya existentes (`pdfPath`, `listFiles`):

1. [ ] **Derivar el id** desde el nombre original, sin confiar en él:

   ```ts
   const toMaterialId = (fileName: string) => {
     const base = path.basename(fileName, path.extname(fileName));
     const slug = base
       .normalize("NFD")
       .replace(/[\u0300-\u036f]/g, "")
       .toLowerCase()
       .replace(/[^a-z0-9]+/g, "-")
       .replace(/^-+|-+$/g, "")
       .slice(0, 64);
     return slug.length === 0 ? "material" : slug;
   };
   ```

   Motivo: el id **es** el nombre del fichero en disco
   (`file-material-repository.ts:43-44`), así que un nombre con `../`, espacios o acentos
   se convierte en ruta y en id a la vez. `path.basename` mata el path traversal; el
   slug mata el resto.

2. [ ] **Resolver colisiones** antes de escribir: si `<id>.pdf` existe, probar `<id>-2`,
       `<id>-3`… hasta 50, y si no hay hueco fallar con `MaterialRepositoryError`. Usar
       `fs.exists`. No sobrescribir nunca un material existente.

3. [ ] **Copiar** desde `input.sourcePath` a `pdfPath(\`${id}.pdf\`)`:
       `fs.makeDirectory(directory, { recursive: true })` primero — el helper ya lo hace
       en `listFiles`, replicarlo aquí — y luego copiar.
       Comprobar en `effect@4.0.0-beta.83` si `FileSystem` expone `copyFile`; si no
       existe, `fs.readFile` + `fs.writeFile`. **Si no existe ninguno de los dos, para y
       notifica.**

4. [ ] **Validar que es un PDF de verdad** ejecutando `pdf.pageCount(destino)` *después*
       de copiar. Si falla: borrar el fichero copiado (`fs.remove`) y devolver
       `new InvalidMaterialFile({ reason: "unreadable-pdf" })`.
       Motivo: el `contentType` del multipart lo pone el navegador y es trivialmente
       falsificable; `pdfinfo` es la única comprobación que vale. Es además gratis, ya
       que el `pageCount` hace falta para construir el `PdfMaterial`.

5. [ ] Rechazar antes de copiar: extensión distinta de `.pdf` → `"not-a-pdf"`; tamaño 0
       (`fs.stat(sourcePath).size`) → `"empty-file"`.

6. [ ] Devolver el `PdfMaterial` con `id`, `title` (el `basename` **original** sin
       extensión, sin slugificar: es lo que lee la persona), `fileName: \`${id}.pdf\``,
       `pageCount` y `uploadedAt: new Date().toISOString()`.
       **Cuidado con `exactOptionalPropertyTypes`**: no pasar propiedades `undefined`.

7. [ ] `pnpm run typecheck`.

### Paso 4 — Handler HTTP

En `packages/server/src/transport/http/handlers.ts`, grupo `materials`:

```ts
      .handle("upload", ({ payload }) =>
        materials.create({
          fileName: payload.file.name,
          sourcePath: payload.file.path
        }).pipe(
          Effect.mapError((error) =>
            error._tag === "InvalidMaterialFile"
              ? ({
                  _tag: "MaterialUploadRejected" as const,
                  reason: error.reason,
                  message: uploadRejectionMessage(error.reason)
                })
              : ({
                  _tag: "MaterialUploadRejected" as const,
                  reason: "storage-failure" as const,
                  message: "Could not save the PDF. Try again."
                })
          )
        ))
```

1. [ ] **No usar `Effect.orDie` aquí.** Es el primer endpoint del repo con canal de error
       tipado, y es deliberado: un PDF corrupto es un caso de uso, no un 500.
2. [ ] `uploadRejectionMessage` es un `switch` exhaustivo local con un mensaje por
       `reason`. Textos exactos:
   - `not-a-pdf`: `"Only PDF files are supported."`
   - `empty-file`: `"That file is empty."`
   - `unreadable-pdf`: `"That PDF could not be read. It may be corrupted or password-protected."`
   - `storage-failure`: `"Could not save the PDF. Try again."`
3. [ ] `pnpm run typecheck` — aquí vuelve a verde la rotura del Paso 1.

### Paso 5 — Cliente de subida en web

Fichero nuevo: `packages/web/src/api-client/upload.ts`.
**No crear `packages/web/src/api/`** (taparía el proxy de Vite, `vite.config.ts:5`).

```ts
import type { PdfMaterial } from "@proxus/shared";
import { apiClientConfig } from "./config.ts";

export interface UploadProgress {
  readonly loaded: number;
  readonly total: number;
}

export interface UploadOptions {
  readonly onProgress: (progress: UploadProgress) => void;
  readonly signal?: AbortSignal;
}

export const uploadMaterial = (file: File, options: UploadOptions): Promise<PdfMaterial> => { ... }
```

1. [ ] Implementar con **`XMLHttpRequest`**, no con `fetch`.
       Motivo, y va en el cuerpo del PR: `fetch` no reporta progreso de **subida** en
       ningún navegador; sólo `XMLHttpRequest.upload.onprogress` lo hace. Sin esto la
       barra de progreso del requisito es decorativa.
2. [ ] Cuerpo: `const body = new FormData(); body.append("file", file);`. **No fijar
       `Content-Type` a mano**: el navegador tiene que poner el `boundary`.
3. [ ] URL: `` `${apiClientConfig.apiUrl}/api/materials` ``, igual que hace
       `domain/tutor/stream.ts:9`.
4. [ ] `xhr.upload.onprogress` → `onProgress({ loaded, total })`, usando
       `event.lengthComputable` como guarda.
5. [ ] `options.signal` → `xhr.abort()` y rechazo con un error reconocible
       (`DOMException("Upload cancelled", "AbortError")`).
6. [ ] Respuesta:
   - `status === 200` → `JSON.parse(xhr.responseText)` como `PdfMaterial`.
   - `status === 400` → parsear `{_tag, reason, message}` y rechazar con
     `new Error(message)`. Si el body no parsea, mensaje genérico.
   - cualquier otro status o error de red → `new Error("Could not upload the PDF. Check that the server is running.")`, y `console.error` con el cuerpo crudo.
     **Nunca** se pinta `xhr.responseText` en la UI: puede ser HTML o un stack.

> **Por qué no el cliente tipado.** `HttpApiClient` acepta un `FormData` como payload en
> tiempo de ejecución (`HttpApiClient.ts:398-405`), pero el tipo del payload es el
> **decodificado** (`{ file: PersistedFile }`), así que llamarlo obligaría a un
> `as unknown as`. Y `FetchHttpClient` no da progreso. Hay precedente en el repo de salir
> del cliente tipado para transporte especial: `domain/tutor/stream.ts`. El endpoint sí
> se declara en `HttpApi` para que aparezca en `/docs` y en `/openapi.json`.

### Paso 6 — Componente `PdfUploader`

Fichero nuevo: `packages/web/src/components/PdfUploader.tsx`.

> **Nombre**: `PdfUploader`, no `PDFUploader`. El repo escribe `PdfMaterial`,
> `PdfService`, `PopplerPdfService`. Se respeta la convención existente.

```tsx
type UploadState =
  | { readonly status: "idle" }
  | { readonly status: "uploading"; readonly fileName: string; readonly percent: number }
  | { readonly status: "success"; readonly title: string }
  | { readonly status: "error"; readonly message: string };

interface PdfUploaderProps {
  readonly onUploaded: () => void;
}
```

1. [ ] **Estado local**, `useState<UploadState>({ status: "idle" })` más un
       `useState<boolean>` para `isDragging` y un `useRef<HTMLInputElement>`.
       No se crea atom: el progreso cambia decenas de veces por segundo y no lo comparte
       nadie. La invalidación sí es global y va por `onUploaded`.
2. [ ] **Selector nativo**: `<input ref={inputRef} type="file" accept="application/pdf"
       className="hidden" onChange={...} />` más un botón que hace
       `inputRef.current?.click()`. Tras cada selección, `inputRef.current.value = ""`,
       o volver a elegir el mismo fichero no dispara `onChange`.
3. [ ] **Drag & drop** sobre el contenedor: `onDragOver` y `onDragEnter` con
       `event.preventDefault()` (sin esto el navegador abre el PDF en una pestaña),
       `onDragLeave` y `onDrop` → `event.dataTransfer.files[0]`.
       Ojo con `noUncheckedIndexedAccess`: `files[0]` es `File | undefined`.
4. [ ] **Validación en cliente antes de llamar**: extensión `.pdf` o
       `type === "application/pdf"`; `size > 0`; `size <= 25 * 1024 * 1024` (el mismo
       límite que `maxFileSize` del contrato). Mensajes en el mismo tono que los del
       servidor.
5. [ ] **Un fichero a la vez**: si `state.status === "uploading"`, ignorar drops y
       clicks, y marcar la zona con `aria-disabled="true"`.
6. [ ] **Éxito**: `setState({status:"success", title})`, llamar a `onUploaded()`, y
       volver a `idle` a los 4 s con un `setTimeout` limpiado en el `useEffect` de
       desmontaje.
7. [ ] **Accesibilidad**: la zona de drop lleva `role="button"`, `tabIndex={0}` y
       `onKeyDown` que abre el selector con Enter o Espacio. El bloque de estado lleva
       `aria-live="polite"`. La barra de progreso lleva `role="progressbar"` con
       `aria-valuenow/min/max`.
8. [ ] **Markup y clases** (alineado con lo que ya existe; el precedente de zona punteada
       es `ArtifactWorkspace.tsx:33`):

   ```tsx
   <div
     className={`rounded-2xl border border-dashed p-4 text-center transition ${
       isDragging
         ? "border-blue-600 bg-blue-950/30"
         : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
     }`}
   >
     <p className="text-slate-400 text-sm">
       Drop a PDF here or{" "}
       <button type="button" className="text-blue-500 underline underline-offset-2 hover:text-blue-400">
         choose a file
       </button>
     </p>
   </div>
   ```

   Progreso:

   ```tsx
   <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-slate-800" role="progressbar" ...>
     <div className="h-full bg-blue-600 transition-[width] duration-150" style={{ width: `${percent}%` }} />
   </div>
   ```

   Error: `rounded-xl border border-red-900 bg-red-950/50 p-3 text-red-100 text-sm`
   (mismo patrón que `ArtifactWorkspace.tsx:137`), con un botón `Try again`.

### Paso 7 — Enchufarlo en el sidebar

En `packages/web/src/components/Sidebar.tsx`:

1. [ ] `const refreshMaterials = useAtomRefresh(materialsQuery);` — mismo patrón que
       `Chat.tsx:23`.
2. [ ] Renderizar `<PdfUploader onUploaded={refreshMaterials} />` **siempre**, dentro de
       la `<section>` de materiales, después del bloque `AsyncResult.matchWithError`, no
       sólo en el caso vacío.
3. [ ] Dejar `"No uploaded PDFs yet."` como está: con el uploader debajo ya no es un
       callejón sin salida.
4. [ ] No tocar la sección de artifacts.

### Paso 8 — CSS generado

1. [ ] `pnpm --filter @proxus/web run build` regenera `src/styles.generated.css` con las
       clases nuevas (`blue-600`, `blue-950/30`, `border-dashed`…). Tailwind v4 aquí es
       el **CLI**, no un plugin de Vite: sin regenerar, las clases nuevas no existen.
2. [ ] `git status` **no** debe mostrar `styles.generated.css` (está en `.gitignore`).
       Si aparece, para y notifica.

### Paso 9 — Documentación

1. [ ] `docs/api.md`: documentar `POST /api/materials` (multipart, campo `file`,
       200 → `PdfMaterial`, 400 → `MaterialUploadRejected`, límite 25 MB).
2. [ ] `docs/data.md`: la sección que dice que los PDFs se colocan a mano pasa a decir
       que también se pueden subir desde la UI; el método manual sigue siendo válido.
3. [ ] `documentacion/funcionamiento-actual.md` §5: la frase **"No hay endpoint de
       creación de artifacts ni de subida de materiales"** deja de ser cierta a medias.
       Corregirla, no borrarla: lo de artifacts sigue siendo verdad.
4. [ ] **`documentacion/dificultades.md`** — crear el fichero si no existe y añadir una
       entrada. Formato obligatorio, una entrada por dificultad real:

   ```markdown
   ## PR-09 — <título corto de la dificultad>

   - **Síntoma**: qué se vio, con el error literal si lo hubo.
   - **Causa**: qué lo provocaba de verdad, no la primera hipótesis.
   - **Solución**: qué se cambió, con ruta y línea.
   - **Descartado**: qué se probó antes y por qué no valía.
   ```

   Candidatas casi seguras: el ciclo de vida del `Scope` del fichero persistido, el
   `boundary` del `FormData`, la ausencia de progreso en `fetch`, la regeneración del CSS
   de Tailwind. **Si no hubo ninguna dificultad, escribirlo también**, con esa frase.

## Criterio de aceptación

- [ ] Con `.data/materials/pdfs` vacío, la sección `MATERIALS` muestra una zona punteada
      con *"Drop a PDF here or choose a file"*.
- [ ] Arrastrar un PDF sobre esa zona la resalta en azul y, al soltar, sube el fichero.
- [ ] Pulsar *choose a file* abre el diálogo nativo del sistema y subir por ahí funciona
      igual.
- [ ] Durante la subida se ve una barra de progreso que avanza y el control no acepta un
      segundo fichero.
- [ ] Al terminar, el material aparece en la lista **sin recargar la página**, con su
      título y su número de páginas correctos.
- [ ] **El control de subida sigue visible y utilizable después de subir**, con la lista
      de materiales llena. Reportado como fallo en uso: el botón desaparecía tras el primer
      PDF.
- [ ] Subir dos veces el mismo nombre produce dos materiales, con ids `x` y `x-2`, y
      ninguno se sobrescribe.
- [ ] Soltar un `.txt` o un `.png` muestra *"Only PDF files are supported."* y **no** hace
      ninguna petición al servidor.
- [ ] Soltar un fichero con extensión `.pdf` que no es un PDF muestra el mensaje de PDF
      ilegible y **no deja basura** en `.data/materials/pdfs`.
- [ ] Con el servidor apagado, el error es una frase legible, nunca un stack ni HTML.
- [ ] `GET /api/materials` devuelve el material recién subido, y el agente lo ve con
      `materials list`.
- [ ] `POST /api/materials` aparece en `/docs`.
- [ ] Ningún mensaje visible en la UI contiene una ruta del servidor.
- [ ] `documentacion/dificultades.md` tiene al menos una entrada del PR-09.

## Checks

```bash
pnpm run typecheck                        # gate, en verde
pnpm --filter @proxus/web run build       # en verde

# con el server levantado (pnpm --filter @proxus/server run dev):
curl -sS -X POST http://localhost:3000/api/materials \
  -F "file=@$HOME/ruta/a/apuntes.pdf" | head -c 400
# → {"id":"apuntes","title":"apuntes","fileName":"apuntes.pdf","pageCount":N,...}

curl -sS -X POST http://localhost:3000/api/materials \
  -F "file=@/etc/hostname" -o - -w '\n%{http_code}\n'
# → 400 y {"_tag":"MaterialUploadRejected","reason":"not-a-pdf",...}

curl -sS http://localhost:3000/api/materials | head -c 400
curl -sS http://localhost:3000/openapi.json | grep -c '"/api/materials"'   # ≥ 1
ls packages/server/.data/materials/pdfs
```

## QA manual

1. `rm -rf packages/server/.data/materials/pdfs/*` y `pnpm run dev`.
2. Abrir `http://localhost:5173`. La sección `MATERIALS` muestra el uploader.
3. Arrastrar un PDF real con capa de texto. Ver el resaltado azul, la barra y la lista
   actualizada.
4. Con DevTools → Network, comprobar que la petición es `multipart/form-data` con
   `boundary` y que hay eventos de progreso de subida (usar un PDF de varios MB o el
   throttling de red para verlo).
5. Repetir con el mismo fichero: aparece un segundo material con sufijo `-2`.
6. Arrastrar una imagen: rechazo instantáneo, sin petición en Network.
7. `cp /etc/hostname /tmp/falso.pdf` y arrastrarlo: error de PDF ilegible, y
   `ls packages/server/.data/materials/pdfs` no muestra `falso.pdf`.
8. Matar el servidor y volver a arrastrar: mensaje legible, sin stack.
9. En el chat, preguntar *"lista mis materiales"*: el agente lista el PDF subido.
10. Navegar a `http://localhost:3000/docs` y localizar `POST /api/materials`.

## Riesgos y decisiones

- **El fichero persistido vive dentro del `Scope` de la petición.**
  `Multipart.toPersisted` lo escribe en un directorio temporal con
  `fs.makeTempDirectoryScoped` (`Multipart.ts:643`). Copiarlo a `.data/` fuera del handler
  daría un `ENOENT` intermitente. Por eso el Paso 3 copia dentro y valida después.

- **`XMLHttpRequest` en lugar del cliente tipado.** Asumido a cambio de progreso real de
  subida y de no meter un `as unknown as` en el código. El endpoint sigue declarado en el
  `HttpApi`, así que la documentación y el servidor sí son tipados. La alternativa —
  `client.materials.upload({ payload: formData as any })` — se descarta por el cast y
  porque dejaría la barra de progreso en un `indeterminate` falso.

- **Validación por `pdfinfo`, no por `contentType`.** Cuesta un proceso por subida y
  obliga a borrar el fichero si falla. A cambio, es la única comprobación que un cliente
  no puede falsear. Además `pageCount` hace falta de todos modos.

- **Poppler es dependencia dura de arranque** (`poppler-pdf-service.ts:25-26`): sin
  `pdfinfo` el servidor entero no levanta. Este PR no cambia eso, sólo lo hereda. Si la
  QA falla al arrancar, revisar el entorno antes que el código.

- **El id sigue siendo el nombre del fichero.** No se introduce un sidecar de metadatos:
  sería un cambio de modelo de datos y el PR-02 ya toca ese repositorio. La consecuencia
  aceptada es que `title` se pierde si alguien renombra el fichero en disco.

- **Coste de `list()`**: cada subida dispara un refresh que vuelve a lanzar `pdfinfo` por
  cada PDF (`file-material-repository.ts:26-53`). Con decenas de ficheros es perceptible.
  No se arregla aquí; queda anotado como deuda para un PR de caché por `mtime`.

- **Paleta.** El prompt del rebrand pide acentos `blue-600`, pero la app usa hoy
  `sky-400`/`sky-500` como acento y `blue-*` sólo en la burbuja del usuario
  (`Chat.tsx:158`). Decisión: **el uploader usa `blue-600`** (barra de progreso y borde
  activo) y **no se toca nada más**. Si el rebrand va en serio, es un PR de tema propio
  que cambia los `sky-*` de golpe; mezclarlo aquí haría el diff ilegible. **Punto abierto
  para el thinker**: confirmar con producto antes de extender el azul.

- **Sin límite de disco.** 25 MB por fichero, ilimitados ficheros. Es una demo local sin
  auth; poner cuotas sin usuarios sería teatro.

## Historial

- **Reporte de uso (7-sep-2026)**: tras subir un PDF desaparecía el control para subir
  otro. Añadido criterio de aceptación explícito. El §Paso 7.2 ya obliga a renderizar el
  uploader **siempre**, no sólo en el estado vacío: respetarlo.

- **Tras el PR-1.5**: los fragmentos de este plan llevan clases literales
  (`bg-slate-900`, `border-sky-400`, `blue-600`…). El PR-1.5 las prohíbe. **Estos
  fragmentos hay que retokenizarlos antes de implementar este PR**; los tokens y las
  recetas equivalentes están en `documentacion/design-system.md`.

- *(vacío)*
