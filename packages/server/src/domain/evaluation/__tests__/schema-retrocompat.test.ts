import { describe, it, expect } from "vitest";
import { Schema } from "effect";
import { ShortAnswerCorrection } from "@proxus/shared";

describe("ShortAnswerCorrection schema retrocompatibility", () => {
  it("decodes a stored correction without panel/goodTeacher/badTeacher (legacy payload)", () => {
    const legacy = {
      questionType: "short-answer",
      questionId: "q1",
      score: 5,
      maxScore: 10,
      feedback: "Respuesta parcial."
    };

    expect(() => Schema.decodeUnknownSync(ShortAnswerCorrection)(legacy)).not.toThrow();
  });

  it("legacy correction has no panel field (undefined), not a decode error", () => {
    const legacy = {
      questionType: "short-answer",
      questionId: "q1",
      score: 5,
      maxScore: 10,
      feedback: "Respuesta parcial."
    };

    const decoded = Schema.decodeUnknownSync(ShortAnswerCorrection)(legacy);
    expect(decoded.panel).toBeUndefined();
  });

  it("legacy review without goodTeacher/badTeacher decodes and grounded defaults to true", () => {
    const legacyWithReview = {
      questionType: "short-answer",
      questionId: "q1",
      score: 10,
      maxScore: 10,
      feedback: "Correcta.",
      review: {
        is_correct: true,
        feedback: "Bien argumentado.",
        citas_pdf: [],
        grounded: true
      }
    };

    const decoded = Schema.decodeUnknownSync(ShortAnswerCorrection)(legacyWithReview);
    expect(decoded.review?.grounded).toBe(true);
    expect((decoded.review as { goodTeacher?: unknown }).goodTeacher).toBeUndefined();
    expect((decoded.review as { badTeacher?: unknown }).badTeacher).toBeUndefined();
  });
});
