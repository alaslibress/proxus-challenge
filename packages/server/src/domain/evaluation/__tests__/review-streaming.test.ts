import { describe, it, expect } from "vitest";
import { Effect, Layer, Stream } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import type {
  Artifact,
  ArtifactAttempt,
  AttemptStreamEvent,
  GradedTestAttempt,
  MultipleChoiceCorrection,
  MultipleChoiceQuestion,
  ShortAnswerCorrection,
  ShortAnswerQuestion,
  TestArtifact
} from "@proxus/shared";
import { MaterialRepository, MaterialRepositoryError, type PageText } from "../../materials/material.ts";
import { EvaluationEngineService } from "../engine.ts";
import { EvaluationUnavailable } from "../errors.ts";
import { EvaluationTrace, type EvaluationTraceEntry } from "../trace.ts";
import { reviewGradedAttemptStreaming } from "../review.ts";

// Los fakes están COPIADOS de review.test.ts a propósito: ese fichero no exporta nada y
// el plan de PR-08 prohíbe abrirlo o extraerlos a un helper compartido. Son fixtures de
// test: la duplicación sale más barata que arrastrar un fichero verde a un refactor.

const recordedTraces: EvaluationTraceEntry[] = [];

const fakeTrace = Layer.succeed(EvaluationTrace)({
  record: (entry) => {
    recordedTraces.push(entry);
    return Effect.void;
  }
});

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

// A diferencia del de review.test.ts, este fake SÍ propaga `emit`: sin eso no habría
// frames `status` que comprobar.
const makeFakeEngine = (
  behavior:
    | { readonly kind: "fail" }
    | {
        readonly kind: "succeed";
        readonly is_correct: boolean;
        readonly quote: string;
      }
) =>
  Layer.succeed(EvaluationEngineService)({
    evaluate: (input, emit) =>
      Effect.gen(function* () {
        if (emit !== undefined) {
          yield* emit("evaluating_good");
          yield* emit("evaluating_bad");
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
          goodTeacher: { ok: true as const, text: "bien" },
          badTeacher: { ok: true as const, text: "mal" },
          durationMs: 1
        };

        if (behavior.kind === "fail") {
          return yield* new EvaluationUnavailable({
            reason: "panel unavailable",
            stage: "judge",
            trace: {
              ...traceBase,
              judge: { failed: "panel unavailable" },
              citations: []
            }
          });
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

        return {
          feedback: {
            is_correct: behavior.is_correct,
            feedback: "Feedback consolidado del panel.",
            citas_pdf
          },
          trace: {
            ...traceBase,
            judge: {
              is_correct: behavior.is_correct,
              feedback: "Feedback consolidado del panel.",
              citas_pdf: [behavior.quote]
            },
            citations: citas_pdf
          }
        };
      }) as unknown as ReturnType<EvaluationEngineService["evaluate"]>
  });

const noLanguageModelNeeded = Layer.succeed(LanguageModel.LanguageModel)({
  generateText: (() => Effect.die("not used")) as unknown as LanguageModel.Service["generateText"],
  generateObject: (() => Effect.die("not used")) as unknown as LanguageModel.Service["generateObject"],
  streamText: (() => Effect.die("not used")) as unknown as LanguageModel.Service["streamText"]
});

const PAGE_TEXT = "La fotosíntesis convierte luz solar en energía química de forma continua.";
const VERIFIED_QUOTE = "convierte luz solar en energía química";

const shortAnswer = (id: string): ShortAnswerQuestion => ({
  type: "short-answer",
  id,
  prompt: "¿Qué es la fotosíntesis?",
  expectedAnswer: "El proceso por el cual las plantas producen energía a partir de la luz.",
  maxScore: 10,
  sourcePage: 1
});

const multipleChoice: MultipleChoiceQuestion = {
  type: "multiple-choice",
  id: "mc1",
  prompt: "¿Dónde ocurre la fotosíntesis?",
  options: [
    { id: "a", text: "En el cloroplasto" },
    { id: "b", text: "En el núcleo" }
  ],
  correctOptionId: "a",
  explanation: "Ocurre en el cloroplasto."
};

const multipleChoiceCorrection: MultipleChoiceCorrection = {
  questionType: "multiple-choice",
  questionId: "mc1",
  correct: true,
  selectedOptionId: "a",
  correctOptionId: "a",
  explanation: "Ocurre en el cloroplasto."
};

const shortAnswerCorrection = (id: string): ShortAnswerCorrection => ({
  questionType: "short-answer",
  questionId: id,
  score: 3,
  maxScore: 10,
  feedback: "Respuesta incompleta (corrección determinista)."
});

const testArtifact: TestArtifact = {
  kind: "test",
  id: "artifact-1",
  title: "Test de biología",
  questions: [multipleChoice, shortAnswer("q1"), shortAnswer("q2")],
  source: { materialId: "mat-1", pages: [1] }
};

const gradedAttempt: GradedTestAttempt = {
  artifactKind: "test",
  status: "graded",
  id: "attempt-1",
  artifactId: "artifact-1",
  answers: [
    { questionType: "multiple-choice", questionId: "mc1", selectedOptionId: "a" },
    { questionType: "short-answer", questionId: "q1", answer: "Las plantas usan la luz para producir energía." },
    { questionType: "short-answer", questionId: "q2", answer: "La luz se transforma en energía química." }
  ],
  score: 6,
  maxScore: 30,
  summary: "6/30",
  corrections: [multipleChoiceCorrection, shortAnswerCorrection("q1"), shortAnswerCorrection("q2")]
};

const collect = (
  artifact: Artifact,
  attempt: ArtifactAttempt,
  layers: Layer.Layer<EvaluationEngineService | MaterialRepository | LanguageModel.LanguageModel | EvaluationTrace>
): Promise<AttemptStreamEvent[]> =>
  Effect.runPromise(
    reviewGradedAttemptStreaming(artifact, attempt).pipe(
      Stream.runCollect,
      Effect.map((chunk) => Array.from(chunk) as AttemptStreamEvent[]),
      Effect.provide(layers)
    )
  );

const succeedingLayers = Layer.mergeAll(
  fakeTrace,
  makeFakeEngine({ kind: "succeed", is_correct: true, quote: VERIFIED_QUOTE }),
  makeFakeMaterialRepository({ pages: [{ page: 1, text: PAGE_TEXT }] }),
  noLanguageModelNeeded
);

describe("reviewGradedAttemptStreaming", () => {
  it("always ends with exactly one terminal 'done' frame", async () => {
    const events = await collect(testArtifact, gradedAttempt, succeedingLayers);

    expect(events.at(-1)?.type).toBe("done");
    expect(events.filter((event) => event.type === "done")).toHaveLength(1);
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("emits a terminal 'done' even when the panel fails for every question", async () => {
    const events = await collect(
      testArtifact,
      gradedAttempt,
      Layer.mergeAll(
        fakeTrace,
        makeFakeEngine({ kind: "fail" }),
        makeFakeMaterialRepository({ pages: [{ page: 1, text: PAGE_TEXT }] }),
        noLanguageModelNeeded
      )
    );

    expect(events.at(-1)?.type).toBe("done");
    expect(events.filter((event) => event.type === "done")).toHaveLength(1);
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("counts only short-answer questions in questionTotal, not every correction", async () => {
    const events = await collect(testArtifact, gradedAttempt, succeedingLayers);
    const statuses = events.filter((event) => event.type === "status");

    // Tres correcciones (una multiple-choice + dos short-answer) → questionTotal 2.
    expect(statuses.length).toBeGreaterThan(0);
    expect(new Set(statuses.map((status) => status.questionTotal))).toEqual(new Set([2]));
    expect(new Set(statuses.map((status) => status.questionId))).toEqual(new Set(["q1", "q2"]));
    expect(new Set(statuses.map((status) => status.questionIndex))).toEqual(new Set([0, 1]));
    // La multiple-choice nunca genera un status.
    expect(statuses.some((status) => status.questionId === "mc1")).toBe(false);
  });

  it("emits the three stages for each evaluated question", async () => {
    const events = await collect(testArtifact, gradedAttempt, succeedingLayers);
    const stagesFor = (questionId: string) =>
      events
        .filter((event) => event.type === "status" && event.questionId === questionId)
        .map((event) => (event as Extract<AttemptStreamEvent, { type: "status" }>).value);

    expect(stagesFor("q1")).toEqual(["evaluating_good", "evaluating_bad", "deliberating"]);
    expect(stagesFor("q2")).toEqual(["evaluating_good", "evaluating_bad", "deliberating"]);
  });

  it("emits only the 'done' with the untouched attempt when it is still ungraded", async () => {
    const ungraded: ArtifactAttempt = {
      artifactKind: "test",
      status: "ungraded",
      id: "attempt-2",
      artifactId: "artifact-1",
      answers: gradedAttempt.answers
    };

    const events = await collect(testArtifact, ungraded, succeedingLayers);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "done", payload: ungraded });
  });

  it("emits only the 'done' when the artifactKind is not 'test'", async () => {
    const quizAttempt: ArtifactAttempt = {
      artifactKind: "quiz",
      status: "graded",
      id: "attempt-3",
      artifactId: "artifact-1",
      answers: [{ questionType: "multiple-choice", questionId: "mc1", selectedOptionId: "a" }],
      score: 1,
      maxScore: 1,
      summary: "1/1",
      corrections: [multipleChoiceCorrection]
    };

    const events = await collect(testArtifact, quizAttempt, succeedingLayers);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "done", payload: quizAttempt });
  });

  it("ships the REVIEWED corrections in the 'done', not the incoming ones", async () => {
    const events = await collect(testArtifact, gradedAttempt, succeedingLayers);
    const done = events.at(-1) as Extract<AttemptStreamEvent, { type: "done" }>;
    const payload = done.payload as GradedTestAttempt;

    const reviewed = payload.corrections.filter(
      (correction): correction is ShortAnswerCorrection => correction.questionType === "short-answer"
    );

    expect(reviewed).toHaveLength(2);
    for (const correction of reviewed) {
      expect(correction.score).toBe(10);
      expect(correction.review?.citas_pdf[0]?.verified).toBe(true);
    }
    // La multiple-choice viaja intacta y en su sitio.
    expect(payload.corrections[0]).toEqual(multipleChoiceCorrection);
    // El intento de entrada no se ha mutado.
    expect(gradedAttempt.corrections[1]).toEqual(shortAnswerCorrection("q1"));
  });
});
