import { describe, it, expect } from "vitest";
import type {
  GradedTestAttempt,
  QuizArtifact,
  ShortAnswerCorrection,
  ShortAnswerQuestion,
  TestArtifact,
  UngradedTestAttempt
} from "@proxus/shared";
import { buildOpenExerciseContext } from "../artifact-context.ts";

const shortAnswerQuestion: ShortAnswerQuestion = {
  type: "short-answer",
  id: "q1",
  prompt: "What is photosynthesis?",
  expectedAnswer: "The process by which plants convert sunlight into energy.",
  maxScore: 10
};

const testArtifact: TestArtifact = {
  kind: "test",
  id: "artifact-1",
  title: "Biology Test",
  questions: [shortAnswerQuestion]
};

const correction: ShortAnswerCorrection = {
  questionType: "short-answer",
  questionId: "q1",
  score: 8,
  maxScore: 10,
  feedback: "Good answer.",
  review: {
    is_correct: true,
    feedback: "Conceptually correct.",
    citas_pdf: [],
    grounded: false
  }
};

const gradedAttempt: GradedTestAttempt = {
  artifactKind: "test",
  status: "graded",
  id: "attempt-1",
  artifactId: "artifact-1",
  answers: [{ questionType: "short-answer", questionId: "q1", answer: "Plants use sunlight to make energy." }],
  score: 8,
  maxScore: 10,
  summary: "8/10 — Good job.",
  corrections: [correction]
};

describe("buildOpenExerciseContext", () => {
  it("returns 'no exercise' when artifact is undefined", () => {
    expect(buildOpenExerciseContext(undefined, undefined)).toBe(
      "No exercise is open on the student's screen."
    );
  });

  it("includes artifact kind, title and id in header", () => {
    const result = buildOpenExerciseContext(testArtifact, undefined);
    expect(result).toContain('Test: "Biology Test" (id: artifact-1)');
  });

  it("shows expected answer and question prompt for a short-answer question (no attempt)", () => {
    const result = buildOpenExerciseContext(testArtifact, undefined);
    expect(result).toContain("What is photosynthesis?");
    expect(result).toContain("The process by which plants convert sunlight into energy.");
  });

  it("includes score and student answer when graded", () => {
    const result = buildOpenExerciseContext(testArtifact, gradedAttempt);
    expect(result).toContain("8/10");
    expect(result).toContain("Plants use sunlight to make energy.");
    expect(result).toContain("Score: 8/10");
  });

  it("includes feedback from the judge when present", () => {
    const result = buildOpenExerciseContext(testArtifact, gradedAttempt);
    expect(result).toContain("Conceptually correct.");
  });

  it("shows ungraded note when attempt is ungraded", () => {
    const ungraded: UngradedTestAttempt = {
      artifactKind: "test",
      status: "ungraded",
      id: "attempt-2",
      artifactId: "artifact-1",
      answers: [{ questionType: "short-answer", questionId: "q1", answer: "Some answer." }]
    };
    const result = buildOpenExerciseContext(testArtifact, ungraded);
    expect(result).toContain("not yet graded");
  });

  it("truncates fields longer than 600 characters", () => {
    const longPrompt = "x".repeat(700);
    const artifact: TestArtifact = {
      ...testArtifact,
      questions: [{ ...shortAnswerQuestion, prompt: longPrompt }]
    };
    const result = buildOpenExerciseContext(artifact, undefined);
    expect(result).toContain("…");
    expect(result).not.toContain("x".repeat(700));
  });

  it("quiz artifact lists question type as 'Multiple choice' or 'True / False'", () => {
    const quiz: QuizArtifact = {
      kind: "quiz",
      id: "quiz-1",
      title: "Quick Quiz",
      questions: [
        {
          type: "multiple-choice",
          id: "mc1",
          prompt: "Which is a planet?",
          options: [
            { id: "a", text: "Mars" },
            { id: "b", text: "Sun" }
          ],
          correctOptionId: "a",
          explanation: "Mars is a planet."
        }
      ]
    };
    const result = buildOpenExerciseContext(quiz, undefined);
    expect(result).toContain("Multiple choice");
    expect(result).toContain("Mars");
  });
});
