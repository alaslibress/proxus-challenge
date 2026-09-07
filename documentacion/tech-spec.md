# Tech Spec: "Mi profe favorito" (Proxus Challenge)

> Documento de intención, transcrito literalmente. No se edita.
> Las divergencias entre lo que aquí se asume y lo que el repo hace hoy están
> recogidas en [`funcionamiento-actual.md`](./funcionamiento-actual.md).

---

## 1. Vision General y Objetivo

Rol: Product Engineer (Full Stack AI)
Objetivo: Evolucionar un MVP basico de tutor academico (lector de PDFs y generador de quizzes) hacia un Sistema Multi-Agente Concurrente. El foco principal es demostrar excelencia en arquitectura de producto, dominio de IA (mitigacion de alucinaciones) y codigo robusto (tipado estricto y programacion funcional).

Timeline Critico:

Deadline de Desarrollo: Domingo por la noche (empaquetado y listo).

Buffer de Seguridad: Lunes (exclusivamente para emergencias y revision de despliegue).

## 2. Stack Tecnologico Explicito

Para garantizar la compatibilidad con el entorno actual y cumplir las restricciones, el desarrollo se ejecutara bajo el siguiente stack:

Lenguaje Base: TypeScript estricto en todo el monorepo.

Gestor de Paquetes: pnpm (Workspaces).

Backend: Node.js + Effect TS (Paradigma funcional para manejo de errores y concurrencia).

Frontend: React (gestion de estado mediante Effect Atom).

Validacion de Datos (Shared): Zod / @effect/schema.

IA (LLMs): API de Gemini (o el proveedor LLM configurado en el MVP).

Transporte/Comunicacion: Streaming mediante NDJSON (New Line Delimited JSON).

Persistencia (Local-Only): fs/promises nativo de Node (Sistema de archivos local, .json o .md).

## 3. Arquitectura Core: Sistema Multi-Agente Concurrente

Se abandona el enfoque single-prompt para adoptar un pipeline de razonamiento paralelo (Chain of Thought simulado) operado por 3 agentes distintos.

Flujo de Ejecucion (Implementado con Effect.all)

Agente 1: "Profe Bueno" (Hilo A)

Rol: Motivador y empatico.

Output: Resalta aciertos, alaba el progreso y fomenta la confianza.

Agente 2: "Profe Malo" (Hilo B)

Rol: Critico, objetivo y perfeccionista.

Output: Senala errores de forma cruda, identifica lagunas logicas y exige precision.

Agente 3: "El Juez" (Consolidador - Hilo C)

Rol: Evaluador final y filtro anti-alucinaciones.

Input: Recibe el output del Profe Bueno + Profe Malo + Contexto RAG del PDF.

Regla Estricta (Prompt Engineering): Debe emitir un JSON estructurado que unifique el feedback, obligando a incluir un array de citas_pdf (extractos literales del documento) que justifiquen cada correccion.

## 4. UX y Transparencia (Frontend)

El objetivo en UI no es un rediseno visual, sino Observabilidad del Razonamiento. Los tiempos de inferencia LLM seran asincronos y largos; el usuario debe ver el proceso.

Interceptacion de Stream NDJSON: Se parseara el stream en tiempo real desde el backend.

UI States (Effect Atom):

[Profe Bueno analizando...] (Animacion leve).

[Profe Malo criticando...] (Animacion leve).

[Juez deliberando validaciones del PDF...]

Renderizado Final: Visualizacion del JSON estructurado del feedback, destacando visualmente las citas extraidas del PDF para generar confianza en la respuesta (Zero-Hallucination UX).

## 5. Restricciones y Reglas de Oro (Strict Rules)

Concurrencia Funcional: Prohibido usar Promise.all crudo. Se debe utilizar obligatoriamente Effect.all para ejecutar al Profe Bueno y Profe Malo en paralelo, manejando los posibles fallos (fallbacks) dentro del ecosistema Effect.

Contratos Inviolables (Shared): Cualquier cambio estructural en el JSON del LLM debe reflejarse primero en packages/shared/src/schemas/.

Check obligatorio: El comando pnpm run typecheck debe pasar en verde en cliente y servidor.

Persistencia Local (No DBs): Estrictamente prohibido levantar contenedores de bases de datos (PostgreSQL, MongoDB, etc.). Toda la persistencia de estados de sesion o historiales se leera/escribira en packages/server/.data/ usando el FileSystem.

Testing LLM (Evals): Implementacion de validaciones a nivel de codigo para asegurar que:

El LLM responde con la estructura JSON requerida.

El campo citas_pdf existe y no esta vacio si hay correcciones.

Los fallos del LLM no crashean el servidor (Graceful degradation).

## 6. Plan de Ejecucion Comprimido (Fases de Desarrollo)

Fase 1: Infraestructura y Contratos (Capa Shared)

Ubicacion: packages/shared/src/schemas/

Acciones:

Definir los Schemas (@effect/schema o Zod) para los estados intermedios del sistema multi-agente.

Crear el schema FinalFeedbackSchema que obligue a tener la propiedad citas_pdf: string[].

Fase 2: Motor Multi-Agente (Backend)

Ubicacion: packages/server/ (Específicamente en TutorChatService).

Acciones:

Construir los 3 System Prompts aislados.

Refactorizar el servicio para usar Effect.all([agenteBueno(), agenteMalo()], { concurrency: "unbounded" }).

Pasar los resultados al Agente Juez junto con los chunks del PDF.

Formatear la salida del Juez para que cumpla el Schema de la Fase 1.

Fase 3: Observabilidad y UI (Frontend / Transport)

Ubicacion: packages/client/ y handlers de red.

Acciones:

Modificar el parseo de NDJSON para admitir "eventos de estado" ademas de "eventos de texto".

Actualizar los Effect Atom en React para suscribirse a estos eventos intermedios.

Renderizar condicionalmente los estados ("Analizando...", "Deliberando...") sin bloquear el hilo principal.

Maquetar el componente final que muestra la evaluacion y resalta las citas del PDF.

Fase 4: Testing, Evals y Cierre (QA & Docs)

Acciones:

Ejecutar pnpm run typecheck a nivel raiz.

Realizar Smoke Tests subiendo un PDF con informacion compleja y forzar a la IA a corregir un error.

Verificar que el sistema rechaza respuestas del LLM malformadas.

Redactar un README.md exhaustivo justificando los trade-offs, la decision de usar Effect.all y la arquitectura Multi-Agente.

(Nota Opcional - Solo si hay margen el domingo): Implementar un sistema rudimentario de Long-term Memory guardando el historial de feedback estructurado en archivos .md dentro de .data/, etiquetados por sesion.
