# Plan — Subida de PDFs (`POST /api/materials`)

> Rol: thinker. Este documento es para el implementador. Cada afirmación sobre el
> estado actual va con ruta y línea, verificada en el código a 8-sep-2026.

---

## 1. Diagnóstico

El front tiene uploader completo (`packages/web/src/components/PdfUploader.tsx`,
cableado en `Sidebar.tsx:254` con `onUploaded={refreshMaterials}`) y cliente HTTP
(`packages/web/src/api-client/upload.ts:22`, `POST ${apiUrl}/api/materials`).

**El endpoint no existe en ninguna capa:**

- `packages/shared/src/api/materials.ts`: `MaterialsApi` declara `list` (`GET /`),
  `get` (`GET /:id`) y `delete` (`DELETE /:id`). No hay `POST`.
- `packages/server/src/transport/http/server.ts:30`: la única ruta manual es
  `POST /api/tutor/chat/stream`.
- `packages/server/src/domain/materials/material.ts`: el puerto `MaterialRepository`
  expone `list`, `get`, `delete`, `renderPages`. **No hay método de escritura.**

Comprobado contra el servidor en marcha: `GET /api/materials/` → 200,
`POST /api/materials` → **404**. El error que ve el usuario ("Check that the server is
running") lo produce `upload.ts:47`, que trata cualquier status distinto de 200 y 400
como servidor caído.

Es un agujero de tres capas, no un bug puntual.

## 2. Invariantes que condicionan el diseño

Leer esto antes de escribir código. El orden de los pasos del §4 sale de aquí.

1. **Un PDF corrupto en el directorio rompe la lista entera, no solo ese material.**
   `listFiles()` (`file-material-repository.ts:28-55`) recorre *todos* los `.pdf` del
   directorio y ejecuta `pdf.pageCount(fullPath)` sobre cada uno en cada `list`, `get` y
   `renderPages`. Si `pdfinfo` falla en un fichero, el `Effect.forEach` falla entero →
   `MaterialRepositoryError` → el handler `list` hace `Effect.orDie`
   (`handlers.ts:28-31`) → 500 → sidebar vacía y app inservible.
   **Consecuencia dura: hay que validar el PDF antes de moverlo al directorio de
   materiales, nunca después.**

2. **El id sale del nombre de fichero.** `id: path.basename(fileName, ".pdf")`
   (`file-material-repository.ts:44`). Dos ficheros con el mismo nombre son imposibles en
   un directorio, pero un segundo upload del mismo nombre sobrescribiría el primero:
   pérdida de datos silenciosa. Hay que desambiguar en el momento de guardar.

3. **El nombre de fichero llega del cliente: es frontera de confianza.** Sin sanear,
   `fileName = "../../../etc/passwd.pdf"` escribe fuera del directorio. `delete` ya se
   protege resolviendo la ruta por listado y no por concatenación
   (`file-material-repository.ts:76-78`, con el comentario que lo explica). El guardado
   debe ser igual de estricto: sanear el nombre, no confiar en él.

4. **La validación del cliente es UX, no seguridad.** `PdfUploader.tsx:15-23` limita a
   25 MB y extensión `.pdf`, pero cualquiera puede hacer el POST a mano. El límite tiene
   que existir también en servidor.

5. **`effect@4.0.0-beta.83` sí soporta multipart en `HttpApi`.** Existen
   `HttpApiSchema.asMultipart` (`httpapi/HttpApiSchema.ts:537`) y
   `Multipart.SingleFileSchema` (`http/Multipart.ts:312`), que decodifica exactamente un
   fichero y da un `PersistedFile` con `{ key, name, contentType, path }` ya persistido en
   temporal. `NodeHttpServer.layer` aporta `NodeServices` (FileSystem + Path), así que la
   persistencia multipart tiene sus servicios sin cablear nada nuevo.

6. **El contrato de errores que el cliente ya espera.** `upload.ts:34-45`: acepta **200**
   con `PdfMaterial` en el cuerpo, y en **400** lee `JSON.parse(body).message`. Si el
   error tipado no lleva un campo `message`, el usuario verá un texto genérico.

## 3. Decisiones de diseño

**El upload va como endpoint de `HttpApi`, no como ruta manual.** El repo tiene un
precedente de ruta manual (`TutorStreamRoute`), pero existe porque `HttpApiBuilder` no
cubría el streaming NDJSON, y el precio fue quedarse fuera de OpenAPI y de `/docs`
(documentado en `funcionamiento-actual.md §2`). Multipart sí se expresa en `HttpApi`
(invariante 5), así que no hay motivo para pagar ese precio otra vez.

**El guardado es responsabilidad del `MaterialRepository`.** Es el dueño del directorio
de PDFs y de la derivación id/título desde el nombre. Poner la escritura en el handler
duplicaría esas reglas en otra capa.

**Validar en temporal y mover después.** Sale directo del invariante 1. La alternativa
—escribir y luego comprobar— deja una ventana en la que la lista está rota, y si el
borrado de limpieza falla la app queda inservible.

**Rechazado: aceptar base64 en JSON.** Evitaría multipart pero infla el cuerpo ~33%, se
come el progreso de subida real del `XMLHttpRequest` (`upload.ts:24-28`) y obliga a
cargar el fichero entero en memoria.

## 4. Pasos

### Paso 1 — Error de dominio y schema compartido

`packages/shared/src/schemas/material.ts`: añadir junto a `MaterialNotFoundError`

```ts
export const InvalidPdfError = Schema.TaggedStruct("InvalidPdf", {
  message: Schema.String
});
export type InvalidPdfError = typeof InvalidPdfError.Type;
```

El campo se llama `message` a propósito: es lo que ya lee `upload.ts:38` (invariante 6).

`packages/server/src/domain/materials/material.ts`: añadir el error de dominio siguiendo
el patrón de `MaterialNotFound` (`Data.TaggedError`), con el mismo campo `message`.

**Hecho cuando:** `pnpm run typecheck` pasa y el schema se exporta desde el barrel de
`shared` como los demás.

### Paso 2 — Endpoint en el contrato

`packages/shared/src/api/materials.ts`, dentro de `MaterialsApi.add(...)`:

```ts
HttpApiEndpoint.post("upload", "/", {
  payload: Schema.Struct({
    file: Multipart.SingleFileSchema
  }).pipe(HttpApiSchema.asMultipart({ maxFileSize: 25 * 1024 * 1024, maxParts: 2 })),
  success: PdfMaterial,
  error: InvalidPdfError.pipe(HttpApiSchema.status(400))
})
```

La clave `file` debe coincidir con `body.append("file", file)` de `upload.ts:18`.
`maxFileSize` refleja el límite del cliente (invariante 4).

**Hecho cuando:** el endpoint aparece en `GET /openapi.json` y en `/docs`.

**Ojo:** confirmar con `curl` que el status de éxito por defecto es **200** y no 201; el
cliente solo trata 200 como éxito (`upload.ts:34`). Si fuera 201, fijarlo con
`HttpApiSchema.status(200)` en el endpoint, no tocando el cliente.

### Paso 3 — `save` en el puerto del repositorio

`packages/server/src/domain/materials/material.ts`, en `interface MaterialRepository`:

```ts
readonly save: (input: {
  readonly fileName: string;
  readonly path: string;
}) => Effect.Effect<PdfMaterial, InvalidPdf | MaterialRepositoryError>;
```

`path` es el temporal que da multipart; `fileName` es el nombre original del cliente, sin
sanear todavía.

### Paso 4 — Helpers puros de nombre de fichero

En `packages/server/src/domain/materials/material.ts`, junto a `parsePageSelection` (que
ya es un helper puro exportado del dominio):

- `sanitizeFileName(raw: string): string` — aplicar en este orden:
  1. `path.basename(raw)` para tirar cualquier componente de directorio (invariante 3);
  2. quitar la extensión y filtrar el resto a `[A-Za-z0-9._ -]`, colapsando lo demás a `-`;
  3. recortar puntos y espacios de los extremos;
  4. si lo que queda es vacío o solo puntos, usar `material`;
  5. reañadir `.pdf` siempre en minúscula.
- `resolveFileNameCollision(name: string, taken: ReadonlySet<string>): string` — si
  `name` está libre lo devuelve; si no, prueba `nombre-2.pdf`, `nombre-3.pdf`… hasta
  encontrar hueco (invariante 2).

Ambas son puras y sin `Effect`: son las que se testean en el paso 8.

### Paso 5 — Implementar `save` en el repositorio de ficheros

`packages/server/src/infra/materials/file-material-repository.ts`, dentro de `make`,
reutilizando `fs`, `path`, `pdf`, `pdfPath` y `mapError` que ya existen ahí:

1. `yield* fs.makeDirectory(directory, { recursive: true })` — igual que `listFiles`.
2. `pageCount = yield* pdf.pageCount(tempPath)`. **Sobre el temporal, antes de mover**
   (invariante 1). Si falla, no propagar `MaterialRepositoryError`: convertirlo en
   `InvalidPdf` con mensaje legible ("That file is not a readable PDF."). Un PDF corrupto
   es error del usuario (400), no defecto del servidor (500).
3. `safeName = sanitizeFileName(input.fileName)`.
4. Leer los nombres ya ocupados con `listFiles()` y aplicar `resolveFileNameCollision`.
5. Mover el temporal al destino: `fs.rename(tempPath, destino)`. **Si falla con `EXDEV`**
   (temporal y `.data/` en volúmenes distintos), caer a copiar y borrar. No dar por hecho
   que el rename funciona.
6. Devolver el `PdfMaterial` construido con los mismos campos y el mismo criterio que
   `listFiles` (`file-material-repository.ts:42-49`) para que un material recién subido
   sea idéntico al que devuelve la lista.
7. Añadir `save` al objeto que devuelve `make` (junto a `list, get, delete, renderPages`).

**Hecho cuando:** typecheck pasa y subir dos veces el mismo nombre produce dos materiales
distintos, sin perder el primero.

### Paso 6 — Handler

`packages/server/src/transport/http/handlers.ts`, en `MaterialsHttpHandlers`, encadenando
tras `.handle("delete", ...)`:

```ts
.handle("upload", ({ payload }) =>
  materials.save({ fileName: payload.file.name, path: payload.file.path }).pipe(
    Effect.catchTag("InvalidPdf", (e) =>
      Effect.fail({ _tag: "InvalidPdf" as const, message: e.message })
    ),
    Effect.catchTag("MaterialRepositoryError", (e) => Effect.die(e))
  )
)
```

Mismo criterio que `delete` (`handlers.ts:33-40`): error de dominio → fallo tipado;
error de infraestructura → `Effect.die` (500). No usar `Effect.orDie` a secas, que
convertiría el 400 en 500.

### Paso 7 — Mensaje de error del cliente

`packages/web/src/api-client/upload.ts:46-49`: el fallback dice "Check that the server is
running" para cualquier status inesperado, que es justo lo que hizo indiagnosticable este
fallo. Cambiar la rama genérica por un mensaje que incluya el status
(p. ej. `Upload failed (HTTP ${xhr.status}).`) y dejar el aviso de servidor caído solo en
`xhr.onerror`, que es el caso en que realmente no hubo respuesta.

Es el único cambio necesario en el front: el refresco de la sidebar ya está cableado
(`Sidebar.tsx:254` → `refreshMaterials`, atom con `reactivityKeys: ["materials"]`).

### Paso 8 — Tests

`packages/server`: añadir suite para los helpers del paso 4, en línea con las suites
existentes, que cubren solo funciones puras:

- `sanitizeFileName`: quita ruta (`../../evil.pdf` → `evil.pdf`), colapsa caracteres
  raros, fuerza `.pdf`, y devuelve `material.pdf` ante un nombre vacío o solo puntos.
- `resolveFileNameCollision`: nombre libre intacto; una colisión → `-2`; dos → `-3`.

No montar tests de I/O ni de HTTP: el repo no tiene hoy esa infraestructura y el flujo
real se cubre en la verificación manual del §5.

## 5. Verificación

Automático, desde la raíz:

```bash
pnpm run typecheck
pnpm -r run test
pnpm --filter @proxus/web run build
```

Manual, con `pnpm run dev` levantado (requiere Poppler en el PATH):

```bash
# 1. PDF válido → 200 y JSON de PdfMaterial
curl -s -X POST -F "file=@ruta/a/valido.pdf" http://localhost:3000/api/materials

# 2. No-PDF → 400 con {"_tag":"InvalidPdf","message":"..."}
curl -s -X POST -F "file=@README.md" http://localhost:3000/api/materials

# 3. La lista sigue viva después del intento fallido — este es el check clave
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/materials/   # 200

# 4. Path traversal: el fichero cae dentro del directorio, con nombre saneado
curl -s -X POST -F "file=@valido.pdf;filename=../../pwned.pdf" http://localhost:3000/api/materials
ls packages/server/.data/materials/pdfs/    # pwned.pdf aquí dentro, y nada fuera

# 5. Colisión: subir dos veces el mismo nombre deja dos materiales
```

Y en la UI (`http://localhost:5173`): arrastrar un PDF, ver la barra de progreso, ver el
material aparecer en la sidebar sin recargar, y pedirle al tutor que lo lea.

El check 3 es el que prueba el invariante 1. Si tras el 400 la lista devuelve 500, la
validación se está haciendo en el sitio equivocado.

## 6. Documentación a actualizar

- `documentacion/funcionamiento-actual.md §5`: añadir `POST /api/materials` a la lista de
  superficie HTTP, y corregir la frase de §4 sobre que los PDFs solo llegan por disco.
- `docs/api.md`: documentar el endpoint nuevo.
- `docs/testing.md`: añadir la subida al QA manual.

## 7. Fuera de alcance

- Extracción de texto, RAG, `citas_pdf`: son las decisiones del ADR, no dependen de esto.
- Reemplazar un material existente (PUT). Hoy se borra y se vuelve a subir.
- Barra de progreso real de servidor: el progreso del `XMLHttpRequest` mide la subida del
  cliente, no el procesado; es suficiente.
---

# Anexo A — El botón `Stop` borra la conversación en vez de detenerla

Trabajo independiente del §1-§6. Se puede implementar antes o después; no comparte
ficheros con el upload.

## A.1. Síntoma y qué está pasando de verdad

Reportado como "el botón Stop no funciona, no detiene el razonamiento". La cancelación
del servidor **sí funciona**; lo que falla es que el cliente tira a la basura todo lo
recibido en ese turno, con lo que parece que nada se detuvo.

**Medido, no supuesto.** Servidor aislado en `:3010`, petición de streaming real, cliente
muerto a los 7 s:

| Ruta | `agent.step` | `gemini.request` | Cierre del span |
|---|---|---|---|
| Directo a `:3010` | 1 | 2 | 7135 ms |
| Por el proxy de Vite | 1 | 2 | 6810 ms |

En los dos casos la segunda llamada a Gemini se queda **sin `gemini.response`** y nunca
hay un `agent.step 2`: el bucle del agente muere en el instante del corte. La cadena
completa está bien: `NodeHttpServer.ts:195-197` interrumpe el fiber cuando la conexión se
cierra antes de tiempo, `Stream.callback` (`harness/session.ts:51`) ata el bucle al scope
del stream, y `gemini.ts:335-341` pasa el `signal` al `fetch`. El proxy de Vite propaga el
corte igual de bien.

**El defecto está en `packages/web/src/domain/tutor/use-tutor-chat.ts:74-83`:**

```ts
} catch (cause) {
  setMessages(history);   // ← también en un abort
  setInput(prompt);
  if (!isAbortError(cause)) {
    setError(...);
  }
}
```

Abortar hace que el `for await` lance, y el `catch` trata **fallo** y **parada
voluntaria** como lo mismo. Solo el mensaje de error se distingue por `isAbortError`; el
rollback no. Resultado al pulsar `Stop`: los mensajes del turno desaparecen, el prompt
vuelve al textarea y el chat queda como si nunca hubieras enviado nada. El usuario lee eso
como "no ha parado" — y encima pierde el razonamiento que ya había llegado.

Es una omisión del PR-10, no un límite de la plataforma. La nota de
`funcionamiento-actual.md §2` que dice que cancelar el fiber del servidor "no está
verificado en `4.0.0-beta.83`" **está desactualizada**: queda verificado aquí.

## A.2. Comportamiento correcto

`Stop` es una parada limpia, no un deshacer:

- **Conservar** los mensajes ya recibidos en el turno. Es lo que el usuario quería leer.
- **No** restaurar el prompt en el textarea: ese mensaje sí se envió y ya está en el hilo.
- **No** mostrar error (ya se cumple).
- **No** ofrecer `Retry`: no ha habido fallo. Limpiar `lastAttempt.current`.
- `status` vuelve a `"idle"` (ya se cumple, va en el `finally`).

Un fallo real mantiene el comportamiento actual: rollback, prompt restaurado, error y
`Retry`.

## A.3. Pasos

### Paso A1 — Separar abort de fallo en el `catch`

`packages/web/src/domain/tutor/use-tutor-chat.ts:74-83`. Ramificar antes de tocar estado:

```ts
} catch (cause) {
  if (isAbortError(cause)) {
    lastAttempt.current = undefined;   // parada limpia: no hay nada que reintentar
  } else {
    setMessages(history);
    setInput(prompt);
    setError(cause instanceof Error ? cause.message : "Something went wrong. Try again.");
  }
} finally {
  abortRef.current = undefined;
  setStatus("idle");
}
```

El `finally` no cambia.

**Ojo con el desmontaje:** el `useEffect` de `:37-39` aborta al desmontar el componente y
entra por esta misma rama. Es inofensivo —el componente ya no existe—, pero conviene no
añadir ahí nada que asuma que hay UI viva.

### Paso A2 — Marcar visualmente el turno detenido

Sin esto, un turno parado y uno terminado se ven idénticos, que es parte de por qué "no
parece que pare". Añadir estado `"stopped"` en el hook, expuesto junto a `status`, y
pintarlo en `Chat.tsx` como una línea discreta bajo el último mensaje del turno
(p. ej. *"Stopped"*), con tokens del design system (`text-ink-faint`), sin componente
nuevo. Se limpia al enviar el siguiente mensaje.

### Paso A3 — Test

`packages/web`, junto a la suite de `stream.ts` (hoy el único test del paquete, sobre
`isAbortError`): cubrir que un `AbortError` **no** revierte los mensajes y que un error
normal **sí**. Si testear el hook exige montar React y el repo no tiene hoy esa
infraestructura, extraer la decisión a una función pura —`resolveStreamFailure(cause)` →
`{ keepMessages: boolean; restoreInput: boolean; showError: boolean }`— y testear esa. La
segunda opción encaja mejor con el estilo actual del repo, que solo testea funciones
puras.

## A.4. Verificación

Con `pnpm run dev` y una pregunta larga (que fuerce varios pasos del agente):

1. Enviar, esperar a que aparezca al menos un mensaje del asistente, pulsar `Stop`.
   - Los mensajes recibidos **siguen en pantalla**.
   - El textarea queda **vacío**, no repoblado con el prompt.
   - No hay error ni botón `Retry`.
   - El botón vuelve a `Send`.
2. En la consola del servidor: el `http.span` de esa petición cierra en el momento del
   clic, y **no** aparecen más `agent.step` ni `gemini.response` de ese turno.
3. Enviar un mensaje nuevo después: el hilo continúa con lo que quedó en pantalla.

El punto 2 ya está probado; sirve como no-regresión.

## A.5. Documentación a actualizar

`documentacion/funcionamiento-actual.md §2`: sustituir la nota de PR-10 que da la
cancelación del servidor por no verificada. Queda verificada, con el método y los números
de A.1.

