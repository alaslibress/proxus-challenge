import { Context, Effect, Layer } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import { FinalFeedbackSchema, type AttemptEvaluationStage, type EnrichedFeedbackSchema } from "@proxus/shared";
import { verifyCitations } from "../materials/citation.ts";
import { EvaluationUnavailable, type EvaluationError } from "./errors.ts";
import {
  goodTeacherPrompt,
  badTeacherPrompt,
  judgePrompt,
  GOOD_TEACHER_SYSTEM_PROMPT,
  BAD_TEACHER_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
  type EvaluationInput
} from "./prompts.ts";

export type { EvaluationInput } from "./prompts.ts";

const TEACHER_TIMEOUT_MS = 20_000;

export interface EvaluationEngineService {
  readonly evaluate: (
    input: EvaluationInput,
    emit?: (stage: AttemptEvaluationStage) => Effect.Effect<void>
  ) => Effect.Effect<EnrichedFeedbackSchema, EvaluationError, LanguageModel.LanguageModel>;
}

export const EvaluationEngineService = Context.Service<EvaluationEngineService>(
  "@proxus/server/evaluation/EvaluationEngineService"
);

const runTeacher = (systemPrompt: string, userPrompt: string) =>
  LanguageModel.generateText({
    prompt: [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt }
    ],
    toolChoice: "none" as const
  }).pipe(
    Effect.timeout(TEACHER_TIMEOUT_MS)
  );

const evaluate = (
  input: EvaluationInput,
  emit?: (stage: AttemptEvaluationStage) => Effect.Effect<void>
): Effect.Effect<EnrichedFeedbackSchema, EvaluationError, LanguageModel.LanguageModel> =>
  Effect.gen(function* () {
    if (emit !== undefined) {
      yield* emit("evaluating_good");
      yield* emit("evaluating_bad");
    }

    const [goodResult, badResult] = yield* Effect.all(
      [
        runTeacher(GOOD_TEACHER_SYSTEM_PROMPT, goodTeacherPrompt(input)),
        runTeacher(BAD_TEACHER_SYSTEM_PROMPT, badTeacherPrompt(input))
      ],
      { concurrency: "unbounded", mode: "result" }
    );

    const good = goodResult._tag === "Success" ? goodResult.success.text : null;
    const bad = badResult._tag === "Success" ? badResult.success.text : null;

    if (emit !== undefined) {
      yield* emit("deliberating");
    }

    const judgeResult = yield* LanguageModel.generateObject({
      prompt: [
        { role: "system" as const, content: JUDGE_SYSTEM_PROMPT },
        { role: "user" as const, content: judgePrompt(input, { good, bad }) }
      ],
      schema: FinalFeedbackSchema,
      objectName: "final_feedback"
    }).pipe(
      Effect.mapError((reason) => new EvaluationUnavailable({ reason, stage: "judge" }))
    );

    const citas_pdf = verifyCitations(judgeResult.value.citas_pdf, input.evidence, input.materialId);

    return {
      is_correct: judgeResult.value.is_correct,
      feedback: judgeResult.value.feedback,
      citas_pdf
    };
  });

export const EvaluationEngineServiceLive = Layer.succeed(EvaluationEngineService)({
  evaluate
});
