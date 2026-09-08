# PR-06 — Trazabilidad nativa: auditoría del panel en Markdown

- **Rama**: `feat/trazabilidad`
- **Depende de**: PR-04 (`EvaluationEngineService`).
- **Conflicto conocido**: toca `domain/evaluation/engine.ts` y `review.ts`, los mismos
  ficheros que el PR-05. **No se implementan en paralelo**: este va después.
- **Bloquea a**: nada.
- **Estado**: borrador
- **Contiene LLM**: no. Solo registra lo que otros producen.
- **Origen**: [ADR-02 §2 y §3](../../documentacion/adr-02-evaluacion-transporte-observabilidad.md).

> Normas de trabajo en [`../plan.md`](../plan.md). Contexto técnico obligatorio en
> [`../../documentacion/contexto-repo.md`](../../documentacion/contexto-repo.md) y
> [`../../documentacion/funcionamiento-actual.md`](../../documentacion/funcionamiento-actual.md).
> **El doer no edita este fichero.** Si algo aquí es falso o ambiguo, para y lo notifica.

---

## Problema

Tras el PR-04 el veredicto de una respuesta corta lo deciden tres llamadas al LLM, y de
todo ese proceso el usuario solo ve el resultado final. Si una nota parece injusta o una
cita sale `verified: false`, no hay forma de saber por qué: qué texto se inyectó, qué dijo
cada profe, qué devolvió el Juez exactamente y si su cita coincidía o no con el PDF.

Para quien evalúa la prueba técnica el problema es más agudo: la promesa del producto es
*"las citas se verifican por código"*, y ahora mismo esa promesa hay que creérsela. No hay
nada que abrir y leer.

## Objetivo

Que cada evaluación deje en disco un registro **determinista y legible por una persona**
con todo el "chain of thought" del panel, escrito por código y sin penalizar la latencia
de la respuesta.

## Fuera de alcance

- Cualquier framework de observabilidad de terceros. **Descartado explícitamente** en el
  ADR-02 §3: exigiría cuentas externas o contenedores y rompe la regla de persistencia
  local.
- Pedirle a un LLM que redacte el log. **Descartado** en el ADR-02 §3: gasta tokens, sube
  la latencia y abre la puerta a que el propio registro esté alucinado. El log de auditoría
  es transaccional, no probabilístico.
- Métricas, dashboards, agregación o rotación de ficheros.
- La UI. Estos ficheros se leen con un editor.
- Tocar prompts, motor o transporte.

## Arquitectura

Puerto en dominio, implementación en infraestructura, igual que el resto del repo:

```
domain/evaluation/trace.ts              EvaluationTrace (puerto) + EvaluationTraceEntry
infra/evaluation/file-evaluation-trace.ts   implementación sobre FileSystem
```

```ts
export interface EvaluationTraceEntry {
  readonly attemptId: string;
  readonly artifactId: string;
  readonly questionId: string;
  readonly questionPrompt: string;
  readonly expectedAnswer: string;
  readonly studentAnswer: string;
  readonly materialId: string | undefined;
  readonly pages: readonly number[];
  readonly evidence: readonly PageText[];
  readonly goodTeacher: { readonly ok: true; readonly text: string }
                      | { readonly ok: false; readonly reason: string };
  readonly badTeacher:  { readonly ok: true; readonly text: string }
                      | { readonly ok: false; readonly reason: string };
  readonly judge: FinalFeedbackSchema | { readonly failed: string };
  readonly citations: readonly PdfCitation[];
  readonly deterministicScore: number;
  readonly finalScore: number;
  readonly scoreOverridden: boolean;
  readonly durationMs: number;
}

export interface EvaluationTrace {
  /** Devuelve inmediatamente: la escritura ocurre en un fiber aparte. */
  readonly record: (entry: EvaluationTraceEntry) => Effect.Effect<void>;
}
```

Fíjate en `record`: **no tiene canal de error**. Un fallo escribiendo el log jamás puede
afectar a la corrección de un alumno.

## Pasos

### Paso 1 — Puerto

- [ ] Crear `domain/evaluation/trace.ts` con `EvaluationTraceEntry`, el puerto
      `EvaluationTrace` y su `Context.Service`, siguiendo el patrón de
      `MaterialRepository` (`domain/materials/material.ts:45-47`).

### Paso 2 — Formateador Markdown (función pura)

- [ ] En el mismo fichero o en `domain/evaluation/trace-format.ts`, una función pura
      `formatTraceEntry(entry: EvaluationTraceEntry): string`. **Sin Effect**: la eval del
      PR-08 debe poder comprobar el formato sin tocar disco.

Plantilla exacta de la sección que se escribe por pregunta:

```markdown
## Pregunta `q2` — 2026-09-08T10:14:32.118Z — 6.4s

**Enunciado:** ¿Qué mide la media aritmética?
**Respuesta esperada:** el promedio de los valores
**Respuesta del alumno:** el valor medio del conjunto

**Evidencia inyectada:** material `estadistica-tema-3`, página 4

> la media aritmetica es el promedio de todos los valores de la
> distribucion, y se obtiene sumandolos y dividiendo entre el numero
> total de observaciones

### Profe Bueno
Reconoce correctamente la idea de valor central...

### Profe Malo
No menciona la división entre el número de observaciones...

### Juez
- `is_correct`: **true**
- `feedback`: Tu respuesta capta la idea principal...

| Cita | Verificada | Página |
|------|-----------|--------|
| "es el promedio de todos los valores" | ✅ | 4 |
| "se calcula con la mediana"           | ❌ | — |

### Resultado
- Nota determinista: 0 / 2
- Nota final: 2 / 2
- **Nota modificada por el panel: sí** (1 cita verificada)
```

Reglas del formateador:

- Si un profe falló, su sección dice `_No disponible: <motivo>_`. No se omite: que un
  agente cayera es justo lo que hay que poder auditar.
- Si el Juez falló, se escribe el motivo y se marca que la nota es la determinista.
- El texto de la evidencia va en blockquote y **se trunca a 1500 caracteres** por página
  con una marca `…[truncado]`. Sin el corte, una página densa hace el fichero ilegible.
- Las citas se escriben **literalmente**, entre comillas, tal como las devolvió el modelo.
  Es el dato que permite comprobar a mano si la verificación acertó.

### Paso 3 — Implementación sobre `FileSystem`

- [ ] Crear `infra/evaluation/file-evaluation-trace.ts` con
      `FileEvaluationTrace.make(directory)` y `.layer(directory)`, calcado de
      `FileMaterialRepository` (`infra/materials/file-material-repository.ts:17-98`).
- [ ] Usar el `FileSystem` de Effect, **no `fs/promises`**. El ADR-02 nombra `fs/promises`,
      pero `AGENTS.md` exige servicios de plataforma de Effect en los bordes de
      infraestructura y es lo que usa todo el repo. Es la misma decisión con la herramienta
      que ya está inyectada.
- [ ] Escritura: `fs.makeDirectory(directory, { recursive: true })` y
      `fs.writeFileString(path, content)`, el patrón exacto de
      `file-artifact-repository.ts:40-42` y `:82`.
- [ ] Un fichero por intento: `<directory>/<attemptId>.md`. La primera entrada escribe una
      cabecera con `attemptId`, `artifactId` y la fecha; las siguientes **añaden** su
      sección. Como no hay `appendFileString` garantizado en esta beta, leer-concatenar-
      escribir es aceptable: son ficheros de pocos KB y una evaluación por intento.
      Si `fs.readFileString` falla porque no existe, se empieza de cero.
- [ ] Nombre de fichero saneado con `encodeURIComponent`, igual que
      `file-artifact-repository.ts:31-35`.

### Paso 4 — Escritura fuera del camino crítico

Aquí está la corrección técnica más importante del PR.

> **En Effect v4 no existen `Effect.fork` ni `Effect.forkDaemon`.** El ADR-02 los nombra,
> pero el paquete `effect@4.0.0-beta.83` solo exporta `forkChild`, `forkIn`, `forkScoped` y
> **`forkDetach`**. El equivalente al viejo `forkDaemon` es **`Effect.forkDetach`**, cuya
> propia documentación dice *"Daemon continues running after this effect completes"*
> (`Effect.d.ts:15981`). Es el único que sirve aquí: `forkChild` y `forkScoped` atan el
> fiber al scope de la petición, y ese scope se cierra cuando la respuesta HTTP termina,
> así que la escritura se interrumpiría justo cuando queremos que ocurra.

- [ ] Implementar `record` como: construir el contenido → escribir →
      `Effect.ignore` (para que ningún fallo escape) → `Effect.forkDetach` → descartar el
      fiber. El resultado es un `Effect<void>` que retorna de inmediato.
- [ ] Envolver además la construcción del Markdown en el fiber, no fuera: si el
      formateador petara con una entrada rara, tampoco debe afectar a la respuesta.

### Paso 5 — Capturar en el motor

- [ ] **Cambio de firma de `evaluate`, declarado.** Hoy devuelve solo
      `EnrichedFeedbackSchema`, pero la traza necesita datos que el motor tiene y no
      expone: el texto de cada profe (o su motivo de fallo) y el JSON crudo del Juez.
      `evaluate` pasa a devolver
      `{ feedback: EnrichedFeedbackSchema; trace: Omit<EvaluationTraceEntry, "attemptId" | "artifactId" | "deterministicScore" | "finalScore" | "scoreOverridden"> }`.
      Es el segundo PR que toca esta firma tras el `emit?` del PR-05: si ambos ya están
      mergeados, se acumulan sin conflicto lógico, pero **sí conflicto de texto**.
- [ ] En `domain/evaluation/engine.ts`, tras consolidar la respuesta del Juez y **después**
      de `verifyCitations`, construir la `EvaluationTraceEntry` y llamar a `trace.record`.
      Es el punto que fija el ADR-02 §2: *"una vez que el EvaluationEngineService consolida
      la respuesta del Juez"*.
- [ ] Medir `durationMs` alrededor de todo el panel.
- [ ] `deterministicScore`, `finalScore` y `scoreOverridden` los conoce
      `domain/evaluation/review.ts`, no el motor. Dos opciones y **este plan elige la
      segunda**: pasar esos datos al motor (lo ensucia), o que el motor devuelva la entrada
      a medio construir y `review.ts` la complete y llame a `record`. **El motor produce la
      entrada, `review.ts` la cierra y la registra.**
- [ ] Registrar también los casos en que **no se llamó al panel** por falta de evidencia:
      una entrada con las secciones de profes y Juez vacías y el motivo explícito. Un
      registro que solo cuenta los éxitos no sirve para auditar.

### Paso 6 — Wiring

- [ ] Añadir `FileEvaluationTrace.layer(".data/sessions")` a `InfraLive` en
      `transport/http/server.ts:52-62`, junto a `FileMaterialRepository` y
      `FileArtifactRepository`.
- [ ] Proveerlo también en el script `panel:check` del PR-04, para poder generar trazas
      sin navegador.

### Paso 7 — Documentación

- [ ] `docs/data.md`: añadir `.data/sessions/` al layout esperado y **avisar de que no es
      lo mismo que `.data/agent-sessions/`**, que guarda las sesiones de chat del tutor
      (`infra/agents/file-session-repository.ts`). Los nombres se parecen y se van a
      confundir.
- [ ] `docs/ai-agent.md`: cómo leer una traza y qué buscar en ella.
- [ ] `documentacion/funcionamiento-actual.md`: añadir la trazabilidad a la descripción
      del flujo de evaluación. Es capacidad nueva y ese documento es el mapa del estado
      real del repo.
- [ ] `README.md`: una línea diciendo que tras corregir un test hay una traza legible en
      `packages/server/.data/sessions/`. **Es lo primero que va a querer abrir quien evalúe
      la prueba**, y si no está escrito no lo encontrará.
- [ ] Confirmar que `.gitignore` ya lo cubre: la regla `**/.data/` (`.gitignore:14`) incluye
      el directorio nuevo. No hay que tocar nada.

## Criterio de aceptación

1. Tras corregir un test con una respuesta corta existe
   `packages/server/.data/sessions/<attemptId>.md`.
2. El fichero contiene: enunciado, respuesta esperada, respuesta del alumno, el texto de
   página inyectado, la salida de cada profe, el JSON del Juez, la tabla de citas con su
   marca de verificación, y las notas determinista y final.
3. Con dos respuestas cortas, el fichero tiene **dos secciones** en el mismo `.md`.
4. Si un profe falla, su sección lo dice; el fichero se escribe igual.
5. Si el Juez falla, el fichero se escribe igual e indica que la nota es la determinista.
6. Si no había evidencia, hay entrada con el motivo.
7. **Rompiendo la escritura a propósito** (directorio sin permisos), la corrección del
   alumno se completa con normalidad. Ni error, ni retraso, ni traza en la respuesta.
8. En el código no aparece `Effect.fork` ni `Effect.forkDaemon` — no existen en v4.
9. Ninguna llamada a `fs/promises`: todo pasa por `FileSystem` de Effect.
10. `pnpm run typecheck` y el build de web en verde.

## Checks

```bash
pnpm run typecheck
pnpm --filter @proxus/web run build
pnpm --filter @proxus/server run panel:check "el valor medio del conjunto" "el promedio de los valores" <materialId> 4
ls -la packages/server/.data/sessions/
```

## QA manual

1. PDF con capa de texto en `packages/server/.data/materials/pdfs/`, `pnpm run dev`.
2. Crear un test con dos respuestas cortas y resolverlo con una paráfrasis y un error.
3. Abrir el `.md` generado y **leerlo entero**. El criterio real es que se entienda sin
   mirar el código: si hay que abrir el repo para interpretarlo, el formato ha fallado.
4. Comprobar que una cita marcada `❌` efectivamente no aparece en el texto citado justo
   encima. Ese contraste es la demostración de que la verificación funciona.
5. `chmod 500` sobre `.data/sessions` y repetir: la corrección debe salir igual.
6. Cronometrar dos envíos, con y sin traza. La diferencia debe ser indistinguible.

## Riesgos y decisiones

- **`Effect.fork` no existe en v4.** Es la trampa número uno de este PR. El equivalente a
  `forkDaemon` es `forkDetach`; `forkChild` y `forkScoped` atarían el fiber al scope de la
  petición y la escritura se interrumpiría al cerrar la respuesta.
- **Un fiber desligado puede perderse si el proceso muere justo después.** Es el precio de
  no bloquear, y para una herramienta de auditoría local es asumible. Merece la pena
  decirlo: una escritura de pocos KB tarda ~1ms frente a los segundos de las tres llamadas
  al LLM, así que **el ahorro de latencia es teórico**. Se implementa con fork porque lo
  decide el ADR-02, pero si en QA se pierde alguna traza, moverla a síncrona antes del
  frame `done` es un cambio de una línea y no se notaría.
- **`fs/promises` vs `FileSystem` de Effect.** El ADR nombra el primero; se usa el segundo
  porque `AGENTS.md` lo exige y porque el servicio ya está inyectado en todas las capas de
  infra. Misma decisión, herramienta consistente.
- **Leer-concatenar-escribir en vez de append.** Con un intento por fichero y pocos KB es
  irrelevante, y evita depender de una API de append que habría que verificar en la beta.
  Si dos evaluaciones del mismo intento corrieran a la vez podría perderse una sección;
  no ocurre porque las preguntas se evalúan en secuencia dentro de un mismo `review`.
- **Se registran datos del alumno en claro.** Respuestas y fragmentos del PDF acaban en
  disco. Es local, está en `.gitignore` y el proyecto no tiene autenticación ni usuarios,
  así que no hay problema real, pero conviene decirlo en el README: **no subir `.data`**.
- **Colisión de nombres con `.data/agent-sessions/`.** Se mantiene `.data/sessions/` porque
  lo fija el ADR-02, y se documenta la diferencia. Si molesta, `.data/evaluations/` sería
  más claro; es un cambio de una constante.

## Historial

_Sin cambios todavía. El thinker anota aquí cualquier corrección al plan que venga del
doer, con fecha y motivo._
