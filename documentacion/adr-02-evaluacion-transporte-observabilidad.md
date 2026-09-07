# ADR-02 — Arquitectura de Evaluación, Transporte NDJSON y Observabilidad Nativa

> Documento de decisiones, transcrito literalmente. No se edita.
> Amplía y consolida [`adr-motor-evaluacion.md`](./adr-motor-evaluacion.md).

---

Este documento amplía y consolida las decisiones de diseño respecto a la ubicación del motor de evaluación de la IA, el flujo de datos hacia la UI y el sistema de trazabilidad de las inferencias.

## Opcion 4 (Arquitectura Final Seleccionada): Servicio Multi-Agente Aislado con Endpoint Dedicado y Trazabilidad Nativa

Esta opción representa el diseño más robusto y escalable para la prueba, resolviendo simultáneamente el acoplamiento del motor, la experiencia de usuario en el frontend y la necesidad de auditar las decisiones de la IA sin violar las restricciones de infraestructura.

Esta arquitectura se divide en dos pilares fundamentales: el flujo de ejecución y el sistema de observabilidad.

### 1. Flujo de Ejecucion y Transporte (Dominio + API)

Para evitar contaminar el historial del chat general y asegurar una experiencia de usuario fluida en el ArtifactWorkspace, el sistema se estructura de la siguiente manera:

Aislamiento del Motor (Servicio de Dominio): Toda la lógica de concurrencia Multi-Agente (Profe Bueno, Profe Malo y Juez) se encapsula en un nuevo servicio independiente, EvaluationEngineService, orquestado mediante Effect. Esto permite que el motor sea consumido tanto por la ruta de corrección como, potencialmente en el futuro, por comandos del CLI o del propio chat.

Endpoint Dedicado (Transporte): Se crea una nueva ruta exclusiva POST /api/artifacts/:id/submit/stream. Su única responsabilidad es recibir el intento del alumno (detanswer), invocar al EvaluationEngineService y gestionar el streaming NDJSON.

Streaming de Estados Discretos: La ruta emite estados sincrónicos que la UI consume para actualizar el progreso visual sin bloquear el hilo principal.

```json
{"type": "status", "value": "evaluating_good"}
{"type": "status", "value": "evaluating_bad"}
{"type": "status", "value": "deliberating"}
{"type": "done", "payload": { "...FinalFeedbackSchema": true }}
```

### 2. Trazabilidad y Logging Nativo (Effect + FileSystem)

Para auditar el "Chain of Thought" de los agentes y cumplir con los requisitos de transparencia, se implementa un sistema de logs determinista integrado en el propio pipeline.

Dado que el backend utiliza el paradigma de Effect, la solución más elegante y alineada con la prueba técnica es interceptar el flujo de datos usando las utilidades de Effect y persistir el resultado de forma local.

Interceptación Transparente: Una vez que el EvaluationEngineService consolida la respuesta del Juez, el sistema captura el input original, el contexto inyectado de la página del PDF y los outputs intermedios de cada agente.

Persistencia No Bloqueante: Mediante fs/promises y utilizando utilidades como Effect.fork, la escritura en disco se ejecuta en segundo plano. Esto asegura que la latencia de entrada/salida (I/O) no penalice el tiempo de respuesta final hacia el cliente.

Formato de Salida: Los registros se guardan en formato Markdown (.md) dentro de packages/server/.data/sessions/, facilitando la lectura humana por parte del evaluador técnico para comprobar que el sistema anti-alucinaciones funciona correctamente.

### 3. Alternativas de Observabilidad Evaluadas y Descartadas

Antes de consolidar el Logger Nativo, se valoraron y rechazaron dos enfoques alternativos debido a que entraban en conflicto con las reglas del proyecto o con las buenas prácticas de ingeniería:

**Alternativa A: Frameworks de Observabilidad de Terceros (Descartada)**

Se valoró la integración de herramientas estándar de la industria para aplicaciones LLM (como LangSmith, Langfuse o Helicone).

Motivo del rechazo: Requerir dependencias externas, cuentas de terceros o la instanciación de bases de datos/contenedores adicionales viola la regla estricta de persistencia exclusivamente local (dentro de la carpeta .data). Además, añade una fricción inaceptable para el evaluador a la hora de compilar y levantar el proyecto en su máquina.

**Alternativa B: Delegación del Log a un Agente IA (Descartada)**

Se consideró la opción de enviar el historial completo de la sesión a una última llamada al LLM para que este redactara y estructurara el log.

Motivo del rechazo: Constituye un anti-patrón técnico. Consumiría tokens y cuota de API de manera innecesaria, incrementaría severamente la latencia global del endpoint de evaluación y abriría la puerta a nuevas alucinaciones (el modelo podría inventar o alterar el registro de lo que realmente ocurrió). El logging de auditoría en sistemas críticos debe ser estrictamente determinista y generado por código transaccional, no probabilístico.

---

## Notas del thinker

No forman parte del ADR. Precisiones verificadas en el código.

1. **`Effect.fork` requiere un scope vivo.** Si el fork se lanza dentro del scope de la
   petición HTTP, la respuesta puede cerrarse antes de que termine la escritura y el
   fiber se interrumpe. El log debe forkearse en un scope que sobreviva a la petición
   (`Effect.forkDaemon` o un scope de aplicación), o escribirse antes de emitir el frame
   `done`. Se decide en el plan del PR correspondiente.

2. **`fs/promises` vs. el `FileSystem` de Effect.** El ADR nombra `fs/promises`, pero el
   repo accede a disco siempre a través de `FileSystem.FileSystem` de Effect
   (`infra/artifacts/file-artifact-repository.ts`, `infra/materials/*`), y `AGENTS.md`
   lo exige explícitamente. Se usará `FileSystem`, que es la misma decisión con la
   herramienta que el repo ya tiene inyectada.

3. **`.data/sessions/` es un directorio nuevo.** Hoy existe `.data/agent-sessions/` para
   las sesiones del chat del tutor (`infra/agents/file-session-repository.ts`). Son
   cosas distintas y conviene que los nombres no se confundan; el plan usará
   `.data/sessions/` tal como dice el ADR y lo documentará en `docs/data.md`.

4. **El frame `done` cambia de forma.** Hoy `{"type":"done"}` no lleva payload
   (`shared/src/api/tutor.ts:19-28`). La ruta nueva es una unión propia, así que no hay
   colisión, pero el decodificador resiliente debe cubrir ambas.

5. **"recibir el intento del alumno (detanswer)"**: el payload real de la ruta existente
   es `SubmitAttemptInput` (`shared/src/api/artifacts.ts`), con las respuestas de todas
   las preguntas del artifact. La ruta nueva reutiliza ese contrato.
