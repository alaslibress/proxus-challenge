import type { ArtifactKind, TestQuestion } from "@proxus/shared";

export const QUESTION_TYPE_LABEL = {
  "multiple-choice": "Multiple choice",
  "true-false": "True / False",
  "short-answer": "Short answer"
} as const satisfies Record<TestQuestion["type"], string>;

export const ARTIFACT_KIND_LABEL = {
  note: "Note",
  quiz: "Quiz",
  test: "Test"
} as const satisfies Record<ArtifactKind, string>;
