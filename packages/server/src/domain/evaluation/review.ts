import { Effect } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import type {
  Artifact,
  ArtifactAttempt,
  QuestionCorrection,
  ShortAnswerCorrection,
  TestQuestion
} from "@proxus/shared";
import type { PageText } from "../materials/material.ts";
import { MaterialRepository } from "../materials/material.ts";
import { EvaluationEngineService } from "./engine.ts";

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

const reviewCorrection = (
  artifact: Artifact,
  correction: ShortAnswerCorrection,
  studentAnswer: string
): Effect.Effect<
  ShortAnswerCorrection,
  never,
  EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel
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

  const materialRepository = yield* MaterialRepository;

  const pageTexts: readonly PageText[] | undefined = yield* materialRepository
    .extractText(materialId, pages)
    .pipe(
      Effect.map((result) => result.pages),
      Effect.orElseSucceed(() => undefined)
    );

  if (pageTexts === undefined) {
    return correction;
  }

  const nonEmptyPages = pageTexts.filter((page) => page.text.trim().length > 0);
  if (nonEmptyPages.length === 0) {
    return correction;
  }

  const engine = yield* EvaluationEngineService;

  const review = yield* engine.evaluate({
    questionPrompt: question.prompt,
    expectedAnswer: question.expectedAnswer,
    studentAnswer,
    materialId,
    evidence: nonEmptyPages
  }).pipe(
    Effect.match({
      onFailure: () => undefined,
      onSuccess: (value) => value
    })
  );

  if (review === undefined) {
    return correction;
  }

  const hasVerifiedCitation = review.citas_pdf.some((citation) => citation.verified);
  const score = hasVerifiedCitation && review.is_correct ? question.maxScore : correction.score;

  return {
    ...correction,
    score,
    review
  };
});

export const reviewGradedAttempt = (
  artifact: Artifact,
  attempt: ArtifactAttempt
): Effect.Effect<
  ArtifactAttempt,
  never,
  EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel
> => Effect.gen(function* () {
  if (attempt.status !== "graded" || attempt.artifactKind !== "test") {
    return attempt;
  }

  const reviewOne = (
    correction: QuestionCorrection
  ): Effect.Effect<QuestionCorrection, never, EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel> => {
    if (correction.questionType !== "short-answer") {
      return Effect.succeed(correction);
    }

    const answer = attempt.answers.find(
      (candidate) => candidate.questionId === correction.questionId
    );

    return answer !== undefined && answer.questionType === "short-answer"
      ? reviewCorrection(artifact, correction, answer.answer)
      : Effect.succeed(correction);
  };

  const corrections: QuestionCorrection[] = yield* Effect.forEach(attempt.corrections, reviewOne);

  return {
    ...attempt,
    corrections
  };
});
