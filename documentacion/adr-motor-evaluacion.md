# ADR — Motor de Evaluación AI y Resolución de Deuda Técnica

> Documento de decisiones, transcrito literalmente. No se edita.
> Los conflictos entre lo que aquí se decide y lo que el repo permite hoy están
> anotados al final, en la sección "Notas del thinker", claramente separada.

---

## Contexto

Durante la auditoria inicial del MVP (commit base), se identificaron tres bloqueadores criticos que impiden la implementacion del sistema Multi-Agente y violan los principios de un producto de tutorizacion inteligente. Estos problemas residian en la validacion determinista de respuestas, la configuracion del LLM y la fragilidad de los contratos cliente-servidor.

Este documento detalla las decisiones arquitectonicas tomadas para resolver estos problemas, manteniendo las restricciones del proyecto (cero bases de datos externas, uso de Effect, tipado estricto).

## Decision 1: Sustitucion de la Validacion Determinista (Eliminacion del "Agujero de Producto")

### El Problema

El sistema original no utilizaba IA para evaluar al alumno. La correccion estaba hardcodeada en la capa de dominio (artifact.ts, linea 463), evaluando la respuesta del usuario mediante una comparacion de igualdad exacta de strings (detanswer === expected). Ademas, la extraccion de contexto operaba exclusivamente a nivel de pagina (pdfinfo + pdftoppm), sin un sistema RAG (Retrieval-Augmented Generation) real, lo que hacia que las citas_pdf no tuvieran una fuente de verdad dinamica.

### La Decision

Rechazo de RAG Complejo: Se decide NO implementar una base de datos vectorial ni un sistema de embeddings. Introducir infraestructura externa viola la regla de persistencia estrictamente local y anade sobreingenieria innecesaria.

Evaluacion Semantica por Pagina: Se aprovecha la arquitectura actual basada en paginas. La comparacion estricta (===) se elimina por completo.

Delegacion al Motor Multi-Agente: La validacion se traslada al TutorChatService. Se enviara al LLM la respuesta del alumno junto con el texto extraido de la pagina especifica asociada a la pregunta. La IA, operando mediante llamadas concurrentes (Effect.all), determinara si la respuesta es conceptualmente correcta basandose unicamente en ese texto.

### Impacto (PR-01)

Backend: Eliminacion de la logica de validacion en artifact.ts. Refactorizacion del flujo para inyectar el contexto de la pagina en el prompt del sistema.

Producto: El tutor pasa de ser un validador de formularios rigido a un evaluador cognitivo tolerante a parafraseo y sinonimos.

## Decision 2: Habilitacion de Structured Output (Configuracion del LLM)

### El Problema

El archivo gemini.ts responsable de la comunicacion con la API no enviaba el parametro generationConfig. Sin esta configuracion, es tecnicamente imposible forzar al modelo a devolver un esquema de datos determinista y estructurado, lo que impedia la existencia del "Agente Juez" que debe emitir el feedback y las citas en un formato predecible.

### La Decision

Inyeccion de generationConfig: Se modificara el adaptador de Gemini para admitir e inyectar generationConfig, especificamente utilizando la funcionalidad de responseSchema (o el equivalente soportado por el proveedor configurado) para obligar al LLM a responder en formato JSON.

Contrato del Juez (Anti-Alucinaciones): El LLM debera devolver obligatoriamente una estructura que contenga:

is_correct (boolean): Resultado de la evaluacion semantica.

feedback (string): Consolidacion de las posturas de los agentes subyacentes.

citas_pdf (string[]): Citas literales extraidas del contexto de la pagina inyectada para justificar la correccion.

### Impacto (PR-02)

Backend: Actualizacion de gemini.ts. Garantia de que la salida del LLM es parseable y tipada, evitando errores en tiempo de ejecucion al intentar leer un texto libre como si fuera un JSON.

## Decision 3: Estabilidad de Contratos y UX de Streaming

### El Problema

Se detectaron tres vulnerabilidades en el flujo de datos hacia el cliente:

Schemas Duplicados: Existia duplicacion de contratos entre shared/schemas/artifact.ts y server/domain/artifacts/artifact.ts. Al modificar uno, la compilacion pasaba, pero los campos se perdian en la serializacion HTTP.

Streaming Fragil: El decodificador de stream (stream.ts) fallaba y crasheaba la conexion ante cualquier evento NDJSON desconocido. Ademas, streamText operaba como Stream.empty, lo que impedia el renderizado real de tokens en la UI.

Estado Desacoplado: El frontend usaba useState basico en lugar del gestor de estado centralizado, ignorando los schemas Zod para validacion en cliente.

### La Decision

Single Source of Truth (SSOT) para Schemas: Se consolidaran los modelos de datos. Todos los schemas utilizados para la comunicacion cliente-servidor residiran exclusivamente en packages/shared/src/schemas/. Se eliminara la duplicacion en el backend.

Streaming Discreto (No-Tokens): Se abandona la promesa de hacer streaming palabra por palabra. Dado el comportamiento de Stream.empty y los tiempos de espera del sistema concurrente, la UI se refactorizara para consumir y mostrar estados discretos (ej. "Analizando respuesta...", "Deliberando validacion...").

Decodificador Resiliente: Se parcheara el parser NDJSON en cliente y servidor para ignorar eventos desconocidos (graceful degradation) en lugar de abortar el stream.

### Impacto (PR-03)

Arquitectura: Reduccion a cero de los errores de desincronizacion HTTP.

UX: Transparencia real del proceso multi-agente (Chain of Thought) mediante indicadores de progreso estables, sin falsas promesas de streaming de texto en vivo.

---

## Notas del thinker

No forman parte del ADR. Son hechos verificados en el código que condicionan cómo se
implementa cada decisión. Desarrollados en
[`funcionamiento-actual.md`](./funcionamiento-actual.md).

1. **La extracción de texto por página todavía no existe.** El ADR asume que
   `pdfinfo + pdftoppm` extraen contexto a nivel de página; lo que hacen es rasterizar la
   página a PNG. `PdfService` solo tiene `pageCount` y `renderPage`
   (`domain/materials/pdf-service.ts:8-15`). Sin `pdftotext` no hay "texto extraído de la
   página" que inyectar ni contra el que verificar `citas_pdf`. Es un prerrequisito
   dentro de la Decisión 1, no un PR aparte.

2. **`artifact.ts` línea 463 es solo el caso `short-answer`.** Multiple-choice y
   true-false se corrigen comparando ids y booleanos (`:422-452`), lo cual es correcto,
   instantáneo y gratis. Eliminar toda la validación de `artifact.ts` dejaría al sistema
   sin ninguna ruta de corrección cuando el LLM falle, lo que choca con el requisito de
   *graceful degradation* de la propia Tech Spec §5.

3. **Los artifacts no guardan de qué página salió cada pregunta.** No hay `materialId` ni
   páginas en los schemas (`shared/src/schemas/artifact.ts:50-79`). "La página específica
   asociada a la pregunta" no existe como dato: hay que crear ese enlace.

4. **`citas_pdf: string[]` no es verificable por sí solo.** Un array de strings no dice de
   qué material ni de qué página viene. La garantía anti-alucinación requiere comparar
   cada cita contra el texto inyectado, en código; el contrato del Juez puede seguir
   siendo `string[]` y enriquecerse en el servidor tras verificar.

5. **No hay Zod en el repo.** La validación en cliente es Effect `Schema` importado del
   barrel `effect`. "Ignorando los schemas Zod" describe algo que no existe; lo que sí
   ocurre es que el estado del chat vive en `useState` (`Chat.tsx:18-24`) en vez de en
   atoms.

6. **Orden de los PRs.** La consolidación SSOT está planificada como PR-03, pero las
   Decisiones 1 y 2 modifican esos mismos schemas. Hacerla al final obliga a editar las
   dos copias durante dos PRs y luego deshacer el trabajo. Debería ir primero.
