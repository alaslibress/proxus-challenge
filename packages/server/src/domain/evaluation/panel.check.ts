import { Console, Effect, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { LanguageModel } from "effect/unstable/ai";
import { GeminiModel } from "../agents/gemini.ts";
import { FileMaterialRepository } from "../../infra/materials/file-material-repository.ts";
import { PopplerPdfService } from "../../infra/materials/poppler-pdf-service.ts";
import { FileEvaluationTrace } from "../../infra/evaluation/file-evaluation-trace.ts";
import { MaterialRepository } from "../materials/material.ts";
import { EvaluationTrace } from "./trace.ts";
import { EvaluationEngineService, EvaluationEngineServiceLive } from "./engine.ts";
import { panelRaisesScore } from "./review.ts";
import {
  goodTeacherPrompt,
  badTeacherPrompt,
  goodTeacherSystemPrompt,
  badTeacherSystemPrompt,
  type EvaluationMode
} from "./prompts.ts";

const args = process.argv.slice(2);
const [studentAnswer, expectedAnswer, materialIdArg, pageArg, modeArg] = args;

const program = Effect.gen(function* () {
  if (studentAnswer === undefined || expectedAnswer === undefined) {
    yield* Console.error(
      "Usage: panel.check.ts <studentAnswer> <expectedAnswer> <materialId> <page> [grounded|ungrounded]"
    );
    return yield* Effect.fail("missing arguments" as const);
  }

  const mode: EvaluationMode =
    modeArg === "ungrounded" ? "ungrounded" : "grounded";

  const engine = yield* EvaluationEngineService;
  const trace = yield* EvaluationTrace;

  let input;

  if (mode === "ungrounded" || materialIdArg === undefined || materialIdArg === "-") {
    input = {
      questionId: "panel-check",
      questionPrompt: "(panel:check) Evalúa la respuesta corta del alumno.",
      expectedAnswer,
      studentAnswer,
      mode: "ungrounded" as EvaluationMode,
      materialId: undefined,
      pages: [] as number[],
      evidence: [] as { page: number; text: string }[]
    };
  } else {
    const materialRepository = yield* MaterialRepository;
    const page = Number(pageArg);
    const { pages } = yield* materialRepository.extractText(materialIdArg, [page]);

    input = {
      questionId: "panel-check",
      questionPrompt: "(panel:check) Evalúa la respuesta corta del alumno.",
      expectedAnswer,
      studentAnswer,
      mode: "grounded" as EvaluationMode,
      materialId: materialIdArg,
      pages: [page],
      evidence: pages
    };
  }

  // Repetimos las llamadas a los dos profes por separado (fuera del motor) solo para
  // poder imprimirlas: el motor no expone las críticas intermedias, solo el veredicto
  // final del Juez.
  const [good, bad] = yield* Effect.all([
    LanguageModel.generateText({
      prompt: [
        { role: "system" as const, content: goodTeacherSystemPrompt(input.mode) },
        { role: "user" as const, content: goodTeacherPrompt(input) }
      ],
      toolChoice: "none" as const
    }),
    LanguageModel.generateText({
      prompt: [
        { role: "system" as const, content: badTeacherSystemPrompt(input.mode) },
        { role: "user" as const, content: badTeacherPrompt(input) }
      ],
      toolChoice: "none" as const
    })
  ], { concurrency: "unbounded", mode: "result" });

  yield* Console.log("=== Good Teacher ===");
  yield* Console.log(good._tag === "Success" ? good.success.text : `(falló) ${JSON.stringify(good)}`);

  yield* Console.log("\n=== Bad Teacher ===");
  yield* Console.log(bad._tag === "Success" ? bad.success.text : `(falló) ${JSON.stringify(bad)}`);

  const result = yield* engine.evaluate(input);

  yield* Console.log("\n=== Juez (JSON final) ===");
  yield* Console.log(JSON.stringify(result.feedback, null, 2));

  // Misma regla que aplica el motor (`panelRaisesScore` en review.ts): un veredicto
  // "correcto" sin cita verificada NO sube la nota, y la traza debe decir lo mismo.
  const overridden = panelRaisesScore(result.feedback);

  yield* trace.record({
    ...result.trace,
    attemptId: `panel-check-${Date.now()}`,
    artifactId: "panel-check",
    deterministicScore: 0,
    finalScore: overridden ? 1 : 0,
    scoreOverridden: overridden
  });

  return result.feedback;
}).pipe(
  Effect.provide(Layer.mergeAll(
    EvaluationEngineServiceLive,
    GeminiModel,
    FileMaterialRepository.layer(".data/materials/pdfs").pipe(
      Layer.provide(PopplerPdfService.layer),
      Layer.provide(NodeServices.layer)
    ),
    FileEvaluationTrace.layer(".data/sessions").pipe(
      Layer.provide(NodeServices.layer)
    )
  ))
);

if (import.meta.main) {
  Effect.runPromise(program as Effect.Effect<unknown, unknown, never>);
}
