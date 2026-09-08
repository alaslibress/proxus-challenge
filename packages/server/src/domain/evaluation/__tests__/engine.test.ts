import { describe, it, expect } from "vitest";
import { Data, Effect, Layer } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import { EvaluationEngineService, EvaluationEngineServiceLive, type EvaluationInput } from "../engine.ts";

class FakeModelError extends Data.TaggedError("FakeModelError")<{ readonly reason: string }> {}

// A fake LanguageModel avoids depending on real Gemini credentials: text/object
// generation is entirely under the test's control here, mirroring the fake PdfService
// pattern used in file-material-repository.test.ts.
const textResponse = (text: string) => ({
  content: [{ type: "text" as const, text }],
  text
});

const makeFakeLanguageModel = (options: {
  readonly goodText?: string;
  readonly badText?: string;
  readonly failGood?: boolean;
  readonly failBad?: boolean;
  readonly judgeValue?: { readonly is_correct: boolean; readonly feedback: string; readonly citas_pdf: readonly string[] };
  readonly failJudge?: boolean;
  readonly onGenerateText?: (systemPrompt: string) => void;
}) =>
  Layer.succeed(LanguageModel.LanguageModel)({
    generateText: ((params: { readonly prompt: readonly { readonly role: string; readonly content: string }[] }) => {
      const systemPrompt = params.prompt[0]?.content ?? "";
      options.onGenerateText?.(systemPrompt);
      const isGood = systemPrompt.includes("Profe Bueno");
      if (isGood && options.failGood === true) {
        return Effect.fail(new FakeModelError({ reason: "good teacher failed" }));
      }
      if (!isGood && options.failBad === true) {
        return Effect.fail(new FakeModelError({ reason: "bad teacher failed" }));
      }
      const text = isGood ? options.goodText ?? "buena respuesta" : options.badText ?? "mala respuesta";
      return Effect.succeed(textResponse(text));
    }) as unknown as LanguageModel.Service["generateText"],
    generateObject: (() => {
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
    streamText: (() => Effect.die("not used")) as unknown as LanguageModel.Service["streamText"]
  });

const baseInput: EvaluationInput = {
  questionPrompt: "¿Qué es la fotosíntesis?",
  expectedAnswer: "El proceso por el cual las plantas convierten luz en energía.",
  studentAnswer: "Las plantas usan la luz para producir energía.",
  materialId: "mat-1",
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

    expect(result.is_correct).toBe(true);
    expect(result.feedback).toBe("Consolidado.");
    expect(result.citas_pdf).toHaveLength(1);
    expect(result.citas_pdf[0]?.verified).toBe(true);
    expect(result.citas_pdf[0]?.page).toBe(1);
    expect(result.citas_pdf[0]?.materialId).toBe("mat-1");
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

    expect(result.citas_pdf[0]?.verified).toBe(false);
    expect(result.citas_pdf[0]?.page).toBe(0);
  });

  it("continues to the judge when only one profe fails (mode: result tolerates partial panel failure)", async () => {
    const seenSystemPrompts: string[] = [];
    const model = makeFakeLanguageModel({
      failGood: true,
      judgeValue: { is_correct: false, feedback: "Falta precisión.", citas_pdf: [] },
      onGenerateText: (systemPrompt) => seenSystemPrompts.push(systemPrompt)
    });

    const result = await Effect.runPromise(runEvaluate(baseInput, model));

    // Both teachers were attempted (good failed, bad succeeded) and the judge still ran.
    expect(seenSystemPrompts.some((prompt) => prompt.includes("Profe Bueno"))).toBe(true);
    expect(seenSystemPrompts.some((prompt) => prompt.includes("Profe Malo"))).toBe(true);
    expect(result.is_correct).toBe(false);
    expect(result.feedback).toBe("Falta precisión.");
  });

  it("continues to the judge when both profes fail — the judge is told neither critique is available", async () => {
    const model = makeFakeLanguageModel({
      failGood: true,
      failBad: true,
      judgeValue: { is_correct: false, feedback: "Sin apoyo de los profes.", citas_pdf: [] }
    });

    const result = await Effect.runPromise(runEvaluate(baseInput, model));

    expect(result.is_correct).toBe(false);
    expect(result.feedback).toBe("Sin apoyo de los profes.");
  });

  it("fails with EvaluationUnavailable when the judge itself fails", async () => {
    const model = makeFakeLanguageModel({ failJudge: true });

    const error = await Effect.runPromise(runEvaluate(baseInput, model).pipe(Effect.flip));

    expect(error._tag).toBe("EvaluationUnavailable");
    expect((error as { readonly stage: string }).stage).toBe("judge");
  });

  it("returns an empty citas_pdf array unchanged when the judge cites nothing", async () => {
    const model = makeFakeLanguageModel({
      judgeValue: { is_correct: true, feedback: "Correcto sin citas.", citas_pdf: [] }
    });

    const result = await Effect.runPromise(runEvaluate(baseInput, model));

    expect(result.citas_pdf).toEqual([]);
  });
});
