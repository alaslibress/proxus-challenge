import { Effect, Layer } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import { FinalFeedbackSchema } from "@proxus/shared";
import { GeminiModel } from "./gemini.ts";

const prompt =
  "El alumno respondió 'la media es 4'. El texto dice 'la media aritmética es 4'. Evalúa.";

const program = Effect.gen(function* () {
  const response = yield* LanguageModel.generateObject({
    prompt,
    schema: FinalFeedbackSchema,
    objectName: "final_feedback"
  });

  console.log(JSON.stringify(response.value, null, 2));

  return response.value;
}).pipe(
  Effect.provide(Layer.mergeAll(GeminiModel))
);

if (import.meta.main) {
  Effect.runPromise(program);
}
