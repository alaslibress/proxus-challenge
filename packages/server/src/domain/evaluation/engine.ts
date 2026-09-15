import { Context, Effect, Layer, Stream } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import { FinalFeedbackSchema, type AttemptEvaluationStage, type EnrichedFeedbackSchema, type PanelAgent, type PanelAgentOutcome } from "@proxus/shared";
import { verifyCitations } from "../materials/citation.ts";
import { EvaluationUnavailable, TeacherStreamEmpty, type EvaluationError } from "./errors.ts";
import type { EvaluationTraceDraft } from "./trace.ts";
import {
  goodTeacherPrompt,
  badTeacherPrompt,
  judgePrompt,
  goodTeacherSystemPrompt,
  badTeacherSystemPrompt,
  judgeSystemPrompt,
  type EvaluationInput
} from "./prompts.ts";

export type { EvaluationInput } from "./prompts.ts";

export type EvaluationProgressEvent =
  | { readonly _tag: "stage"; readonly stage: AttemptEvaluationStage }
  | {
      readonly _tag: "reasoning";
      readonly agent: PanelAgent;
      readonly channel: "thought" | "text";
      readonly delta: string;
    };

// 30 s, no 20: desde el PR-15 el timeout cubre también el backoff de los reintentos
// (hasta ~3,5 s) además de la generación completa del profe.
const TEACHER_TIMEOUT_MS = 30_000;

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
    emit?: (event: EvaluationProgressEvent) => Effect.Effect<void>
  ) => Effect.Effect<EvaluationResult, EvaluationError, LanguageModel.LanguageModel>;
}

export const EvaluationEngineService = Context.Service<EvaluationEngineService>(
  "@proxus/server/evaluation/EvaluationEngineService"
);

const runTeacher = (
  agent: PanelAgent,
  systemPrompt: string,
  userPrompt: string,
  emit?: (event: EvaluationProgressEvent) => Effect.Effect<void>
) =>
  Effect.gen(function* () {
    let text = "";
    yield* LanguageModel.streamText({
      prompt: [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userPrompt }
      ],
      toolChoice: "none" as const
    }).pipe(
      Stream.runForEach((part) => {
        if (part.type === "text-delta") {
          text += part.delta;
          return emit?.({ _tag: "reasoning", agent, channel: "text", delta: part.delta })
            ?? Effect.void;
        }
        if (part.type === "reasoning-delta") {
          return emit?.({ _tag: "reasoning", agent, channel: "thought", delta: part.delta })
            ?? Effect.void;
        }
        return Effect.void;
      })
    );
    if (text.trim().length === 0) {
      return yield* new TeacherStreamEmpty({ message: "Teacher stream produced no text" });
    }
    return { text };
  }).pipe(Effect.timeout(TEACHER_TIMEOUT_MS));

type TeacherResult =
  | { readonly _tag: "Success"; readonly success: { readonly text: string } }
  | { readonly _tag: "Failure"; readonly failure: unknown };

const describeFailure = (result: TeacherResult & { _tag: "Failure" }): string => {
  const s = String(result.failure);
  if (s.includes("TimeoutException") || s.includes("timeout")) return `Timeout after ${TEACHER_TIMEOUT_MS / 1000}s`;
  return s;
};

const teacherOutcome = (result: TeacherResult): PanelAgentOutcome =>
  result._tag === "Success"
    ? { status: "ok", text: result.success.text }
    : { status: "failed", reason: describeFailure(result) };

const evaluate = (
  input: EvaluationInput,
  emit?: (event: EvaluationProgressEvent) => Effect.Effect<void>
): Effect.Effect<EvaluationResult, EvaluationError, LanguageModel.LanguageModel> =>
  Effect.gen(function* () {
    const startedAt = Date.now();

    if (emit !== undefined) {
      yield* emit({ _tag: "stage", stage: "evaluating_good" });
      yield* emit({ _tag: "stage", stage: "evaluating_bad" });
    }

    const [goodResult, badResult] = yield* Effect.all(
      [
        runTeacher("good_teacher", goodTeacherSystemPrompt(input.mode), goodTeacherPrompt(input), emit),
        runTeacher("bad_teacher", badTeacherSystemPrompt(input.mode), badTeacherPrompt(input), emit)
      ],
      { concurrency: "unbounded", mode: "result" }
    );

    const good = goodResult._tag === "Success" ? goodResult.success.text : null;
    const bad = badResult._tag === "Success" ? badResult.success.text : null;
    const goodTeacher = teacherOutcome(goodResult);
    const badTeacher = teacherOutcome(badResult);

    if (emit !== undefined) {
      yield* emit({ _tag: "stage", stage: "deliberating" });
    }

    const traceBase = {
      mode: input.mode,
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
        { role: "system" as const, content: judgeSystemPrompt(input.mode) },
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

    const citas_pdf = input.mode === "grounded" && input.materialId !== undefined
      ? verifyCitations(judgeOutcome.value.citas_pdf, input.evidence, input.materialId)
      : [];

    return {
      feedback: {
        is_correct: judgeOutcome.value.is_correct,
        feedback: judgeOutcome.value.feedback,
        citas_pdf,
        grounded: input.mode === "grounded",
        goodTeacher,
        badTeacher
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
