import { Effect, Queue, Stream } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import type {
  Artifact,
  ArtifactAttempt,
  AttemptEvaluationStage,
  AttemptStreamEvent,
  QuestionCorrection,
  ShortAnswerCorrection,
  TestQuestion
} from "@proxus/shared";
import type { PageText } from "../materials/material.ts";
import { MaterialRepository } from "../materials/material.ts";
import { EvaluationEngineService } from "./engine.ts";
import { EvaluationTrace, type EvaluationTraceEntry } from "./trace.ts";

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

// Cuando el panel nunca llega a llamarse por falta de evidencia, se registra igual: un
// log que solo cuenta los éxitos no sirve para auditar (plan PR-06, paso 5).
const noEvidenceTraceEntry = (params: {
  readonly attemptId: string;
  readonly artifactId: string;
  readonly questionId: string;
  readonly questionPrompt: string;
  readonly expectedAnswer: string;
  readonly studentAnswer: string;
  readonly materialId: string | undefined;
  readonly pages: readonly number[];
  readonly score: number;
  readonly reason: string;
}): EvaluationTraceEntry => ({
  attemptId: params.attemptId,
  artifactId: params.artifactId,
  questionId: params.questionId,
  questionPrompt: params.questionPrompt,
  expectedAnswer: params.expectedAnswer,
  studentAnswer: params.studentAnswer,
  materialId: params.materialId,
  pages: params.pages,
  evidence: [],
  goodTeacher: { ok: false, reason: params.reason },
  badTeacher: { ok: false, reason: params.reason },
  judge: { failed: params.reason },
  citations: [],
  deterministicScore: params.score,
  finalScore: params.score,
  scoreOverridden: false,
  durationMs: 0
});

const reviewCorrection = (
  artifact: Artifact,
  attemptId: string,
  correction: ShortAnswerCorrection,
  studentAnswer: string,
  emit?: (stage: AttemptEvaluationStage) => Effect.Effect<void>
): Effect.Effect<
  ShortAnswerCorrection,
  never,
  EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel | EvaluationTrace
> => Effect.gen(function* () {
  const question = findTestQuestion(artifact, correction.questionId);
  if (question === undefined || question.type !== "short-answer") {
    return correction;
  }

  if (artifact.source === undefined) {
    return correction;
  }

  const materialId = artifact.source.materialId;
  const pages = evidenceForQuestion(artifact.source, question);
  if (pages.length === 0) {
    return correction;
  }

  const trace = yield* EvaluationTrace;
  const materialRepository = yield* MaterialRepository;

  const pageTexts: readonly PageText[] | undefined = yield* materialRepository
    .extractText(materialId, pages)
    .pipe(
      Effect.map((result) => result.pages),
      Effect.orElseSucceed(() => undefined)
    );

  if (pageTexts === undefined) {
    yield* trace.record(noEvidenceTraceEntry({
      attemptId,
      artifactId: artifact.id,
      questionId: correction.questionId,
      questionPrompt: question.prompt,
      expectedAnswer: question.expectedAnswer,
      studentAnswer,
      materialId,
      pages,
      score: correction.score,
      reason: "No se pudo extraer el texto del material."
    }));
    return correction;
  }

  const nonEmptyPages = pageTexts.filter((page) => page.text.trim().length > 0);
  if (nonEmptyPages.length === 0) {
    yield* trace.record(noEvidenceTraceEntry({
      attemptId,
      artifactId: artifact.id,
      questionId: correction.questionId,
      questionPrompt: question.prompt,
      expectedAnswer: question.expectedAnswer,
      studentAnswer,
      materialId,
      pages,
      score: correction.score,
      reason: "El texto extraído de las páginas estaba vacío (sin capa de texto)."
    }));
    return correction;
  }

  const engine = yield* EvaluationEngineService;

  const outcome = yield* engine.evaluate({
    questionId: correction.questionId,
    questionPrompt: question.prompt,
    expectedAnswer: question.expectedAnswer,
    studentAnswer,
    materialId,
    pages,
    evidence: nonEmptyPages
  }, emit).pipe(
    Effect.match({
      onFailure: (error) => ({ review: undefined, trace: error.trace }),
      onSuccess: (value) => ({ review: value.feedback, trace: value.trace })
    })
  );

  const deterministicScore = correction.score;
  const hasVerifiedCitation = outcome.review !== undefined
    && outcome.review.citas_pdf.some((citation) => citation.verified);
  const finalScore = outcome.review !== undefined && hasVerifiedCitation && outcome.review.is_correct
    ? question.maxScore
    : deterministicScore;
  const scoreOverridden = finalScore !== deterministicScore;

  yield* trace.record({
    ...outcome.trace,
    attemptId,
    artifactId: artifact.id,
    deterministicScore,
    finalScore,
    scoreOverridden
  });

  if (outcome.review === undefined) {
    return correction;
  }

  return {
    ...correction,
    score: finalScore,
    review: outcome.review
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

      const stageEmit = (stage: AttemptEvaluationStage) => emit({
        type: "status",
        value: stage,
        questionId: correction.questionId,
        questionIndex,
        questionTotal: total
      });

      return reviewCorrection(artifact, attempt.id, correction, answer.answer, stageEmit);
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
