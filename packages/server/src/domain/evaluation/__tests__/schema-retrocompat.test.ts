import { describe, it, expect } from "vitest";
import { Schema } from "effect";
import { PanelAgentOutcome, ShortAnswerCorrection } from "@proxus/shared";

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

  it("decodes a PanelAgentOutcome without `thought` in both variants (attempts stored before PR-17)", () => {
    const legacyOk = { status: "ok", text: "Buen enfoque." };
    const legacyFailed = { status: "failed", reason: "Timeout after 30s" };

    expect(() => Schema.decodeUnknownSync(PanelAgentOutcome)(legacyOk)).not.toThrow();
    expect(() => Schema.decodeUnknownSync(PanelAgentOutcome)(legacyFailed)).not.toThrow();

    // Ausente, no vacío: la clave ni siquiera existe tras decodificar.
    expect("thought" in Schema.decodeUnknownSync(PanelAgentOutcome)(legacyOk)).toBe(false);
    expect("thought" in Schema.decodeUnknownSync(PanelAgentOutcome)(legacyFailed)).toBe(false);
  });
});
