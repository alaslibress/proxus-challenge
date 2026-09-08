# Tutor AI agent

## Objetivo

El tutor ayuda a estudiar usando materiales locales y creando artefactos de aprendizaje:

- `note`: apunte/explicación.
- `quiz`: ejercicio corto, cerrado y autocorregible.
- `test`: evaluación más completa; puede incluir respuesta corta.

## Archivos principales

- `packages/server/src/domain/agents/academic-tutor.ts`
- `packages/server/src/domain/agents/academic-tutor/tutor-chat-service.ts`
- `packages/server/src/domain/agents/harness/session.ts`
- `packages/server/src/domain/agents/gemini.ts`

Skills:

- `packages/server/src/domain/agents/academic-tutor/skills/use-uploaded-materials.ts`
- `packages/server/src/domain/agents/academic-tutor/skills/create-study-artifacts.ts`

Commands:

- `packages/server/src/domain/agents/academic-tutor/material-commands.ts`
- `packages/server/src/domain/agents/academic-tutor/artifact-commands.ts`

## Modelo mental

El modelo no recibe acceso directo a todo el backend. El harness le expone tools controladas:

- `load_skill({ name })`: carga instrucciones para una capacidad.
- `cli({ command })`: ejecuta comandos permitidos.

Las skills no son tools. Si Gemini intenta llamar una skill como tool, el adapter redirige esa llamada a `load_skill` cuando puede.

## Comandos disponibles

Materiales:

```txt
materials list
materials view <materialId> <pages>
```

Artifacts:

```txt
artifacts list
artifacts show <artifactId>
artifacts create '<json>'
artifacts submit '<json>'
artifacts attempts [artifactId]
artifacts grade <attemptId>
```

`materials view` puede devolver imágenes de páginas para llamadas multimodales a Gemini.

## Flujo de chat

1. La web envía mensajes a `/api/tutor/chat/stream`.
2. El server crea/continúa una sesión del tutor.
3. Gemini responde con texto o function calls.
4. El harness ejecuta tools permitidas y añade resultados a la conversación.
5. La web recibe eventos NDJSON:
   - `{ type: "message", message }`
   - `{ type: "done" }`
6. Si hubo tool results, la web invalida materiales/artifacts.

## Salida estructurada (JSON) — PR-03

El adaptador de Gemini (`packages/server/src/domain/agents/gemini.ts`) honra
`options.responseFormat` cuando se llama a `LanguageModel.generateObject({ schema, ... })`
en lugar de `generateText`. En ese caso:

- `requestBody` añade `generationConfig: { responseMimeType: "application/json", responseSchema }`.
- `responseSchema` se deriva de la `Schema` de Effect con `Schema.toJsonSchemaDocument`, se
  resuelven sus `$ref` con `resolveAllRefs` y se sanea al subconjunto tipo OpenAPI que
  acepta Gemini con `toGeminiResponseSchema` (`packages/server/src/domain/agents/gemini-schema.ts`,
  ambas funciones puras y sin dependencia de Effect ni de API key).
- En modo texto (`responseFormat.type === "text"`), `generationConfig` es `undefined` y el
  cuerpo de la petición no cambia respecto al comportamiento anterior.
- `LanguageModel.generateObject` decodifica la respuesta con el `defaultCodecTransformer`
  de Effect; si el modelo no respeta el schema, el fallo es un `AiError.InvalidOutputError`
  tipado, no una excepción ni un `JSON.parse` manual.

El contrato de evaluación (`FinalFeedbackSchema`, `EnrichedFeedbackSchema`) vive en
`packages/shared/src/schemas/evaluation.ts`.

Script de verificación manual contra la API real:

```bash
pnpm --filter @proxus/server run structured-output:check
```

Llama a `LanguageModel.generateObject` con `FinalFeedbackSchema` y un prompt de ejemplo, y
escribe el objeto decodificado por consola. **El subconjunto de `responseSchema` que
acepta Gemini no está garantizado por ningún tipo**: hay que ejecutar este script contra la
API real antes de confiar en un schema nuevo.

## Configuración

```env
GOOGLE_GENERATIVE_AI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
```

## Buenas prácticas al tocar AI

- Haz que una nueva capacidad sea observable: logs, tool results o artefactos claros.
- Limita el set de comandos disponibles; no conviertas el CLI en shell general.
- Escribe prompts/skills que expliquen cuándo usar cada tool.
- Añade smoke tests o evals si el cambio afecta comportamiento del tutor.
- Diseña fallbacks: el modelo puede equivocarse llamando tools o generando JSON.

## Smoke test manual

```bash
pnpm --filter @proxus/server run agent:tutor "list my uploaded materials"
pnpm --filter @proxus/server run agent:tutor "Crea un quiz corto de una pregunta sobre variables cualitativas"
```

Después, abre la web y comprueba que el artifact aparece en la sidebar y puede resolverse.
