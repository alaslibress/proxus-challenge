import { Console, Effect, Layer } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import { GeminiModel } from "../agents/gemini.ts";
import { FileMaterialRepository } from "../../infra/materials/file-material-repository.ts";
import { PopplerPdfService } from "../../infra/materials/poppler-pdf-service.ts";
import { FileEvaluationTrace } from "../../infra/evaluation/file-evaluation-trace.ts";
import { MaterialRepository } from "../materials/material.ts";
import { EvaluationTrace } from "./trace.ts";
import { EvaluationEngineService, EvaluationEngineServiceLive } from "./engine.ts";
import {
  goodTeacherPrompt,
  badTeacherPrompt,
  GOOD_TEACHER_SYSTEM_PROMPT,
  BAD_TEACHER_SYSTEM_PROMPT
} from "./prompts.ts";

const [studentAnswer, expectedAnswer, materialId, pageArg] = process.argv.slice(2);

const program = Effect.gen(function* () {
  if (studentAnswer === undefined || expectedAnswer === undefined || materialId === undefined || pageArg === undefined) {
    yield* Console.error(
      "Usage: panel.check.ts <studentAnswer> <expectedAnswer> <materialId> <page>"
    );
    return yield* Effect.fail("missing arguments" as const);
  }

  const page = Number(pageArg);
  const materialRepository = yield* MaterialRepository;
  const engine = yield* EvaluationEngineService;
  const trace = yield* EvaluationTrace;

  const { pages } = yield* materialRepository.extractText(materialId, [page]);

  const input = {
    questionId: "panel-check",
    questionPrompt: "(panel:check) Evalúa la respuesta corta del alumno.",
    expectedAnswer,
    studentAnswer,
    materialId,
    pages: [page],
    evidence: pages
  };

  // Repetimos las llamadas a los dos profes por separado (fuera del motor) solo para
  // poder imprimirlas: el motor no expone las críticas intermedias, solo el veredicto
  // final del Juez.
  const [good, bad] = yield* Effect.all([
    LanguageModel.generateText({
      prompt: [
        { role: "system" as const, content: GOOD_TEACHER_SYSTEM_PROMPT },
        { role: "user" as const, content: goodTeacherPrompt(input) }
      ],
      toolChoice: "none" as const
    }),
    LanguageModel.generateText({
      prompt: [
        { role: "system" as const, content: BAD_TEACHER_SYSTEM_PROMPT },
        { role: "user" as const, content: badTeacherPrompt(input) }
      ],
      toolChoice: "none" as const
    })
  ], { concurrency: "unbounded", mode: "result" });

  yield* Console.log("=== Profe Bueno ===");
  yield* Console.log(good._tag === "Success" ? good.success.text : `(falló) ${JSON.stringify(good)}`);

  yield* Console.log("\n=== Profe Malo ===");
  yield* Console.log(bad._tag === "Success" ? bad.success.text : `(falló) ${JSON.stringify(bad)}`);

  const result = yield* engine.evaluate(input);

  yield* Console.log("\n=== Juez (JSON final) ===");
  yield* Console.log(JSON.stringify(result.feedback, null, 2));

  yield* trace.record({
    ...result.trace,
    attemptId: `panel-check-${Date.now()}`,
    artifactId: "panel-check",
    deterministicScore: 0,
    finalScore: result.feedback.is_correct ? 1 : 0,
    scoreOverridden: result.feedback.is_correct
  });

  return result.feedback;
}).pipe(
  Effect.provide(Layer.mergeAll(
    EvaluationEngineServiceLive,
    GeminiModel,
    FileMaterialRepository.layer(".data/materials/pdfs").pipe(
      Layer.provide(PopplerPdfService.layer)
    ),
    FileEvaluationTrace.layer(".data/sessions")
  ))
);

if (import.meta.main) {
  Effect.runPromise(program as Effect.Effect<unknown, unknown, never>);
}
