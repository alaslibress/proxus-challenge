# Guía del implementador (doer)

Punto de entrada operativo. Si vas a escribir código en este repo, empieza aquí.

Esta guía **no sustituye a los planes**: dice cómo trabajar con ellos. El detalle de qué
hacer está en cada `planes/pr-NN-*/plan.md`.

---

## 1. Tu papel en dos frases

Implementas **exactamente** lo que dicta un plan, paso a paso, en el orden indicado. Si
algo del plan es falso, ambiguo o incoherente, **paras y lo notificas antes de
implementarlo**.

Lo que **no** haces, nunca:

- **No editas ningún `plan.md`.** Son entrada de solo lectura. Las correcciones las
  escribe el thinker en la sección `Historial` del plan.
- **No añades alcance.** Ni features, ni refactors de paso, ni "ya que estoy".
- **No falseas la autoría.** Firmas tu trabajo como lo que es; la norma exacta, en §7.

Si detectas un problema, la respuesta correcta es *"el paso 4 dice X pero el código hace
Y, ¿cómo procedo?"*, no arreglarlo por tu cuenta y seguir.

---

## 2. Antes de tocar nada

### Lectura obligatoria, en este orden

1. [`documentacion/contexto-repo.md`](../documentacion/contexto-repo.md) — arquitectura,
   comandos y trampas.
2. [`documentacion/funcionamiento-actual.md`](../documentacion/funcionamiento-actual.md) —
   cómo funciona el repo **hoy**, con ruta y línea.
3. [`plan.md`](./plan.md) §7 y §9 — contexto técnico y límites duros.
4. El plan del PR que te toca, **entero**, antes de escribir la primera línea.

Los dos ADR ([ADR-01](../documentacion/adr-motor-evaluacion.md),
[ADR-02](../documentacion/adr-02-evaluacion-transporte-observabilidad.md)) explican **por
qué** el sistema es como es. Cada uno lleva al final una sección *Notas del thinker* con
los puntos donde la decisión choca con el código real.

### Entorno

```bash
node --version          # 20+
pnpm --version          # el repo declara packageManager pnpm@10.23.0
pdfinfo -v && pdftoppm -v && pdftotext -v   # los tres, desde el PR-02
pnpm install
cp .env.example .env    # y rellena GOOGLE_GENERATIVE_AI_API_KEY
```

**`packages/server/.data/` no existe en un checkout limpio.** Sin esto la QA manual de
casi todos los planes no significa nada:

```bash
mkdir -p packages/server/.data/materials/pdfs
# copia ahí un PDF real CON capa de texto (apuntes, no un escaneo)
```

El id del material es el nombre del fichero sin `.pdf`.

### El gate

No hay eslint. **Sí hay test runner**, y no lo trajo ningún PR de esta serie: vitest entró
en el commit `03a8d80` *"test: add unit test suite with vitest (22 tests, all passing)"*,
**anterior** a PR-03 (`cd8d136`) y a PR-04 (`564406e`). Hoy: `vitest ^5.0.0` como
devDependency en `packages/server` (`package.json:26`, scripts `test`/`test:watch` en
`package.json:16-17`, config en `vitest.config.ts`) y en `packages/web`
(`package.json:29`, scripts en `package.json:11-12`). Ambas configs recogen
`src/**/*.test.ts` con `environment: "node"`. El gate es:

```bash
pnpm run typecheck                    # obligatorio, no negociable
pnpm -r test                          # sin API key ni red  (alias: pnpm run test, package.json:12)
pnpm --filter @proxus/web run build
```

**No hay cifra de tests que memorizar. La regla es: anota el recuento de `pnpm -r test`
antes de empezar y no lo dejes bajar.** Un plan puede añadir tests; ninguno puede restarlos
sin decirlo. Si al terminar hay menos tests que al empezar, has roto algo o has borrado
cobertura: para y repórtalo. (Referencia del 08-sep-2026, para que veas el orden de
magnitud: 15 ficheros / 137 tests — 12/117 en `server`, 3/20 en `web`. La cifra caduca; la
regla no.)

Todos los tests son deterministas y corren **sin API key ni red**.

Ejecuta `typecheck` **al terminar cada paso** de un plan, no solo al final. Cada paso está
escrito para dejar el repo compilando.

---

## 3. El roadmap, que ya está cerrado

**Los 16 planes de `planes/` están implementados.** Los 15 primeros están mergeados en
`main`; el último es el PR-08, que aterrizó en `cc9f989` y vive en la rama
`feat/evals-entrega` —con el PR #7 todavía abierto—, sobre la que después han seguido
entrando commits de documentación. No queda ninguno pendiente, así que esta tabla ya no es
una cola de trabajo: es el **registro del orden real en que se hicieron**, y sirve para dos
cosas.

1. **Arqueología.** Cuando el código te sorprenda, el plan del PR que lo introdujo explica
   el porqué mejor que cualquier comentario.
2. **Precedente.** Si te encargan trabajo nuevo, el plan más parecido de la tabla es tu
   plantilla de estilo y de nivel de detalle.

El orden no fue el numérico: los PRs 1.5, 09, 10, 11, 12, 12.1, 12.2 y 13 se colaron entre
el 01 y el 02 porque se añadieron después de escribir el roadmap. El 1.5 fue el primero de
ese bloque porque fija el sistema visual que los demás usan. PR-04, PR-05 y PR-06 se
encadenan sobre la firma de `evaluate`.

| # | Rama | En una línea |
|---|------|--------------|
| [01](./pr-01-ssot-schemas/plan.md) | `refactor/ssot-schemas` | Una sola declaración de cada schema, en `shared`. Sin cambio de comportamiento. |
| [1.5](./pr-1.5-sistema-visual/plan.md) | `feat/sistema-visual` | Tokens, fuentes Geist y tema claro. Toda UI posterior sale de aquí. |
| [09](./pr-09-materiales-upload/plan.md) | `feat/materiales-upload` | Subir PDFs desde la UI. Quita el paso manual de copiar a `.data/`. |
| [12](./pr-12-fuga-tool-calls/plan.md) | `fix/fuga-tool-calls` | La tool call se fuga como texto al chat. Observabilidad primero, luego arreglo. |
| [12.1](./pr-12-1-fuga-tool-calls-reintento/plan.md) | `fix/fuga-tool-calls-reintento` | El PR-12 no cerró la fuga. Señal fiable y reintento. |
| [12.2](./pr-12-2-tool-calls-estructural/plan.md) | `fix/tool-calls-estructural` | Las tool calls dejan de viajar como texto. Se borran las tres regex. |
| [13](./pr-13-ux-materiales-artefactos/plan.md) | `feat/ux-materiales-artefactos` | Borrar materiales, cerrar artefactos, renombrar a My Favorite Teacher. |
| [10](./pr-10-chat-input-lifecycle/plan.md) | `fix/chat-input-lifecycle` | El input se limpia y se bloquea al enviar. Stop y reintento. |
| [11](./pr-11-agente-cortocircuito/plan.md) | `perf/agente-cortocircuito` | El agente deja de encadenar tools para contestar lo obvio. |
| [02](./pr-02-evidencia-pagina/plan.md) | `feat/evidencia-pagina` | `pdftotext`, enlace pregunta→página y verificador de citas. |
| [03](./pr-03-structured-output/plan.md) | `feat/structured-output` | Contrato del Juez y modo JSON nativo en Gemini. |
| [04](./pr-04-evaluation-engine/plan.md) | `feat/evaluation-engine` | El panel de tres agentes. Aquí está el producto. |
| [05](./pr-05-transporte-ndjson/plan.md) | `feat/transporte-ndjson` | Endpoint de streaming y lector NDJSON resiliente. |
| [06](./pr-06-trazabilidad/plan.md) | `feat/trazabilidad` | Traza auditable en Markdown. |
| [07](./pr-07-ui-observabilidad/plan.md) | `feat/ui-observabilidad` | Los tres agentes visibles y las citas con su badge. |
| [08](./pr-08-evals-entrega/plan.md) | `feat/evals-entrega` | Evals sin API key y README. **No recortable.** |

El plan de recorte que esta sección traía —tirar el PR-06, luego el resaltado de citas del
PR-07, luego casos del panel del PR-08— **no llegó a usarse**: entraron los tres enteros.
Se elimina para que nadie lo lea como una autorización a recortar trabajo nuevo.

---

## 4. Rutina por PR

Con el roadmap cerrado, esta rutina se aplica al trabajo nuevo: cada encargo se convierte
en un plan del thinker bajo `planes/` antes de que tú escribas nada. Si te llega trabajo
sin plan, pídelo; la plantilla obligatoria está en `planes/plan.md:213-253`.

1. **Lee el plan entero.** Incluidas las secciones *Riesgos y decisiones* y *Fuera de
   alcance*: te ahorran discusiones contigo mismo a mitad.
2. **Verifica las premisas.** Casi todos los planes empiezan con un paso 0 o una
   comprobación previa (el `diff` del PR-01, por ejemplo). **Si no cuadra, para.**
3. `git switch -c <rama>` desde `main` actualizado.
4. **Implementa paso a paso, en orden.** No adelantes pasos ni agrupes.
5. `pnpm run typecheck` tras cada paso.
6. Ejecuta la sección **Checks** completa.
7. Haz la **QA manual** del plan. No la saltes: varios criterios de aceptación solo se ven
   ahí.
8. Repasa el **Criterio de aceptación** punto por punto.
9. Abre el PR (§7).

### Cuando el plan y el código no coinciden

Para. Reporta con este formato:

```
PR-04, paso 3.
El plan dice: "usar Effect.either sobre cada profe".
El código/paquete: Effect.either no existe en effect@4.0.0-beta.83.
Opciones que veo: (a) Effect.result, (b) mode:"result" en Effect.all.
¿Cómo procedo?
```

Ruta, cita literal, hecho observado, opciones. No lo arregles y sigas: puede que la
premisa equivocada invalide pasos posteriores.

---

## 5. Trampas del repo

Estas ya han costado tiempo. Ninguna la caza el compilador hasta que es tarde.

### TypeScript y módulos

- **Los imports relativos llevan `.ts`.** `rewriteRelativeImportExtensions`
  (`tsconfig.json:9`). `from "./citation"` no compila; `from "./citation.ts"` sí. Los
  imports de paquete (`@proxus/shared`) van **sin** extensión.
- **`exactOptionalPropertyTypes: true`.** No puedes pasar `{ source: undefined }`. Usa
  spread condicional: `...(source === undefined ? {} : { source })`.
- **`noUncheckedIndexedAccess: true`.** `params.id` de un path param es
  `string | undefined`. Trátalo, no lo fuerces con `!`.
- **`noFallthroughCasesInSwitch` + switch exhaustivos.** Añadir una variante a
  `AgentMessage` rompe el `switch (message.role)` de `renderPrompt`
  (`packages/server/src/domain/agents/harness/session.ts:175-232`). Por eso los eventos
  nuevos van en las uniones de *frames*, discriminadas por `type`, nunca en `AgentMessage`.

### Effect v4 beta (`4.0.0-beta.83`)

Verificado leyendo el paquete. Si vienes de v3, aquí es donde te vas a tropezar:

| No existe | Usa |
|-----------|-----|
| `Effect.either` | `Effect.result` |
| `Effect.fork`, `Effect.forkDaemon` | `Effect.forkDetach` (los otros atan el fiber al scope de la petición) |
| `@effect/schema/JSONSchema` | `Schema.toJsonSchemaDocument(schema, opts)` |
| Zod | `import { Schema } from "effect"` — barrel raíz, no `effect/unstable/schema` |

- `Effect.all(arg, { concurrency, mode: "result" })` ejecuta todo y **nunca falla**. Es la
  forma idiomática de los fallbacks. **`Promise.all` está prohibido** por la Tech Spec.
  Ejemplo vivo: el panel de profes en
  `packages/server/src/domain/evaluation/engine.ts:79`.
- `Effect.forkDetach` en producción: la escritura de la traza fuera del camino crítico,
  `packages/server/src/infra/evaluation/file-evaluation-trace.ts:31`.
- `LanguageModel.generateObject` **ya existe** y `gemini.ts` ya usa `LanguageModel.make`.
  No construyas un servicio de structured output: solo hay que honrar `responseFormat`. Ya
  se usa en el Juez (`domain/evaluation/engine.ts:103`) y en la comprobación manual
  (`domain/agents/structured-output.check.ts:10`).
- `generateObject` concatena las partes `type:"text"` y decodifica con
  `Schema.fromJsonString`. Los fallos salen como `AiError.StructuredOutputError`.

### Repo

- **No crees `packages/web/src/api/`.** `vite.config.ts:9` tiene `root: "src"`, así que ese
  directorio se serviría como estático y **taparía el proxy** `^/api(?:/|$)`
  (`vite.config.ts:14-19`). El cliente vive en `src/api-client/`.
- **Ya no hay CSS generado en el repo.** Hubo un `packages/web/src/styles.generated.css`
  construido por un script; **no existe**. Hoy Tailwind v4 corre como **plugin de Vite**:
  `@tailwindcss/vite` (`packages/web/package.json:26`) registrado en
  `packages/web/vite.config.ts:3,10`. El único fichero de estilos del repo es
  `packages/web/src/styles.input.css`, importado desde
  `packages/web/src/main.tsx:5`, y es el que editas. Empieza con `@import "tailwindcss"` y
  dos `@source` —`./**/*.{ts,tsx,html}` y `../node_modules/streamdown/dist/*.js`— seguidos
  del bloque `@theme` con los tokens (`styles.input.css:1-6`). Consecuencias prácticas: no
  hay paso de build de CSS que lanzar a mano, `pnpm run dev` y
  `pnpm --filter @proxus/web run build` lo hacen solos, y **si añades una clase en un
  fichero que no case con esos `@source`, Tailwind no la genera.**
- **Prohibida cualquier clase de color literal de Tailwind en `packages/web`** desde el
  PR-1.5. El color sale de un token de `@theme` de `styles.input.css`. La norma y las
  recetas están en `documentacion/design-system.md`; el guard es el `grep` de
  `documentacion/design-system.md:275` y **tiene que dar 0 aciertos** antes de abrir un PR
  de UI. La copia de ese guard en `pr-1.5-sistema-visual/plan.md` leía el
  `styles.generated.css` difunto; corregida el 08-sep-2026. Ante la duda, la versión
  canónica es la de `design-system.md`.
- **El estado del chat no vive en el componente.** `components/Chat.tsx` es presentación:
  consume el hook `useTutorChat` (`Chat.tsx:4,13`), y toda la lógica —estado, envío,
  `AbortController`, Stop y reintento— está en
  `packages/web/src/domain/tutor/use-tutor-chat.ts:26`, desde el PR-10. Si un plan te manda
  tocar "la lógica del chat", el fichero es ese, no `Chat.tsx`. El mismo patrón se repite
  en artefactos: los atoms están en `packages/web/src/domain/artifacts/`
  (`atoms.ts`, `evaluation-atoms.ts`, `attempt-stream.ts`).
- **Los contratos van en `packages/shared`.** `shared` no puede importar de `server` ni de
  `web`: la dirección es `web → shared ← server`.
- **Las rutas de `HttpRouter` llevan `/api` escrito literalmente.** El `.prefix("/api")` del
  `HttpApi` (`packages/shared/src/api/Api.ts:10`) no les aplica. Las dos que hay son
  `POST /api/tutor/chat/stream` y `POST /api/artifacts/:id/submit/stream`
  (`packages/server/src/transport/http/server.ts:48,68`).
- **Cualquier cambio del protocolo NDJSON mueve server y web en el mismo PR.** El motivo ya
  no es que el stream muera: desde el PR-05 el lector es tolerante y una línea que no
  decodifica se salta con `console.warn` sin cortar el generador
  (`packages/web/src/lib/ndjson.ts:17-24,38-46`). El riesgo hoy es **silencioso**: el frame
  nuevo se descarta y la UI se queda a medias sin error visible.
- **`node --env-file=<fichero>` aborta si el fichero no existe.** Los scripts que deben
  correr sin `.env` van sin la bandera. Ninguno de los scripts de `packages/server` corre
  sin ella salvo `test` y `typecheck` (`packages/server/package.json:8-17`).
- **`toolParameters` (`packages/server/src/domain/agents/gemini.ts:154-183`)** hardcodea
  esquemas JSON por nombre de tool (`load_skill`, y `use_tool`/`run_command`/`cli`) con un
  `default` de `{a, b}` heredado del agente de sumas. Si añades una tool al harness sin
  tocar ese switch, se anuncia a Gemini con el esquema equivocado. Ningún plan del roadmap
  necesitó añadir tools; si el trabajo nuevo lo necesita, ese switch es lo primero.

---

## 6. Comandos

Todos verificados contra los `package.json` de hoy.

```bash
pnpm run dev                                   # server :3000 + web :5173 (package.json:9)
pnpm run typecheck                             # el gate (package.json:11 → pnpm -r typecheck)
pnpm run test                                  # alias de pnpm -r test (package.json:12)
pnpm --filter @proxus/web run build
pnpm --filter @proxus/server run dev           # solo backend
pnpm --filter @proxus/server run test:watch    # vitest en watch; también en @proxus/web
```

Los que **necesitan API key** (todos van con `node --env-file=../../.env`,
`packages/server/package.json:8-14`):

| Script | Qué hace |
|--------|----------|
| `agent:tutor "lista mis materiales"` | El tutor completo por CLI |
| `agent:sum`, `agent:math` | Los dos agentes de juguete del harness |
| `eval:tutor:artifact-authoring` | Eval con LLM de la creación de artefactos |
| `structured-output:check` | Comprobación manual del modo JSON nativo (PR-03) |
| `panel:check` | Comprobación manual del panel de tres agentes (PR-04) |

Los scripts `eval:pure` y `eval:panel` que una versión previa de esta tabla anunciaba
**nunca existieron**: eran la forma de tener evals deterministas cuando no había runner.
Con vitest instalado, ese contenido vive en `src/**/__tests__/*.test.ts` (15 ficheros hoy,
9 de ellos en `packages/server/src/domain/`) y se lanza con `pnpm -r test`. Ver
[`pr-08-evals-entrega/plan.md`](./pr-08-evals-entrega/plan.md) §*Fuera de alcance*.

Los dos niveles de eval —tests deterministas sin API key, y evals con LLM— están descritos
en [`docs/testing.md`](../docs/testing.md) y en
[`documentacion/funcionamiento-actual.md`](../documentacion/funcionamiento-actual.md) §8.

Para ver llegar los frames NDJSON de uno en uno, `curl -N` desactiva el buffering:

```bash
curl -N -X POST http://localhost:3000/api/artifacts/<id>/submit/stream \
  -H 'content-type: application/json' -d '{...}'
```

---

## 7. Commits y PRs

**Los PR los abres tú.** Contra `origin` (el fork `alaslibress/proxus-challenge`).

### Atribución: un trailer, y sólo uno

Un commit de feature **termina con una única línea de atribución**, separada del cuerpo por
una línea en blanco:

```
Co-Authored-By: Claude <modelo> <noreply@anthropic.com>
```

Detalles del formato:

- `Co-Authored-By:` con esa capitalización exacta y el correo `noreply@anthropic.com`.
- `<modelo>` es el nombre del modelo que hizo **tu** trabajo, en **tu** sesión. La regla no
  fija uno concreto y no debe fijarlo: fija el formato. En el repo conviven ya
  `Claude Sonnet 4.6`, `Claude Sonnet 5` (`ff0d0a2`, `564406e`, `c930596`, `9864238`) y
  `Claude Opus 5` (`139e9b1`, `cc9f989`). Pon el tuyo; no copies el de otro commit.
- Es la **última línea del mensaje**. Nada detrás.
- Nada de `🤖 Generated with Claude Code` en el mensaje de commit: ningún commit del repo
  lo lleva.

Se conserva porque **es un trailer con vida propia**: GitHub lo parsea, atribuye coautoría
en el gráfico de contribuciones del repositorio y sigue significando algo para quien lea el
historial dentro de un año, sin acceso a nada más.

#### `Claude-Session:` queda descartado

Los commits de feature del tramo PR-02→PR-08 llevan, además, una segunda línea
`Claude-Session: https://claude.ai/code/session_…`. **No la pongas en commits nuevos.** Es
una URL que sólo puede abrir quien lanzó esa sesión; para cualquier otro revisor del
repositorio —que es todo el público de una entrega— es un enlace muerto que no verifica
nada. Un trailer que nadie puede seguir no documenta: decora.

#### El historial previo es heterogéneo, y no se reescribe

Esta regla vale **de aquí en adelante**. Lo ya empujado se queda como está:

- Siete PRs mergeados o abiertos, con commits que llevan las **dos** líneas.
- El nombre del modelo varía entre commits (`Claude Sonnet 4.6`, `Claude Sonnet 5`,
  `Claude Opus 5`), porque varió el modelo que los escribió. Eso es correcto: el trailer
  describe un hecho, y el hecho no fue el mismo en todos.
- Las URLs de sesión se repiten o difieren sin patrón (`139e9b1` y `564406e` comparten
  `session_01E6EhMpaAjjyQ7bCSmaeGxw`; `cc9f989` lleva otra).

**No hay ninguna tarea de limpieza aquí.** Reescribir el historial para uniformar trailers
cambiaría los SHA de siete PRs ya revisados a cambio de nada. Si ves esa asimetría en
`git log`, es lo esperado, no una deriva que arreglar.

Lo que sigue prohibido: **inventarse coautores humanos** y firmar como el autor del repo un
trabajo que no hizo. La atribución describe quién escribió el código, no adorna.

### Formato

Conventional Commits, asunto en una línea. El repo escribe los asuntos y los cuerpos de
feature **en castellano** (`feat: PR-08 cierre de tests, evals y README de entrega`), y los
commits de infraestructura anteriores en inglés (`test: add unit test suite with vitest`).
Sigue el idioma del tramo en el que estés; ante la duda, castellano.

El asunto ≤ 50 caracteres es una guía, no un muro: los commits de PR reales llegan a ~55
porque el prefijo `PR-NN` paga su coste. El cuerpo **no** es opcional en un commit de
feature: explica el porqué, lista los ficheros nuevos y **di lo que decidiste apartarte del
plan y por qué** —`139e9b1` cierra explicando por qué `atoms.ts` quedó sin tocar contra lo
que decía el plan, y `cc9f989` cuenta cómo se comprobó la suite rompiéndola a propósito.
Eso es el estándar.

```
feat: PR-02 evidencia de página con citas verificables

Las citas necesitan una fuente de verdad contra la que verificarse.
Renderizar las páginas como imágenes las dejaba sin comprobar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

(El commit real de `ff0d0a2` lleva además una línea `Claude-Session:`; el ejemplo muestra
la forma nueva, no la histórica. Ver arriba.)

### Antes de abrir el PR

- [ ] `pnpm run typecheck` en verde.
- [ ] `pnpm -r test` en verde y **con al menos tantos tests como al empezar** (§2).
- [ ] `pnpm --filter @proxus/web run build` en verde.
- [ ] Si tocaste UI: el guard de color de `documentacion/design-system.md:275` da 0.
- [ ] Todos los **Checks** del plan ejecutados, con su resultado real.
- [ ] **QA manual** hecha.
- [ ] **Criterio de aceptación** repasado punto por punto.
- [ ] `git status` no muestra `.data/` (está en `.gitignore:13-14`).
- [ ] Ningún `plan.md` modificado.
- [ ] El commit de feature termina con `Co-Authored-By:` y **sin** `Claude-Session:` (§7).

### Cuerpo del PR

Qué problema resuelve, qué decisiones tomaste, cómo probarlo, qué checks ejecutaste y qué
queda fuera. Si algo no pudiste probar —típicamente por falta de API key— **dilo
explícitamente**: `docs/testing.md` ya lo exige.

**El cuerpo del PR no lleva enlace de sesión.** Los siete PRs abiertos hasta hoy (#1–#7)
cierran todos con el mismo pie de dos líneas —`🤖 Generated with Claude Code` y la URL
`https://claude.ai/code/session_…`—; lo comprobé con `gh pr view N --json body`. Esos
cuerpos se quedan como están (§7, *el historial no se reescribe*), pero **el enlace de
sesión no se repite en PRs nuevos**, por el mismo motivo que no va en el commit: nadie más
puede abrirlo. La línea `🤖 Generated with Claude Code` sí puede quedarse, es la convención
de la herramienta y apunta a una URL pública. Todo lo demás del cuerpo es prosa técnica.

---

## Historial

### 2026-09-08 — Puesta al día tras cerrar el roadmap (PR-01…PR-13)

Revisión completa de la guía contra el código en `cc9f989`, rama `feat/evals-entrega`.
Trece PRs mergeados habían dejado buena parte del documento describiendo un repo que ya no
existe. Lo corregido:

- **§1** — *"No te atribuyes el trabajo"* pasa a *"No falseas la autoría"*, para no
  contradecir al §7 reescrito.
- **§2, el gate** — decía *"11 ficheros y 91 tests"*. Falso desde el PR-08: hoy son 15/137
  (12/117 en `server`, 3/20 en `web`), medidos ejecutando `pnpm -r test`. **Decisión: no
  fijar la cifra como norma.** Una cifra exacta caduca con el primer PR que añada un test
  y, peor, empuja al doer a "cuadrarla". La regla que sí aguanta es *anota el recuento
  antes de empezar y no lo dejes bajar*: detecta lo único que importa —cobertura
  perdida— y no envejece. La cifra se conserva sólo como referencia fechada y marcada como
  tal. Corregidas también las líneas de `package.json` de vitest, que apuntaban a los
  scripts en vez de a la devDependency.
- **§3** — dejaba de ser una cola de trabajo: se reencuadra como registro histórico del
  orden real de merge. Fuera *"Presupuesto: lunes 01→04, martes 05→08"* y el plan de
  recorte *"si el martes aprieta"*, que nunca se ejecutó (PR-06, PR-07 y PR-08 entraron
  enteros) y que hoy se leería como permiso para recortar trabajo nuevo. Se anotó que
  `plan.md:117` aún marcaba el PR-08 `en curso`; corregido después (ver la entrada
  siguiente), y esa advertencia se ha retirado del §3 al quedarse sin objeto. El recuento
  de planes decía *17*; son **16**, tantos como directorios en `planes/` y filas en la
  tabla. Y decía que los 16 estaban *mergeados*: quince lo están, el PR-08 sigue con su PR
  #7 abierto, que es justo lo que dice `plan.md:117`.
- **§4** — se aclara que la rutina aplica al trabajo nuevo y que todo encargo pasa antes
  por un plan del thinker (plantilla en `plan.md:213-253`).
- **§5, estilos** — afirmaba que `packages/web/src/styles.generated.css` es un fichero
  generado que no hay que editar. **Ese fichero ya no existe.** Tailwind v4 corre como
  plugin de Vite (`@tailwindcss/vite`, `vite.config.ts:3,10`); el único CSS del repo es
  `styles.input.css`, importado desde `main.tsx:5`, con `@import "tailwindcss"` y dos
  `@source`. Se documenta la consecuencia práctica que antes no estaba: una clase escrita
  en un fichero fuera de los `@source` no se genera. El guard de color pasa a citarse desde
  `documentacion/design-system.md:275`, y se avisa de que la copia del guard en el plan del
  PR-1.5 todavía lee el fichero generado difunto.
- **§5, nueva trampa** — la lógica del chat vive en `domain/tutor/use-tutor-chat.ts:26`
  desde el PR-10; `components/Chat.tsx` sólo consume el hook. Sin esta nota, cualquier plan
  que diga "la lógica del chat" manda al fichero equivocado.
- **§5, referencias corregidas** — el switch de `renderPrompt` es `session.ts:175-232`
  (decía 155-197) y `toolParameters` es `gemini.ts:154-183` (decía 124-154). La nota de
  NDJSON decía que un frame desconocido mata el stream *"hasta el PR-05"*: hoy `readNdjson`
  lo salta con `console.warn` (`lib/ndjson.ts:17-24`), así que el riesgo real ya no es la
  caída sino el descarte **silencioso**. Añadidos punteros a usos vivos de
  `mode: "result"` (`engine.ts:79`), `forkDetach`
  (`file-evaluation-trace.ts:31`) y `generateObject` (`engine.ts:103`).
- **§6** — la tabla anunciaba `structured-output:check`, `panel:check` y `test` como
  scripts *"que crean los planes"*; los tres existen ya. Se sustituye por el inventario
  real de `package.json`, separando los que necesitan API key de los que no, y añadiendo
  `pnpm run test`, `test:watch` y los agentes `agent:sum`/`agent:math`, que faltaban.
- **§7 — el cambio de fondo.** La guía prohibía `Co-Authored-By:` y `Claude-Session:`
  *"sin excepciones"*, y el repo los lleva en los cinco commits de feature del tramo
  PR-04→PR-08. Entre una regla que nadie aplica y un historial consistente, gana el
  historial: la sección pasa a **exigir** atribución al final del commit de feature, con el
  formato tomado de los commits reales. Se documenta que el nombre del modelo varía
  (`Claude Sonnet 5` en `564406e`, `Claude Opus 5` después). Se conserva la prohibición que
  sí se respeta: nada de coautores humanos inventados. El bloque de *Formato* pasa a
  reflejar el idioma real (castellano en los commits de PR) y a exigir cuerpo en los
  commits de feature, con `139e9b1` y `cc9f989` como listón.
- **Checklist previa al PR** — fuera `styles.generated.css`; dentro `pnpm -r test` sin
  bajar el recuento, el guard de color para PRs de UI y el bloque de atribución.

### 2026-09-08 (b) — §7 se parte en dos, y barrido de derivas

La revisión anterior dejó §7 exigiendo **dos** trailers. Los dos no valen lo mismo, y
tratarlos como un bloque indivisible era el error. Se separan:

- **`Co-Authored-By:` se conserva y se exige.** Es un trailer que GitHub parsea: atribuye
  coautoría en el gráfico de contribuciones y significa algo para cualquiera que lea el
  repositorio, hoy o dentro de un año.
- **`Claude-Session:` se descarta.** Es una URL que sólo abre quien lanzó esa sesión. Para
  el revisor de una entrega —el único lector que importa aquí— es un enlace muerto. Un
  trailer que nadie puede seguir no aporta trazabilidad, sólo ruido.

La regla aplica **de aquí en adelante**. Se añade el apartado *El historial previo es
heterogéneo, y no se reescribe*: siete PRs ya empujados llevan las dos líneas, el nombre
del modelo varía entre commits (`Claude Sonnet 4.6`, `Claude Sonnet 5`, `Claude Opus 5`)
porque varió el modelo que los escribió, y las URLs de sesión se repiten sin patrón. Nada
de eso se toca: uniformar trailers cambiaría los SHA de siete PRs revisados a cambio de
nada. La guía deja de fijar un nombre de modelo concreto y fija el formato,
`Claude <modelo> <noreply@anthropic.com>`.

Corregido además, verificando contra el repo en vez de contra la memoria:

- **§7, *Cuerpo del PR*** — afirmaba que *"ninguno de los PRs mergeados (#1–#7) incluye
  `🤖 Generated with Claude Code` ni enlace de sesión"*. **Es falso**: `gh pr view N --json
  body` muestra que los siete lo llevan. Reescrito con el hecho real y con la regla nueva:
  esos cuerpos se quedan, pero el enlace de sesión no se repite en PRs nuevos.
- **`planes/plan.md`** — la fila del PR-08 seguía en `en curso` con el PR #7 ya abierto.
  Pasa a `implementado, PR #7 abierto`, y la leyenda de estados incorpora ese escalón, que
  faltaba. Las columnas *Depende de* y *Alcance* de esa fila ya estaban corregidas por el
  paso 8 del plan del PR-08; se dejan como están. También se corrige la nota de trampas que
  seguía llamando generado a `styles.generated.css`.
- **`planes/pr-1.5-sistema-visual/plan.md`** — describía el montaje de Tailwind con un CLI
  que escribía `styles.generated.css`. El repo usa el **plugin de Vite**
  (`@tailwindcss/vite`, `vite.config.ts:3,10`) y su única hoja es `styles.input.css`
  (`main.tsx:5`). Corregidos Paso 0.4, Paso 7.1, Paso 8.2, los Checks —dos `grep` que
  apuntaban a un fichero inexistente y por tanto siempre habrían fallado— y el bloque de
  riesgos, que decía literalmente lo contrario de la realidad. Detalle en el `Historial` de
  ese plan.
- **`.gitignore`** — conservaba la cabecera `# Generated Tailwind CSS` sin patrón debajo:
  el resto de la entrada ya se había ido y quedó el comentario huérfano apuntando a un
  fichero que nada genera. Eliminada. Ninguna otra entrada tocada.
- **§5, la trampa de `Chat.tsx`** — revisada, no corregida: `Chat.tsx:4,13` consume
  `useTutorChat` y la lógica está en `use-tutor-chat.ts:26`. Las tres referencias son
  correctas.
