import { describe, it, expect } from "vitest";
import { QUESTION_TYPE_LABEL, ARTIFACT_KIND_LABEL } from "../labels.ts";

describe("QUESTION_TYPE_LABEL", () => {
  it("has a label for every question type", () => {
    expect(QUESTION_TYPE_LABEL["multiple-choice"]).toBeDefined();
    expect(QUESTION_TYPE_LABEL["true-false"]).toBeDefined();
    expect(QUESTION_TYPE_LABEL["short-answer"]).toBeDefined();
  });

  it("no label contains a hyphen (guard against raw identifier leaking into UI)", () => {
    for (const label of Object.values(QUESTION_TYPE_LABEL)) {
      expect(label).not.toContain("-");
    }
  });
});

describe("ARTIFACT_KIND_LABEL", () => {
  it("has a label for every artifact kind", () => {
    expect(ARTIFACT_KIND_LABEL.note).toBeDefined();
    expect(ARTIFACT_KIND_LABEL.quiz).toBeDefined();
    expect(ARTIFACT_KIND_LABEL.test).toBeDefined();
  });

  it("no label contains a hyphen", () => {
    for (const label of Object.values(ARTIFACT_KIND_LABEL)) {
      expect(label).not.toContain("-");
    }
  });
});
