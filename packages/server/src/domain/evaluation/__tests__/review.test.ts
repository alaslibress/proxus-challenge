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
import { EvaluationTrace, type EvaluationTraceEntry } from "../trace.ts";
import { panelRaisesScore, reviewGradedAttempt } from "../review.ts";

const recordedTraces: EvaluationTraceEntry[] = [];

const fakeTrace = Layer.succeed(EvaluationTrace)({
  record: (entry) => {
    recordedTraces.push(entry);
    return Effect.void;
  }
});

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
    // Tercer modo (PR-08): el panel contesta sin citar nada. El modo "succeed" construye
    // siempre exactamente una cita, así que citas_pdf: [] es inalcanzable sin esto.
    | { readonly kind: "succeed-no-citations"; readonly is_correct: boolean }
) =>
  Layer.succeed(EvaluationEngineService)({
    evaluate: (input) => {
      const traceBase = {
        questionId: input.questionId,
        questionPrompt: input.questionPrompt,
        expectedAnswer: input.expectedAnswer,
        studentAnswer: input.studentAnswer,
        materialId: input.materialId,
        pages: input.pages,
        evidence: input.evidence,
        goodTeacher: { ok: true as const, text: "bien" },
        badTeacher: { ok: true as const, text: "mal" },
        durationMs: 1
      };

      if (behavior.kind === "fail") {
        return Effect.fail(
          new EvaluationUnavailable({
            reason: "panel unavailable",
            stage: "judge",
            trace: {
              ...traceBase,
              judge: { failed: "panel unavailable" },
              citations: []
            }
          })
        ) as unknown as ReturnType<EvaluationEngineService["evaluate"]>;
      }

      if (behavior.kind === "succeed-no-citations") {
        return Effect.succeed({
          feedback: {
            is_correct: behavior.is_correct,
            feedback: "Feedback consolidado del panel.",
            citas_pdf: []
          },
          trace: {
            ...traceBase,
            judge: { is_correct: behavior.is_correct, feedback: "Feedback consolidado del panel.", citas_pdf: [] },
            citations: []
          }
        }) as unknown as ReturnType<EvaluationEngineService["evaluate"]>;
      }

      const verified = input.evidence.some((page) => page.text.includes(behavior.quote));
      const citas_pdf = [
        {
          materialId: input.materialId,
          page: verified ? input.evidence[0]?.page ?? 0 : 0,
          quote: behavior.quote,
          verified
        }
      ];
      return Effect.succeed({
        feedback: {
          is_correct: behavior.is_correct,
          feedback: "Feedback consolidado del panel.",
          citas_pdf
        },
        trace: {
          ...traceBase,
          judge: { is_correct: behavior.is_correct, feedback: "Feedback consolidado del panel.", citas_pdf: [behavior.quote] },
          citations: citas_pdf
        }
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
  layers: Layer.Layer<EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel | EvaluationTrace>
) => Effect.runPromise(reviewGradedAttempt(artifact, attempt).pipe(Effect.provide(layers)));

describe("reviewGradedAttempt", () => {
  it("never fails even if the evaluation panel fails — returns the attempt unmodified", async () => {
    const layers = Layer.mergeAll(
      fakeTrace,
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
      fakeTrace,
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
      fakeTrace,
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
      fakeTrace,
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

  it("does NOT raise the grade when the panel says is_correct but cites nothing at all (citas_pdf: [])", async () => {
    const pageText = "La fotosíntesis convierte luz solar en energía química de forma continua.";
    const layers = Layer.mergeAll(
      fakeTrace,
      makeFakeEngine({ kind: "succeed-no-citations", is_correct: true }),
      makeFakeMaterialRepository({ pages: [{ page: 1, text: pageText }] }),
      noLanguageModelNeeded
    );

    const result = (await run(testArtifact, gradedAttempt, layers)) as GradedTestAttempt;
    const correction = result.corrections[0] as ShortAnswerCorrection;

    // Sin ninguna cita verificada la nota se queda en la determinista, aunque el Juez
    // diga que la respuesta es correcta (Tech Spec §5, exigencia nº2).
    expect(correction.score).toBe(baseCorrection.score);
    expect(correction.feedback).toBe(baseCorrection.feedback);
    expect(correction.review?.citas_pdf).toEqual([]);
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
      fakeTrace,
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
      fakeTrace,
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
      fakeTrace,
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
      fakeTrace,
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

// Regla compartida por el motor y por el script de demo `panel.check.ts`. Se prueba
// directamente porque el script es un ejecutable con argv y no se puede invocar aquí:
// si esta regla se relajara, la traza de la demo anunciaría subidas de nota que el
// motor nunca aplicaría.
describe("panelRaisesScore", () => {
  const citation = (verified: boolean) => ({
    materialId: "mat-1",
    page: verified ? 1 : 0,
    quote: "la fotosíntesis convierte luz solar",
    verified
  });

  it("raises the score only when the judge says correct AND a citation is verified", () => {
    expect(panelRaisesScore({
      is_correct: true,
      feedback: "Correcta.",
      citas_pdf: [citation(true)]
    })).toBe(true);
  });

  it("does NOT raise the score when the judge says correct but no citation is verified", () => {
    expect(panelRaisesScore({
      is_correct: true,
      feedback: "Correcta según el juez, pero la cita es inventada.",
      citas_pdf: [citation(false)]
    })).toBe(false);
  });

  it("does NOT raise the score when the judge says correct but cites nothing", () => {
    expect(panelRaisesScore({
      is_correct: true,
      feedback: "Correcta sin citas.",
      citas_pdf: []
    })).toBe(false);
  });

  it("does NOT raise the score when the judge says incorrect, even with a verified citation", () => {
    expect(panelRaisesScore({
      is_correct: false,
      feedback: "Incompleta.",
      citas_pdf: [citation(true)]
    })).toBe(false);
  });

  it("does NOT raise the score when the panel produced no review at all", () => {
    expect(panelRaisesScore(undefined)).toBe(false);
  });
});
