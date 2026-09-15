import { describe, it, expect } from "vitest";
import { Data, Effect, Layer, Stream } from "effect";
import { AiError, LanguageModel, Response } from "effect/unstable/ai";
import { EvaluationEngineService, EvaluationEngineServiceLive, type EvaluationInput, type EvaluationProgressEvent } from "../engine.ts";

class FakeModelError extends Data.TaggedError("FakeModelError")<{ readonly reason: string }> {}

// A fake LanguageModel avoids depending on real Gemini credentials: text/object
// generation is entirely under the test's control here, mirroring the fake PdfService
// pattern used in file-material-repository.test.ts.
const teacherStream = (text: string): Stream.Stream<Response.StreamPartEncoded> =>
  Stream.make(
    { type: "text-start" as const, id: "text" } as Response.StreamPartEncoded,
    { type: "text-delta" as const, id: "text", delta: text } as Response.StreamPartEncoded,
    { type: "text-end" as const, id: "text" } as Response.StreamPartEncoded
  );

const makeFakeLanguageModel = (options: {
  readonly goodText?: string;
  readonly badText?: string;
  readonly failGood?: boolean;
  readonly failBad?: boolean;
  readonly judgeValue?: { readonly is_correct: boolean; readonly feedback: string; readonly citas_pdf: readonly string[] };
  readonly failJudge?: boolean;
  /** El Juez devolvió texto que no decodifica contra FinalFeedbackSchema (PR-08). */
  readonly failJudgeWithMalformedJson?: boolean;
  readonly onStreamText?: (systemPrompt: string) => void;
}) =>
  Layer.succeed(LanguageModel.LanguageModel)({
    generateText: (() => Effect.die("teachers now use streamText")) as unknown as LanguageModel.Service["generateText"],
    generateObject: (() => {
      if (options.failJudgeWithMalformedJson === true) {
        // Es exactamente lo que produce generateObject cuando el modelo devuelve JSON que
        // no cumple el schema: Schema.fromJsonString falla y sale un StructuredOutputError.
        return Effect.fail(
          new AiError.StructuredOutputError({
            description: "Expected a valid FinalFeedback object",
            responseText: '{"is_correct": true, "feedback":'
          })
        );
      }
      if (options.failJudge === true) {
        return Effect.fail(new FakeModelError({ reason: "judge failed" }));
      }
      const value = options.judgeValue ?? { is_correct: true, feedback: "bien", citas_pdf: [] };
      return Effect.succeed({
        content: [],
        text: "",
        value
      });
    }) as unknown as LanguageModel.Service["generateObject"],
    streamText: ((params: { readonly prompt: readonly { readonly role: string; readonly content: string }[] }) => {
      const systemPrompt = params.prompt[0]?.content ?? "";
      options.onStreamText?.(systemPrompt);
      const isGood = systemPrompt.includes("Good Teacher");
      if (isGood && options.failGood === true) {
        return Stream.fail(new FakeModelError({ reason: "good teacher failed" }));
      }
      if (!isGood && options.failBad === true) {
        return Stream.fail(new FakeModelError({ reason: "bad teacher failed" }));
      }
      const text = isGood ? options.goodText ?? "buena respuesta" : options.badText ?? "mala respuesta";
      return teacherStream(text);
    }) as unknown as LanguageModel.Service["streamText"]
  });

const baseInput: EvaluationInput = {
  questionId: "q1",
  questionPrompt: "¿Qué es la fotosíntesis?",
  expectedAnswer: "El proceso por el cual las plantas convierten luz en energía.",
  studentAnswer: "Las plantas usan la luz para producir energía.",
  mode: "grounded",
  materialId: "mat-1",
  pages: [1],
  evidence: [{ page: 1, text: "La fotosíntesis es el proceso por el cual las plantas convierten luz solar en energía química." }]
};

const runEvaluate = (input: EvaluationInput, languageModel: Layer.Layer<LanguageModel.LanguageModel>) =>
  Effect.gen(function* () {
    const engine = yield* EvaluationEngineService;
    return yield* engine.evaluate(input);
  }).pipe(
    Effect.provide(Layer.mergeAll(EvaluationEngineServiceLive, languageModel))
  );

describe("EvaluationEngineService.evaluate", () => {
  it("runs both profes and has the judge verify citations against the evidence", async () => {
    const model = makeFakeLanguageModel({
      judgeValue: {
        is_correct: true,
        feedback: "Consolidado.",
        citas_pdf: ["las plantas convierten luz solar en energía química"]
      }
    });

    const result = await Effect.runPromise(runEvaluate(baseInput, model));

    expect(result.feedback.is_correct).toBe(true);
    expect(result.feedback.feedback).toBe("Consolidado.");
    expect(result.feedback.citas_pdf).toHaveLength(1);
    expect(result.feedback.citas_pdf[0]?.verified).toBe(true);
    expect(result.feedback.citas_pdf[0]?.page).toBe(1);
    expect(result.feedback.citas_pdf[0]?.materialId).toBe("mat-1");
  });

  it("marks an invented/unverifiable citation as not verified", async () => {
    const model = makeFakeLanguageModel({
      judgeValue: {
        is_correct: true,
        feedback: "Consolidado.",
        citas_pdf: ["esta frase no existe en el texto original de la página"]
      }
    });

    const result = await Effect.runPromise(runEvaluate(baseInput, model));

    expect(result.feedback.citas_pdf[0]?.verified).toBe(false);
    expect(result.feedback.citas_pdf[0]?.page).toBe(0);
  });

  it("continues to the judge when only one profe fails (mode: result tolerates partial panel failure)", async () => {
    const seenSystemPrompts: string[] = [];
    const model = makeFakeLanguageModel({
      failGood: true,
      judgeValue: { is_correct: false, feedback: "Falta precisión.", citas_pdf: [] },
      onStreamText: (systemPrompt) => seenSystemPrompts.push(systemPrompt)
    });

    const result = await Effect.runPromise(runEvaluate(baseInput, model));

    // Both teachers were attempted (good failed, bad succeeded) and the judge still ran.
    expect(seenSystemPrompts.some((prompt) => prompt.includes("Good Teacher"))).toBe(true);
    expect(seenSystemPrompts.some((prompt) => prompt.includes("Bad Teacher"))).toBe(true);
    expect(result.feedback.is_correct).toBe(false);
    expect(result.feedback.feedback).toBe("Falta precisión.");
  });

  it("continues to the judge when both profes fail — the judge is told neither critique is available", async () => {
    const model = makeFakeLanguageModel({
      failGood: true,
      failBad: true,
      judgeValue: { is_correct: false, feedback: "Sin apoyo de los profes.", citas_pdf: [] }
    });

    const result = await Effect.runPromise(runEvaluate(baseInput, model));

    expect(result.feedback.is_correct).toBe(false);
    expect(result.feedback.feedback).toBe("Sin apoyo de los profes.");
  });

  it("fails with EvaluationUnavailable when the judge itself fails", async () => {
    const model = makeFakeLanguageModel({ failJudge: true });

    const error = await Effect.runPromise(runEvaluate(baseInput, model).pipe(Effect.flip));

    expect(error._tag).toBe("EvaluationUnavailable");
    expect((error as { readonly stage: string }).stage).toBe("judge");
  });

  it("rejects malformed JSON from the judge as EvaluationUnavailable, without taking the server down", async () => {
    const model = makeFakeLanguageModel({ failJudgeWithMalformedJson: true });

    const error = await Effect.runPromise(runEvaluate(baseInput, model).pipe(Effect.flip));

    expect(error._tag).toBe("EvaluationUnavailable");
    expect((error as { readonly stage: string }).stage).toBe("judge");
    // La traza conserva a los dos profes y deja constancia del fallo del Juez.
    const trace = (error as {
      readonly trace: {
        readonly judge: { readonly failed?: string };
        readonly citations: readonly unknown[];
      };
    }).trace;
    expect(trace.judge.failed).toContain("StructuredOutputError");
    expect(trace.citations).toEqual([]);
  });

  it("returns an empty citas_pdf array unchanged when the judge cites nothing", async () => {
    const model = makeFakeLanguageModel({
      judgeValue: { is_correct: true, feedback: "Correcto sin citas.", citas_pdf: [] }
    });

    const result = await Effect.runPromise(runEvaluate(baseInput, model));

    expect(result.feedback.citas_pdf).toEqual([]);
  });

  it("streaming: text deltas arrive at emit with correct agent and in order, accumulated text equals concatenation", async () => {
    const receivedEvents: EvaluationProgressEvent[] = [];
    const model = makeFakeLanguageModel({
      goodText: "good-delta",
      badText: "bad-delta"
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* EvaluationEngineService;
        return yield* engine.evaluate(baseInput, (event) => Effect.sync(() => { receivedEvents.push(event); }));
      }).pipe(Effect.provide(EvaluationEngineServiceLive), Effect.provide(model))
    );

    const textDeltas = receivedEvents.filter(
      (e): e is Extract<EvaluationProgressEvent, { _tag: "reasoning" }> => e._tag === "reasoning" && e.channel === "text"
    );
    const goodDeltas = textDeltas.filter((e) => e.agent === "good_teacher");
    const badDeltas = textDeltas.filter((e) => e.agent === "bad_teacher");

    expect(goodDeltas.map((e) => e.delta).join("")).toBe("good-delta");
    expect(badDeltas.map((e) => e.delta).join("")).toBe("bad-delta");
  });

  it("streaming: a teacher whose stream emits no text is treated as failed (fallback to No disponible)", async () => {
    // A stream with no text-delta parts should fail runTeacher
    const model = Layer.succeed(LanguageModel.LanguageModel)({
      generateText: (() => Effect.die("not used")) as unknown as LanguageModel.Service["generateText"],
      generateObject: (() => {
        const value = { is_correct: true, feedback: "judge ok", citas_pdf: [] };
        return Effect.succeed({ content: [], text: "", value });
      }) as unknown as LanguageModel.Service["generateObject"],
      streamText: (() => Stream.empty) as unknown as LanguageModel.Service["streamText"]
    });

    const result = await Effect.runPromise(runEvaluate(baseInput, model));

    // Judge still runs (mode: result tolerates teacher failure), result has a trace
    expect(result.trace.goodTeacher.status).toBe("failed");
    expect(result.trace.badTeacher.status).toBe("failed");
  });

  it("in ungrounded mode: does not call verifyCitations, returns citas_pdf: [] and grounded: false", async () => {
    const model = makeFakeLanguageModel({
      judgeValue: {
        is_correct: true,
        feedback: "Conceptually correct.",
        citas_pdf: ["this quote should be ignored"]
      }
    });

    const ungroundedInput: EvaluationInput = {
      ...baseInput,
      mode: "ungrounded",
      materialId: undefined,
      pages: [],
      evidence: []
    };

    const result = await Effect.runPromise(runEvaluate(ungroundedInput, model));

    expect(result.feedback.grounded).toBe(false);
    expect(result.feedback.citas_pdf).toEqual([]);
    expect(result.feedback.is_correct).toBe(true);
  });

  it("with both teachers OK, feedback includes goodTeacher and badTeacher with status ok", async () => {
    const model = makeFakeLanguageModel({
      goodText: "Well supported.",
      badText: "Missing nuance.",
      judgeValue: { is_correct: true, feedback: "Correct.", citas_pdf: [] }
    });

    const result = await Effect.runPromise(runEvaluate(baseInput, model));

    const goodT = result.feedback.goodTeacher;
    const badT = result.feedback.badTeacher;
    expect(goodT?.status).toBe("ok");
    expect(goodT?.status === "ok" ? goodT.text : undefined).toBe("Well supported.");
    expect(badT?.status).toBe("ok");
    expect(badT?.status === "ok" ? badT.text : undefined).toBe("Missing nuance.");
  });

  it("with bad teacher failing, badTeacher has status failed and judge still runs", async () => {
    const model = makeFakeLanguageModel({
      failBad: true,
      goodText: "solid argument",
      judgeValue: { is_correct: true, feedback: "judge ok", citas_pdf: [] }
    });

    const result = await Effect.runPromise(runEvaluate(baseInput, model));

    expect(result.feedback.goodTeacher?.status).toBe("ok");
    expect(result.feedback.badTeacher?.status).toBe("failed");
    expect(result.feedback.is_correct).toBe(true);
  });
});
