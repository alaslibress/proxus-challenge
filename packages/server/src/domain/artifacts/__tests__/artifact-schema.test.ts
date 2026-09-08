import { describe, it, expect } from "vitest";
import { Effect, Schema } from "effect";
import { CreateArtifactInput, ShortAnswerQuestion } from "@proxus/shared";

const decode = <A, I>(schema: Schema.Codec<A, I>, input: unknown) =>
  Effect.runSync(
    Schema.decodeUnknownEffect(schema)(input).pipe(
      Effect.map((value) => ({ ok: true as const, value })),
      Effect.catch((error) => Effect.succeed({ ok: false as const, error }))
    )
  );

describe("ShortAnswerQuestion.maxScore", () => {
  it("defaults to 1 when the key is absent", () => {
    const result = decode(ShortAnswerQuestion, {
      type: "short-answer",
      id: "q1",
      prompt: "¿Qué es una derivada?",
      expectedAnswer: "La tasa de cambio instantánea"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maxScore).toBe(1);
    }
  });

  it("keeps an explicit weight when provided", () => {
    const result = decode(ShortAnswerQuestion, {
      type: "short-answer",
      id: "q1",
      prompt: "¿Qué es una derivada?",
      expectedAnswer: "La tasa de cambio instantánea",
      maxScore: 3
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maxScore).toBe(3);
    }
  });
});

describe("CreateArtifactInput", () => {
  it("accepts a test with a short-answer question that omits maxScore", () => {
    const result = decode(CreateArtifactInput, {
      kind: "test",
      title: "Test de límites",
      questions: [
        {
          type: "short-answer",
          id: "q1",
          prompt: "Define límite",
          expectedAnswer: "Valor al que tiende una función"
        }
      ]
    });

    expect(result.ok).toBe(true);
  });

  it("still requires explanation on closed questions", () => {
    const result = decode(CreateArtifactInput, {
      kind: "quiz",
      title: "Quiz sin explicación",
      questions: [
        {
          type: "multiple-choice",
          id: "q1",
          prompt: "¿Cuál?",
          options: [
            { id: "a", text: "A" },
            { id: "b", text: "B" }
          ],
          correctOptionId: "a"
        }
      ]
    });

    expect(result.ok).toBe(false);
  });

  it("accepts every documented question type in a single test artifact", () => {
    const result = decode(CreateArtifactInput, {
      kind: "test",
      title: "Test mixto",
      source: { materialId: "apuntes", pages: [2] },
      questions: [
        {
          type: "multiple-choice",
          id: "q1",
          prompt: "¿Cuál es cualitativo?",
          options: [
            { id: "cualitativo", text: "Cualitativo" },
            { id: "cuantitativo", text: "Cuantitativo" }
          ],
          correctOptionId: "cualitativo",
          explanation: "Los datos cualitativos describen cualidades.",
          sourcePage: 2
        },
        {
          type: "true-false",
          id: "q2",
          prompt: "2+2=4",
          correctAnswer: true,
          explanation: "Aritmética básica."
        },
        {
          type: "short-answer",
          id: "q3",
          prompt: "Define derivada",
          expectedAnswer: "Tasa de cambio instantánea",
          maxScore: 2
        }
      ]
    });

    expect(result.ok).toBe(true);
  });
});
