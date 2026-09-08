import { Context, Effect, Layer } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import { FinalFeedbackSchema, type AttemptEvaluationStage, type EnrichedFeedbackSchema } from "@proxus/shared";
import { verifyCitations } from "../materials/citation.ts";
import { EvaluationUnavailable, type EvaluationError } from "./errors.ts";
import type { EvaluationTraceDraft } from "./trace.ts";
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

/** Lo que devuelve `evaluate`: el veredicto que consume la UI, y el borrador de traza
 * con todo lo que el motor sabe y `review.ts` no puede reconstruir (texto de cada profe
 * o su motivo de fallo, JSON crudo del Juez). */
export interface EvaluationResult {
  readonly feedback: EnrichedFeedbackSchema;
  readonly trace: EvaluationTraceDraft;
}

export interface EvaluationEngineService {
  readonly evaluate: (
    input: EvaluationInput,
    emit?: (stage: AttemptEvaluationStage) => Effect.Effect<void>
  ) => Effect.Effect<EvaluationResult, EvaluationError, LanguageModel.LanguageModel>;
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

type TeacherResult =
  | { readonly _tag: "Success"; readonly success: { readonly text: string } }
  | { readonly _tag: "Failure"; readonly failure: unknown };

const teacherOutcome = (
  result: TeacherResult
): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string } =>
  result._tag === "Success"
    ? { ok: true, text: result.success.text }
    : { ok: false, reason: String(result.failure) };

const evaluate = (
  input: EvaluationInput,
  emit?: (stage: AttemptEvaluationStage) => Effect.Effect<void>
): Effect.Effect<EvaluationResult, EvaluationError, LanguageModel.LanguageModel> =>
  Effect.gen(function* () {
    const startedAt = Date.now();

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
    const goodTeacher = teacherOutcome(goodResult);
    const badTeacher = teacherOutcome(badResult);

    if (emit !== undefined) {
      yield* emit("deliberating");
    }

    const traceBase = {
      questionId: input.questionId,
      questionPrompt: input.questionPrompt,
      expectedAnswer: input.expectedAnswer,
      studentAnswer: input.studentAnswer,
      materialId: input.materialId,
      pages: input.pages,
      evidence: input.evidence,
      goodTeacher,
      badTeacher
    };

    const judgeOutcome = yield* LanguageModel.generateObject({
      prompt: [
        { role: "system" as const, content: JUDGE_SYSTEM_PROMPT },
        { role: "user" as const, content: judgePrompt(input, { good, bad }) }
      ],
      schema: FinalFeedbackSchema,
      objectName: "final_feedback"
    }).pipe(
      Effect.match({
        onFailure: (reason) => ({ ok: false as const, reason }),
        onSuccess: (result) => ({ ok: true as const, value: result.value })
      })
    );

    const durationMs = Date.now() - startedAt;

    if (!judgeOutcome.ok) {
      return yield* new EvaluationUnavailable({
        reason: judgeOutcome.reason,
        stage: "judge",
        trace: {
          ...traceBase,
          judge: { failed: String(judgeOutcome.reason) },
          citations: [],
          durationMs
        }
      });
    }

    const citas_pdf = verifyCitations(judgeOutcome.value.citas_pdf, input.evidence, input.materialId);

    return {
      feedback: {
        is_correct: judgeOutcome.value.is_correct,
        feedback: judgeOutcome.value.feedback,
        citas_pdf
      },
      trace: {
        ...traceBase,
        judge: judgeOutcome.value,
        citations: citas_pdf,
        durationMs
      }
    };
  });

export const EvaluationEngineServiceLive = Layer.succeed(EvaluationEngineService)({
  evaluate
});
