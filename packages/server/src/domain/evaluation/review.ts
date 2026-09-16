import { Effect, Queue, Stream } from "effect";
import type { EvaluationProgressEvent } from "./engine.ts";
import { LanguageModel } from "effect/unstable/ai";
import type {
  Artifact,
  ArtifactAttempt,
  AttemptStreamEvent,
  EnrichedFeedbackSchema,
  PanelStatus,
  QuestionCorrection,
  ShortAnswerCorrection,
  TestQuestion,
  UngroundedReason
} from "@proxus/shared";
import type { PageText } from "../materials/material.ts";
import { MaterialRepository } from "../materials/material.ts";
import { EvaluationEngineService } from "./engine.ts";
import { EvaluationTrace } from "./trace.ts";
import type { EvaluationMode } from "./prompts.ts";

const findTestQuestion = (
  artifact: Artifact,
  questionId: string
): TestQuestion | undefined =>
  artifact.kind === "test"
    ? artifact.questions.find((question) => question.id === questionId)
    : undefined;

const evidenceForQuestion = (
  source: { readonly materialId: string; readonly pages: readonly number[] },
  question: TestQuestion
): readonly number[] => {
  if (question.sourcePage !== undefined) {
    return [question.sourcePage];
  }
  return source.pages;
};

interface ResolvedEvidence {
  readonly mode: EvaluationMode;
  readonly materialId: string | undefined;
  readonly pages: readonly number[];
  readonly evidence: readonly PageText[];
  readonly why?: UngroundedReason;
}

const ungrounded = (why: UngroundedReason, materialId?: string): ResolvedEvidence => ({
  mode: "ungrounded",
  materialId,
  pages: [],
  evidence: [],
  why
});

/** La única regla que puede subir una nota: el Juez la da por correcta Y, en modo grounded,
 * al menos una de sus citas quedó verificada contra el texto real del PDF. En modo
 * ungrounded basta con que el Juez diga que es correcta. */
export const panelRaisesScore = (review: EnrichedFeedbackSchema | undefined): boolean =>
  review !== undefined
    && review.is_correct
    && (review.grounded
      ? review.citas_pdf.some((citation) => citation.verified)
      : true);

const resolveEvidence = (
  artifact: Artifact,
  question: TestQuestion
): Effect.Effect<ResolvedEvidence, never, MaterialRepository> =>
  Effect.gen(function* () {
    if (artifact.source === undefined) {
      return ungrounded("no-source");
    }

    const materialId = artifact.source.materialId;
    const pages = evidenceForQuestion(artifact.source, question);
    if (pages.length === 0) {
      return ungrounded("no-pages", materialId);
    }

    const materialRepository = yield* MaterialRepository;
    const pageTexts: readonly PageText[] | undefined = yield* materialRepository
      .extractText(materialId, pages)
      .pipe(
        Effect.map((result) => result.pages),
        Effect.catch((error) =>
          Effect.log("evidence.extraction_failed").pipe(
            Effect.annotateLogs({ artifactId: artifact.id, error: String(error) }),
            Effect.as(undefined)
          )
        )
      );

    if (pageTexts === undefined) {
      return ungrounded("extract-failed", materialId);
    }

    const nonEmptyPages = pageTexts.filter((page) => page.text.trim().length > 0);
    if (nonEmptyPages.length === 0) {
      return ungrounded("empty-pages", materialId);
    }

    return { mode: "grounded", materialId, pages, evidence: nonEmptyPages };
  });

const reviewCorrection = (
  artifact: Artifact,
  attemptId: string,
  correction: ShortAnswerCorrection,
  studentAnswer: string,
  emit?: (event: EvaluationProgressEvent) => Effect.Effect<void>
): Effect.Effect<
  ShortAnswerCorrection,
  never,
  EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel | EvaluationTrace
> => Effect.gen(function* () {
  const question = findTestQuestion(artifact, correction.questionId);
  if (question === undefined || question.type !== "short-answer") {
    return correction;
  }

  const resolved = yield* resolveEvidence(artifact, question);
  const engine = yield* EvaluationEngineService;
  const trace = yield* EvaluationTrace;

  const outcome = yield* engine.evaluate({
    questionId: correction.questionId,
    questionPrompt: question.prompt,
    expectedAnswer: question.expectedAnswer,
    studentAnswer,
    mode: resolved.mode,
    materialId: resolved.materialId,
    pages: resolved.pages,
    evidence: resolved.evidence
  }, emit).pipe(
    Effect.match({
      onFailure: (error) => ({ review: undefined, trace: error.trace }),
      onSuccess: (value) => ({ review: value.feedback, trace: value.trace })
    })
  );

  const deterministicScore = correction.score;
  const finalScore = panelRaisesScore(outcome.review)
    ? question.maxScore
    : deterministicScore;
  const scoreOverridden = finalScore !== deterministicScore;

  yield* trace.record({
    ...outcome.trace,
    attemptId,
    artifactId: artifact.id,
    deterministicScore,
    finalScore,
    scoreOverridden,
    ...(resolved.mode === "ungrounded" && resolved.why !== undefined ? { ungroundedWhy: resolved.why } : {})
  });

  const panel: PanelStatus | undefined = outcome.review !== undefined
    ? resolved.mode === "grounded"
      ? { ran: true, grounded: true }
      : { ran: true, grounded: false, why: resolved.why ?? "no-source" }
    : { ran: false, why: "judge-unavailable" };

  if (outcome.review === undefined) {
    return { ...correction, ...(panel !== undefined ? { panel } : {}) };
  }

  return {
    ...correction,
    score: finalScore,
    review: outcome.review,
    ...(panel !== undefined ? { panel } : {})
  };
});

export const reviewGradedAttempt = (
  artifact: Artifact,
  attempt: ArtifactAttempt
): Effect.Effect<
  ArtifactAttempt,
  never,
  EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel | EvaluationTrace
> => Effect.gen(function* () {
  if (attempt.status !== "graded" || attempt.artifactKind !== "test") {
    return attempt;
  }

  const reviewOne = (
    correction: QuestionCorrection
  ): Effect.Effect<QuestionCorrection, never, EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel | EvaluationTrace> => {
    if (correction.questionType !== "short-answer") {
      return Effect.succeed(correction);
    }

    const answer = attempt.answers.find(
      (candidate) => candidate.questionId === correction.questionId
    );

    return answer !== undefined && answer.questionType === "short-answer"
      ? reviewCorrection(artifact, attempt.id, correction, answer.answer)
      : Effect.succeed(correction);
  };

  const corrections: QuestionCorrection[] = yield* Effect.forEach(attempt.corrections, reviewOne);

  return {
    ...attempt,
    corrections
  };
});

const executeStreaming = (
  artifact: Artifact,
  attempt: ArtifactAttempt,
  emit: (event: AttemptStreamEvent) => Effect.Effect<void>
): Effect.Effect<void, never, EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel | EvaluationTrace> =>
  Effect.gen(function* () {
    if (attempt.status !== "graded" || attempt.artifactKind !== "test") {
      yield* emit({ type: "done", payload: attempt });
      return;
    }

    // Only short-answer corrections with a matching short-answer answer are ever routed
    // to the engine (see reviewCorrection). questionIndex/questionTotal count that subset,
    // not all corrections, so the UI can show accurate progress across the questions that
    // actually go through evaluation.
    const questionIndexById = new Map<string, number>();
    let total = 0;
    for (const correction of attempt.corrections) {
      if (correction.questionType !== "short-answer") continue;
      const answer = attempt.answers.find((candidate) => candidate.questionId === correction.questionId);
      if (answer === undefined || answer.questionType !== "short-answer") continue;
      questionIndexById.set(correction.questionId, total);
      total++;
    }

    const reviewOne = (
      correction: QuestionCorrection
    ): Effect.Effect<QuestionCorrection, never, EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel | EvaluationTrace> => {
      if (correction.questionType !== "short-answer") {
        return Effect.succeed(correction);
      }

      const questionIndex = questionIndexById.get(correction.questionId);
      const answer = attempt.answers.find(
        (candidate) => candidate.questionId === correction.questionId
      );

      if (questionIndex === undefined || answer === undefined || answer.questionType !== "short-answer") {
        return Effect.succeed(correction);
      }

      const panelEmit = (event: EvaluationProgressEvent) =>
        event._tag === "stage"
          ? emit({ type: "status", value: event.stage, questionId: correction.questionId, questionIndex, questionTotal: total })
          : emit({ type: "reasoning", agent: event.agent, channel: event.channel, delta: event.delta, questionId: correction.questionId, questionIndex, questionTotal: total });

      return reviewCorrection(artifact, attempt.id, correction, answer.answer, panelEmit);
    };

    const corrections: QuestionCorrection[] = yield* Effect.forEach(attempt.corrections, reviewOne);

    yield* emit({ type: "done", payload: { ...attempt, corrections } });
  });

export const reviewGradedAttemptStreaming = (
  artifact: Artifact,
  attempt: ArtifactAttempt
): Stream.Stream<AttemptStreamEvent, never, EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel | EvaluationTrace> =>
  Stream.callback<AttemptStreamEvent, never, EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel | EvaluationTrace>(
    (queue) =>
      executeStreaming(artifact, attempt, (event) => Queue.offer(queue, event).pipe(Effect.asVoid)).pipe(
        Effect.andThen(Queue.end(queue)),
        Effect.catchCause((cause) =>
          Queue.offer(queue, { type: "error", message: String(cause) }).pipe(
            Effect.andThen(Queue.end(queue))
          )
        )
      )
  );
