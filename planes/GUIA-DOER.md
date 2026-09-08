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
- **No te atribuyes el trabajo.** Ver §7.

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
**anterior** a PR-03 (`cd8d136`) y a PR-04 (`564406e`). Hoy: `vitest ^5.0.0` en `packages/server`
(`package.json:16-17`, `vitest.config.ts`) y en `packages/web` (`package.json:11-12`).
Hoy son 11 ficheros y 91 tests, todos deterministas y **sin API key**. El gate es:

```bash
pnpm run typecheck                    # obligatorio, no negociable
pnpm -r test                          # sin API key ni red
pnpm --filter @proxus/web run build
```

Ejecuta `typecheck` **al terminar cada paso** de un plan, no solo al final. Cada paso está
escrito para dejar el repo compilando.

---

## 3. Orden de implementación

**Estricto. Ninguno va en paralelo.** El orden es el de esta tabla: los PRs 1.5, 09, 10 y 11
van tras el 01 y antes del 02, aunque su número sea mayor. El 1.5 va antes que los otros
tres: fija el sistema visual que ellos usan. PR-05 y PR-06 tocan los mismos ficheros, y PR-04,
PR-05 y PR-06 se encadenan sobre la firma de `evaluate`.

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

Presupuesto: lunes 01→04, martes 05→08.

### Si el martes aprieta

Recorta en este orden, de lo primero que cae a lo último:

1. **PR-06** entero (trazabilidad).
2. El resaltado de citas del **PR-07**, dejando solo los estados de fase.
3. Dentro del **PR-08**: los casos 7, 8 y 9 del panel.

**El README del PR-08 no se recorta.** Sin él la entrega está incompleta por definición:
`CHALLENGE.md` puntúa la comunicación al mismo nivel que el código.

---

## 4. Rutina por PR

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
  `AgentMessage` rompe `harness/session.ts:155-197`. Por eso los eventos nuevos van en las
  uniones de *frames*, discriminadas por `type`, nunca en `AgentMessage`.

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
- `LanguageModel.generateObject` **ya existe** y `gemini.ts` ya usa `LanguageModel.make`.
  No construyas un servicio de structured output: solo hay que honrar `responseFormat`.
- `generateObject` concatena las partes `type:"text"` y decodifica con
  `Schema.fromJsonString`. Los fallos salen como `AiError.StructuredOutputError`.

### Repo

- **No crees `packages/web/src/api/`.** `vite.config.ts` tiene `root: "src"`, así que ese
  directorio se serviría como estático y **taparía el proxy** `^/api(?:/|$)`. El cliente
  vive en `src/api-client/`.
- **`packages/web/src/styles.generated.css` es generado.** Edita `styles.input.css`.
- **Prohibida cualquier clase de color literal de Tailwind en `packages/web`** desde el
  PR-1.5. El color sale de un token de `@theme`. La norma y las recetas están en
  `documentacion/design-system.md`; el guard está en el PR-1.5 §Paso 8.
- **Los contratos van en `packages/shared`.** `shared` no puede importar de `server` ni de
  `web`: la dirección es `web → shared ← server`.
- **Las rutas de `HttpRouter` llevan `/api` escrito literalmente.** El `.prefix("/api")`
  del `HttpApi` no les aplica.
- **Cualquier cambio del protocolo NDJSON mueve server y web en el mismo PR.** El cliente
  decodifica en estricto y un frame desconocido mata el stream (hasta el PR-05).
- **`node --env-file=<fichero>` aborta si el fichero no existe.** Los scripts que deben
  correr sin `.env` van sin la bandera.
- **`toolParameters` (`gemini.ts:124-154`)** hardcodea esquemas JSON por nombre de tool con
  un `default` de `{a, b}`. Si añades una tool al harness sin tocarlo, se anuncia a Gemini
  con el esquema equivocado. Ningún PR del roadmap necesita añadir tools.

---

## 6. Comandos

```bash
pnpm run dev                                   # server :3000 + web :5173
pnpm run typecheck                             # el gate
pnpm --filter @proxus/web run build
pnpm --filter @proxus/server run dev           # solo backend

pnpm --filter @proxus/server run agent:tutor "lista mis materiales"
pnpm --filter @proxus/server run eval:tutor:artifact-authoring    # requiere API key
```

Scripts que **crean** los planes, cada uno en el suyo:

| Script | PR |
|--------|----|
| `structured-output:check` | 03 |
| `panel:check` | 04 |
| `test` (raíz, `pnpm -r test`) | 08 — sin API key |

Los scripts `eval:pure` y `eval:panel` que esta tabla anunciaba **ya no se crean**: eran la
forma de tener evals deterministas cuando no había runner. Con vitest instalado, su
contenido vive en `src/**/__tests__/*.test.ts` y se lanza con `pnpm -r test`. Ver
[`pr-08-evals-entrega/plan.md`](./pr-08-evals-entrega/plan.md) §*Fuera de alcance*.

Para ver llegar los frames NDJSON de uno en uno, `curl -N` desactiva el buffering:

```bash
curl -N -X POST http://localhost:3000/api/artifacts/<id>/submit/stream \
  -H 'content-type: application/json' -d '{...}'
```

---

## 7. Commits y PRs

**Los PR los abres tú.** Contra `origin` (el fork `alaslibress/proxus-challenge`).

### Cero atribución. Sin excepciones

Prohibido en commits y en descripciones de PR:

- `Co-Authored-By:` de cualquier agente.
- `🤖 Generated with Claude Code` o equivalente.
- `Claude-Session:` o enlaces a sesiones.
- Cualquier mención a que el cambio lo generó un agente.

Los commits y PRs se escriben como si los firmara el autor humano del repo.

### Formato

Conventional Commits, en inglés, asunto ≤ 50 caracteres. Cuerpo solo cuando el *porqué* no
sea obvio.

```
feat(server): extract page text with pdftotext

Citations need a source of truth to be verified against.
Rendering pages as images left quotes unverifiable.
```

### Antes de abrir el PR

- [ ] `pnpm run typecheck` en verde.
- [ ] `pnpm --filter @proxus/web run build` en verde.
- [ ] Todos los **Checks** del plan ejecutados, con su resultado real.
- [ ] **QA manual** hecha.
- [ ] **Criterio de aceptación** repasado punto por punto.
- [ ] `git status` no muestra `.data/` ni `styles.generated.css`.
- [ ] Ningún `plan.md` modificado.
- [ ] Sin atribución de agentes en commits ni descripción.

### Cuerpo del PR

Qué problema resuelve, qué decisiones tomaste, cómo probarlo, qué checks ejecutaste y qué
queda fuera. Si algo no pudiste probar —típicamente por falta de API key— **dilo
explícitamente**: `docs/testing.md` ya lo exige.
