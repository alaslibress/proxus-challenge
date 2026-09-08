# PR-13 — Borrar materiales, cerrar artefactos y renombrar el producto

- **Rama**: `feat/ux-materiales-artefactos`
- **Depende de**: PR-09 (subida de PDFs). El borrado comparte endpoint, repositorio y fila
  de UI con la subida; hacerlo antes obligaría a tocar los mismos ficheros dos veces.
- **Orden de ejecución**: después del PR-09. Los otros dos bloques (cerrar artefacto,
  renombrar) no dependen de nada y podrían adelantarse si el PR-09 se retrasa: ver
  *Riesgos y decisiones*.
- **Conflicto conocido**: toca `Sidebar.tsx`, `App.tsx` y `ArtifactWorkspace.tsx`. El PR-07
  reescribe `ArtifactWorkspace.tsx` entero. **Este PR va antes**; el thinker revisará el
  PR-07 tras el merge.
- **Estado**: borrador
- **Contiene LLM**: no.
- **Origen**: reporte de uso del 7 de septiembre de 2026. Cuatro incidencias observadas
  usando la aplicación.

> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.

---

## Problema

Cuatro cosas rotas o ausentes, observadas usando la aplicación:

1. **No se puede borrar un material.** El puerto `MaterialRepository`
   (`domain/materials/material.ts:36-43`) tiene `list`, `get` y `renderPages`. El PR-09
   añade `create`. **No hay borrado en ninguna capa**, así que un PDF subido por error se
   queda para siempre, y la única salida es entrar en `packages/server/.data/materials/pdfs`
   por consola.

2. **Se entra en un artefacto y no se sale.** `App.tsx:13-19`:

   ```tsx
   gridTemplateColumns: selectedArtifactId === null
     ? "252px minmax(0, 1fr)"
     : "252px minmax(0, 1fr) 420px"
   ...
   <Sidebar selectedArtifactId={selectedArtifactId} onSelectArtifact={setSelectedArtifactId} />
   ```

   `setSelectedArtifactId` sólo se llama para **seleccionar**. No hay ni un camino en toda
   la interfaz que lo devuelva a `null`. Al abrir un artefacto el chat se encoge a 420px y
   se queda así hasta que recargas la página — perdiendo la conversación, que vive sólo en
   memoria (`Chat.tsx:18`).

3. **El botón de subir PDF desaparece tras subir el primero.** Reportado en uso. **El
   PR-09 todavía no está implementado**, así que no se puede corregir sobre código: se
   arregla como criterio de aceptación dentro del propio PR-09. Ver *Fuera de alcance*.

4. **El producto se llama Proxus Tutor y tiene que llamarse My Favorite Teacher.**

## Objetivo

Que se pueda deshacer lo que se hace: borrar un PDF subido por error y cerrar un artefacto
para recuperar el chat completo. Y que el producto lleve su nombre.

## Fuera de alcance

- **El botón de subida que desaparece.** No hay código que arreglar todavía: el uploader no
  existe en el árbol. Se resuelve en el PR-09, cuyo §Paso 6.6 ya prevé que tras el éxito el
  componente vuelva a `idle` a los 4 s. **El thinker añade a ese plan un criterio de
  aceptación explícito**: *"el control de subida permanece visible y utilizable después de
  subir un PDF, con la lista de materiales llena"*. Si aun así desaparece al implementarlo,
  es un bug del PR-09 y se corrige allí.
- **Renombrar el paquete, el repositorio o los identificadores.** `@proxus/web`,
  `@proxus/server`, `@proxus/shared`, el tag `"@proxus/server/materials/MaterialRepository"`
  y el nombre del repo **no se tocan**. Ver *Riesgos y decisiones*.
- **Papelera, deshacer o borrado en lote.** Un borrado, con confirmación, y ya.
- **Borrar artefactos.** No se ha pedido, y arrastra la pregunta de qué pasa con los
  intentos ya corregidos que cuelgan de ellos.
- **Que el agente pueda borrar materiales** (`materials delete`). El borrado lo decide la
  persona.

## Contratos afectados

### `packages/shared/src/api/materials.ts` — endpoint de borrado

```ts
HttpApiEndpoint.del("delete", "/:id", {
  params: { id: Schema.String },
  success: Schema.Void.pipe(HttpApiSchema.status(204)),
  error: MaterialNotFoundError.pipe(HttpApiSchema.status(404))
})
```

1. Verificar el nombre real del constructor de `DELETE` en
   `effect/unstable/httpapi@4.0.0-beta.83` (`HttpApiEndpoint.del` o `.delete`). **Si no es
   ninguno de los dos, para y notifica.**
2. `HttpApiSchema.Empty(204)` (`HttpApiSchema.ts:180`) puede ser lo correcto en lugar de
   `Schema.Void.pipe(status(204))`. Elegir el que compile y dejarlo anotado.

### `packages/shared/src/schemas/material.ts`

```ts
export const MaterialNotFoundError = Schema.TaggedStruct("MaterialNotFound", {
  materialId: Schema.String
});
```

Sigue el estilo que el PR-09 dejó con `MaterialUploadRejected` (`Schema.TaggedStruct`).

### Puerto de dominio

```ts
// domain/materials/material.ts, dentro de MaterialRepository
readonly delete: (
  id: string
) => Effect.Effect<void, MaterialNotFound | MaterialRepositoryError>;
```

`MaterialNotFound` ya existe (`material.ts:23-34`). No se inventa un error nuevo.

## Pasos

### Bloque A — Borrar materiales

#### Paso 1 — Dominio e infraestructura

1. [ ] Añadir `delete` al puerto `MaterialRepository`.
2. [ ] Implementarlo en `infra/materials/file-material-repository.ts`, reutilizando el
       helper `getFile`/`listFiles` que ya resuelve un id a su ruta:
   - id inexistente → `MaterialNotFound`.
   - `fs.remove(pdfPath)` → error de disco a `MaterialRepositoryError`.
3. [ ] **Resolver la ruta por el repositorio, nunca concatenando el id de la petición.**
       El id llega de la URL y es `string`; `path.join(directory, `${id}.pdf`)` con un id
       tipo `../../algo` sale del directorio. Como el repositorio ya deriva la ruta de un
       listado real de ficheros, basta con exigir que el id **esté en la lista** antes de
       borrar. Si el doer implementa el borrado por concatenación directa, es un fallo de
       seguridad, no un detalle de estilo.
4. [ ] `noUncheckedIndexedAccess` está activo: `params.id` es `string | undefined`.
       Tratarlo, no forzarlo con `!`.

#### Paso 2 — Handler

1. [ ] En `transport/http/handlers.ts`, grupo `materials`, añadir `.handle("delete", ...)`
       mapeando `MaterialNotFound` al error tipado y el resto a `Effect.orDie`.
2. [ ] Igual que el `upload` del PR-09: **no** `orDie` para el 404. Un id que no existe es
       un caso de uso.

#### Paso 3 — UI

1. [ ] En la fila de material de `Sidebar.tsx`, un botón de borrado a la derecha del
       contador de páginas. **Visible siempre**, no sólo en `hover`: un control que sólo
       aparece al pasar el ratón no existe en táctil ni con teclado.
2. [ ] `aria-label={`Delete ${material.title}`}`. Icono o `×`, tamaño de golpeo mínimo
       24×24.
3. [ ] **Confirmación en dos pasos, dentro de la propia fila**: el primer clic cambia el
       botón a `Confirm`; el segundo borra; sale del estado de confirmación al hacer clic
       fuera, al pulsar `Escape` o a los 5 s. **No usar `window.confirm`**: bloquea el hilo
       y rompe el lenguaje visual del PR-1.5.
4. [ ] Estilos con tokens (`documentacion/design-system.md`): estado normal
       `text-ink-faint`, hover `text-danger`, estado de confirmación
       `bg-danger-tint text-danger-ink border-danger-line`. **Prohibida cualquier clase de
       color literal**; el guard del PR-1.5 §Paso 8 tiene que seguir dando 0.
5. [ ] Tras borrar, refrescar la lista con `useAtomRefresh(materialsQuery)` — mismo patrón
       que usa el uploader del PR-09.
6. [ ] Mientras el borrado está en vuelo, la fila queda a `opacity-50` y el botón
       deshabilitado.
7. [ ] Si el borrado falla, mensaje legible en `text-danger` bajo la lista. Nunca
       `String(error)` crudo.

### Bloque B — Cerrar el artefacto

#### Paso 4 — `App.tsx`

1. [ ] Pasar a `ArtifactWorkspace` una prop nueva:
       `onClose: () => setSelectedArtifactId(null)`.
2. [ ] No cambiar nada más: las columnas ya vuelven solas a `252px minmax(0,1fr)` cuando
       `selectedArtifactId` es `null`, y el chat recupera el ancho completo.

#### Paso 5 — `ArtifactWorkspace.tsx`

1. [ ] Botón de cierre en la cabecera del panel, alineado a la derecha. Etiqueta visible
       `Close`, no sólo un icono: es la salida de un callejón sin salida y tiene que
       leerse.
2. [ ] `aria-label="Close artifact"`, receta de botón secundario del sistema de diseño.
3. [ ] Atajo `Escape` para cerrar, con un `useEffect` que registre y **desregistre** el
       listener. Ojo: no debe dispararse mientras se escribe en un campo del artefacto —
       comprobar `event.target` antes.

#### Paso 6 — Volver a pulsar el artefacto seleccionado

1. [ ] En `Sidebar.tsx`, si se pulsa el artefacto ya seleccionado, se cierra
       (`onSelectArtifact` deja de ser suficiente; hará falta una prop de alternancia o que
       `App` compare y decida). **Decidirlo en `App.tsx`**, para que `Sidebar` siga siendo
       tonto:

   ```tsx
   onSelectArtifact={(id) => setSelectedArtifactId((current) => current === id ? null : id)}
   ```

2. [ ] `aria-pressed` en el botón de la fila, que ahora es un conmutador de verdad.

### Bloque C — El nombre

#### Paso 7 — Cadenas de interfaz

1. [ ] `packages/web/src/components/Sidebar.tsx`: `Proxus Tutor` → **`My Favorite
       Teacher`** en el bloque de marca.
2. [ ] `packages/web/src/index.html`: `<title>Proxus Tutor</title>` → `My Favorite Teacher`.
3. [ ] `Chat.tsx`, el `<h1>` dice `Academic tutor`: **no se toca**. Es el nombre del
       agente dentro del producto, no el del producto. Si producto quiere cambiarlo
       también, que lo diga; no se decide de paso.
4. [ ] La letra del logo es `P` (`Sidebar.tsx`, bloque de marca) → pasa a `M`. El gradiente
       de marca no cambia.
5. [ ] Barrer el resto con:

   ```bash
   grep -rn "Proxus Tutor" packages docs documentacion *.md
   ```

   Cambiar sólo lo que **ve una persona usando la aplicación** o lo que lee alguien
   evaluando la entrega: `README.md`, `docs/getting-started.md` y cualquier otro texto de
   producto.

#### Paso 8 — Lo que NO se renombra

1. [ ] `@proxus/web`, `@proxus/server`, `@proxus/shared`, `@proxus/ai-google`: **no**.
2. [ ] Tags de servicio como `"@proxus/server/materials/MaterialRepository"` y
       `"proxus-web/ApiClient"`: **no**. Son identificadores de runtime.
3. [ ] El nombre del repositorio y las rutas del disco: **no**.
4. [ ] Añadir una línea a `documentacion/design-system.md` o a `AGENTS.md` diciendo que el
       nombre de producto es *My Favorite Teacher* y que el prefijo `@proxus/*` es
       histórico y se queda. Sin esa nota, el próximo agente "arreglará" la inconsistencia.

### Paso 9 — Documentación

1. [ ] `docs/api.md`: `DELETE /api/materials/:id`.
2. [ ] `documentacion/funcionamiento-actual.md` §5 y §7: el borrado existe; el artefacto se
       cierra.
3. [ ] Entrada del PR-13 en `documentacion/dificultades.md`, con el formato
       Síntoma / Causa / Solución / Descartado que fija el PR-09.

## Criterio de aceptación

- [ ] Cada material de la lista tiene un botón de borrado visible sin pasar el ratón.
- [ ] El primer clic pide confirmación en la propia fila; el segundo borra.
- [ ] `Escape` o un clic fuera cancelan la confirmación.
- [ ] Tras borrar, el material desaparece de la lista sin recargar, y el fichero ya no está
      en `packages/server/.data/materials/pdfs`.
- [ ] Borrar un id inexistente devuelve 404 con un cuerpo tipado, no un 500.
- [ ] Un id con `../` no borra nada fuera del directorio de materiales.
- [ ] El agente deja de ver el material borrado en `materials list`.
- [ ] Abrir un artefacto y pulsar `Close` devuelve el chat al ancho completo **sin perder
      la conversación**.
- [ ] `Escape` cierra el artefacto, salvo escribiendo dentro de un campo.
- [ ] Volver a pulsar el artefacto seleccionado en el sidebar lo cierra.
- [ ] El sidebar y la pestaña del navegador dicen **My Favorite Teacher**; el logo es `M`.
- [ ] `grep -rn "Proxus Tutor" packages docs documentacion *.md` no devuelve nada visible
      para el usuario.
- [ ] Los paquetes siguen llamándose `@proxus/*` y todo compila.
- [ ] El guard de clases literales del PR-1.5 sigue dando **0**.

## Checks

```bash
pnpm run typecheck
pnpm --filter @proxus/web run build

# borrado
curl -sS -X POST http://localhost:3000/api/materials -F "file=@/ruta/a/apuntes.pdf" | jq -r .id
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:3000/api/materials/apuntes   # 204
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:3000/api/materials/no-existe # 404
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:3000/api/materials/../../etc/passwd
ls packages/server/.data/materials/pdfs

# nombre
grep -rn "Proxus Tutor" packages docs documentacion *.md
grep -rn "@proxus/" packages/*/package.json    # intactos

# sistema visual intacto
grep -rnE '(bg|text|border|ring|from|to|via)-(slate|sky|indigo|emerald|red|blue|gray|zinc|neutral)-[0-9]{2,3}' packages/web/src --include=*.tsx
```

## QA manual

1. Subir dos PDFs. Comprobar que **el control de subida sigue visible** con la lista llena
   (criterio heredado del PR-09).
2. Borrar uno: primer clic → `Confirm`, segundo → desaparece. Verificar en disco.
3. Empezar la confirmación y pulsar `Escape`: no se borra nada.
4. Preguntar en el chat *"lista mis materiales"*: sólo aparece el que queda.
5. Escribir tres o cuatro mensajes en el chat. Abrir un artefacto: el chat se encoge pero
   los mensajes siguen ahí.
6. Pulsar `Close`: el chat vuelve al ancho completo **con la conversación intacta**.
7. Repetir cerrando con `Escape` y volviendo a pulsar el artefacto en el sidebar.
8. Recargar y comprobar que la pestaña dice *My Favorite Teacher*.

## Riesgos y decisiones

- **Confirmación en la fila en vez de `window.confirm`.** El diálogo nativo bloquea el hilo
  y no se puede tematizar: rompería el sistema visual del PR-1.5 en la primera acción
  destructiva de la aplicación. El coste es más estado en el componente.

- **Borrado sin papelera.** Es irreversible y el fichero desaparece del disco. Aceptable
  porque el material se puede volver a subir desde el PR-09, y una papelera exigiría un
  modelo de datos que hoy no existe (el id **es** el nombre del fichero). Queda dicho en la
  documentación.

- **Los artefactos generados desde un material borrado sobreviven.** Los artifacts no
  guardan de qué material salieron —es un límite duro conocido (`plan.md` §9)— así que
  borrar un PDF no rompe nada, pero deja artefactos huérfanos de su origen. **El PR-02
  añade ese enlace**; cuando exista, habrá que decidir qué hace el borrado con ellos.
  Anotarlo en el cuerpo del PR.

- **Renombrar sólo la superficie visible.** Cambiar `@proxus/*` tocaría los cuatro
  `package.json`, el `pnpm-workspace.yaml`, todos los imports y los tags de servicio de
  Effect, para cero beneficio de producto y un riesgo alto de romper la entrega. El nombre
  del producto y el del paquete pueden diferir; pasa en la mitad de los repos del mundo.
  Lo que no puede pasar es que nadie lo haya escrito: de ahí el Paso 8.4.

- **Este PR depende del PR-09 y el PR-09 aún no está implementado.** Si hiciera falta
  desbloquear al usuario antes, los bloques **B** (cerrar artefacto) y **C** (nombre) son
  independientes y se pueden sacar en un PR propio de media hora. El bloque A no: comparte
  endpoint, repositorio y fila de UI con la subida. **Si se parte, el thinker lo divide; el
  doer no reordena por su cuenta.**

- **`Escape` con dos dueños.** Cierra el artefacto y también cancela la confirmación de
  borrado. Si algún día conviven en pantalla, gana la confirmación. Está en el Paso 5.3 y
  hay que respetarlo.

## Historial

- *(vacío)*
