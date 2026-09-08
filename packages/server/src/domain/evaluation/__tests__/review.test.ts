import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import type {
  Artifact,
  ArtifactAttempt,
  GradedTestAttempt,
  ShortAnswerCorrection,
  ShortAnswerQuestion,
  TestArtifact
} from "@proxus/shared";
import { MaterialRepository, MaterialRepositoryError, type PageText } from "../../materials/material.ts";
import { EvaluationEngineService } from "../engine.ts";
import { EvaluationUnavailable } from "../errors.ts";
import { reviewGradedAttempt } from "../review.ts";

// Fake MaterialRepository: only extractText is exercised by review.ts, and unit tests
// should not depend on real PDFs/Poppler, matching file-material-repository.test.ts.
const makeFakeMaterialRepository = (options: {
  readonly pages?: readonly PageText[];
  readonly fail?: boolean;
}) =>
  Layer.succeed(MaterialRepository)({
    list: () => Effect.die("not used"),
    upload: () => Effect.die("not used"),
    get: () => Effect.die("not used"),
    delete: () => Effect.die("not used"),
    renderPages: () => Effect.die("not used"),
    extractText: () =>
      options.fail === true
        ? Effect.fail(new MaterialRepositoryError({ reason: "boom" }))
        : Effect.succeed({
            type: "material-page-texts" as const,
            material: {
              id: "mat-1",
              title: "Material",
              fileName: "material.pdf",
              pageCount: 1,
              uploadedAt: new Date().toISOString()
            },
            pages: options.pages ?? [{ page: 1, text: "La fotosíntesis convierte luz solar en energía química." }]
          })
  } as unknown as MaterialRepository);

// Fake EvaluationEngineService: lets each test control whether the panel "succeeds"
// (returning a review with a real/invented citation) or fails outright.
const makeFakeEngine = (
  behavior:
    | { readonly kind: "fail" }
    | {
        readonly kind: "succeed";
        readonly is_correct: boolean;
        readonly quote: string;
        readonly evidenceText: string;
      }
) =>
  Layer.succeed(EvaluationEngineService)({
    evaluate: (input) => {
      if (behavior.kind === "fail") {
        return Effect.fail(
          new EvaluationUnavailable({ reason: "panel unavailable", stage: "judge" })
        ) as unknown as ReturnType<EvaluationEngineService["evaluate"]>;
      }
      const verified = input.evidence.some((page) => page.text.includes(behavior.quote));
      return Effect.succeed({
        is_correct: behavior.is_correct,
        feedback: "Feedback consolidado del panel.",
        citas_pdf: [
          {
            materialId: input.materialId,
            page: verified ? input.evidence[0]?.page ?? 0 : 0,
            quote: behavior.quote,
            verified
          }
        ]
      }) as unknown as ReturnType<EvaluationEngineService["evaluate"]>;
    }
  });

const noLanguageModelNeeded = Layer.succeed(LanguageModel.LanguageModel)({
  generateText: (() => Effect.die("not used")) as unknown as LanguageModel.Service["generateText"],
  generateObject: (() => Effect.die("not used")) as unknown as LanguageModel.Service["generateObject"],
  streamText: (() => Effect.die("not used")) as unknown as LanguageModel.Service["streamText"]
});

const shortAnswerQuestion: ShortAnswerQuestion = {
  type: "short-answer",
  id: "q1",
  prompt: "¿Qué es la fotosíntesis?",
  expectedAnswer: "El proceso por el cual las plantas producen energía a partir de la luz.",
  maxScore: 10,
  sourcePage: 1
};

const testArtifact: TestArtifact = {
  kind: "test",
  id: "artifact-1",
  title: "Test de biología",
  questions: [shortAnswerQuestion],
  source: { materialId: "mat-1", pages: [1] }
};

const baseCorrection: ShortAnswerCorrection = {
  questionType: "short-answer",
  questionId: "q1",
  score: 3,
  maxScore: 10,
  feedback: "Respuesta incompleta (corrección determinista)."
};

const gradedAttempt: GradedTestAttempt = {
  artifactKind: "test",
  status: "graded",
  id: "attempt-1",
  artifactId: "artifact-1",
  answers: [{ questionType: "short-answer", questionId: "q1", answer: "Las plantas usan la luz para producir energía." }],
  score: 3,
  maxScore: 10,
  summary: "3/10",
  corrections: [baseCorrection]
};

const run = (
  artifact: Artifact,
  attempt: ArtifactAttempt,
  layers: Layer.Layer<EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel>
) => Effect.runPromise(reviewGradedAttempt(artifact, attempt).pipe(Effect.provide(layers)));

describe("reviewGradedAttempt", () => {
  it("never fails even if the evaluation panel fails — returns the attempt unmodified", async () => {
    const layers = Layer.mergeAll(
      makeFakeEngine({ kind: "fail" }),
      makeFakeMaterialRepository({}),
      noLanguageModelNeeded
    );

    const result = await run(testArtifact, gradedAttempt, layers);

    expect(result).toEqual(gradedAttempt);
  });

  it("raises the grade when the judge's citation is a verified literal quote from the extracted text", async () => {
    const pageText = "La fotosíntesis convierte luz solar en energía química de forma continua.";
    const layers = Layer.mergeAll(
      makeFakeEngine({
        kind: "succeed",
        is_correct: true,
        quote: "convierte luz solar en energía química",
        evidenceText: pageText
      }),
      makeFakeMaterialRepository({ pages: [{ page: 1, text: pageText }] }),
      noLanguageModelNeeded
    );

    const result = (await run(testArtifact, gradedAttempt, layers)) as GradedTestAttempt;
    const correction = result.corrections[0] as ShortAnswerCorrection;

    expect(correction.score).toBe(shortAnswerQuestion.maxScore);
    expect(correction.review?.citas_pdf[0]?.verified).toBe(true);
  });

  it("does NOT raise the grade when the citation is invented/unverifiable against the real text", async () => {
    const pageText = "La fotosíntesis convierte luz solar en energía química de forma continua.";
    const layers = Layer.mergeAll(
      makeFakeEngine({
        kind: "succeed",
        is_correct: true,
        quote: "esta frase jamás aparece en el texto original",
        evidenceText: pageText
      }),
      makeFakeMaterialRepository({ pages: [{ page: 1, text: pageText }] }),
      noLanguageModelNeeded
    );

    const result = (await run(testArtifact, gradedAttempt, layers)) as GradedTestAttempt;
    const correction = result.corrections[0] as ShortAnswerCorrection;

    // Grade stays at the deterministic value; only the (unverified) review is attached.
    expect(correction.score).toBe(baseCorrection.score);
    expect(correction.feedback).toBe(baseCorrection.feedback);
    expect(correction.review?.citas_pdf[0]?.verified).toBe(false);
  });

  it("does NOT raise the grade when the panel says is_correct but the citation is unverified", async () => {
    const pageText = "Texto de la página sin relación con la cita inventada.";
    const layers = Layer.mergeAll(
      makeFakeEngine({
        kind: "succeed",
        is_correct: true,
        quote: "cita completamente inventada por el juez",
        evidenceText: pageText
      }),
      makeFakeMaterialRepository({ pages: [{ page: 1, text: pageText }] }),
      noLanguageModelNeeded
    );

    const result = (await run(testArtifact, gradedAttempt, layers)) as GradedTestAttempt;
    const correction = result.corrections[0] as ShortAnswerCorrection;

    expect(correction.score).toBe(baseCorrection.score);
  });

  it("passes through unchanged when the attempt is still ungraded", async () => {
    const ungraded: ArtifactAttempt = {
      artifactKind: "test",
      status: "ungraded",
      id: "attempt-2",
      artifactId: "artifact-1",
      answers: gradedAttempt.answers
    };
    const layers = Layer.mergeAll(
      makeFakeEngine({ kind: "fail" }),
      makeFakeMaterialRepository({}),
      noLanguageModelNeeded
    );

    const result = await run(testArtifact, ungraded, layers);

    expect(result).toEqual(ungraded);
  });

  it("passes through unchanged when the artifact has no source (no materialId to fetch text from)", async () => {
    const artifactWithoutSource: TestArtifact = { ...testArtifact, source: undefined };
    const layers = Layer.mergeAll(
      makeFakeEngine({
        kind: "succeed",
        is_correct: true,
        quote: "no importa",
        evidenceText: "no importa"
      }),
      makeFakeMaterialRepository({}),
      noLanguageModelNeeded
    );

    const result = (await run(artifactWithoutSource, gradedAttempt, layers)) as GradedTestAttempt;

    expect(result.corrections[0]).toEqual(baseCorrection);
  });

  it("passes through unchanged when extractText fails for the material", async () => {
    const layers = Layer.mergeAll(
      makeFakeEngine({
        kind: "succeed",
        is_correct: true,
        quote: "no importa",
        evidenceText: "no importa"
      }),
      makeFakeMaterialRepository({ fail: true }),
      noLanguageModelNeeded
    );

    const result = (await run(testArtifact, gradedAttempt, layers)) as GradedTestAttempt;

    expect(result.corrections[0]).toEqual(baseCorrection);
  });

  it("passes through unchanged when the extracted page text is blank (no extractable text layer)", async () => {
    const layers = Layer.mergeAll(
      makeFakeEngine({
        kind: "succeed",
        is_correct: true,
        quote: "no importa",
        evidenceText: ""
      }),
      makeFakeMaterialRepository({ pages: [{ page: 1, text: "" }] }),
      noLanguageModelNeeded
    );

    const result = (await run(testArtifact, gradedAttempt, layers)) as GradedTestAttempt;

    expect(result.corrections[0]).toEqual(baseCorrection);
  });
});
