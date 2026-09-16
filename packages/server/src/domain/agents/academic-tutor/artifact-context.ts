import type {
  Artifact,
  ArtifactAttempt,
  GradedTestAttempt,
  QuestionCorrection,
  TestQuestion
} from "@proxus/shared";

const TRUNCATE_LENGTH = 600;

const truncate = (text: string): string =>
  text.length > TRUNCATE_LENGTH ? `${text.slice(0, TRUNCATE_LENGTH)}…` : text;

const questionTypeLabel = (type: TestQuestion["type"]): string => {
  if (type === "multiple-choice") return "Multiple choice";
  if (type === "true-false") return "True / False";
  return "Short answer";
};

const formatQuestion = (
  index: number,
  question: TestQuestion,
  correction: QuestionCorrection | undefined,
  attempt: GradedTestAttempt | undefined
): string => {
  const lines: string[] = [];
  lines.push(`${index + 1}. [${questionTypeLabel(question.type)}] ${truncate(question.prompt)}`);

  if (question.type === "multiple-choice") {
    for (const option of question.options) {
      const marker = option.id === question.correctOptionId ? "✓" : " ";
      lines.push(`   [${marker}] ${truncate(option.text)}`);
    }
    lines.push(`   Explanation: ${truncate(question.explanation)}`);
  } else if (question.type === "true-false") {
    lines.push(`   Correct answer: ${question.correctAnswer}`);
    lines.push(`   Explanation: ${truncate(question.explanation)}`);
  } else {
    lines.push(`   Expected answer: ${truncate(question.expectedAnswer)}`);
  }

  if (attempt !== undefined && correction !== undefined) {
    const answer = attempt.answers.find((a) => a.questionId === question.id);
    if (answer !== undefined) {
      if (answer.questionType === "short-answer") {
        lines.push(`   Student's answer: ${truncate(answer.answer)}`);
      } else if (answer.questionType === "multiple-choice") {
        lines.push(`   Student selected: ${answer.selectedOptionId}`);
      } else if (answer.questionType === "true-false") {
        lines.push(`   Student answered: ${answer.answer}`);
      }
    }

    if (correction.questionType === "short-answer") {
      lines.push(`   Score: ${correction.score}/${correction.maxScore}`);
      if (correction.review !== undefined) {
        lines.push(`   Feedback: ${truncate(correction.review.feedback)}`);
        if (correction.review.grounded && correction.review.citas_pdf.some((c) => c.verified)) {
          const verified = correction.review.citas_pdf.filter((c) => c.verified);
          lines.push(`   Verified citations: ${verified.length}`);
        }
      }
    } else if (correction.questionType === "multiple-choice" || correction.questionType === "true-false") {
      lines.push(`   Correct: ${correction.correct}`);
    }
  }

  return lines.join("\n");
};

export const buildOpenExerciseContext = (
  artifact: Artifact | undefined,
  attempt: ArtifactAttempt | undefined
): string => {
  if (artifact === undefined) {
    return "No exercise is open on the student's screen.";
  }

  const kindLabel = artifact.kind === "note" ? "Note" : artifact.kind === "quiz" ? "Quiz" : "Test";
  const header = `${kindLabel}: "${artifact.title}" (id: ${artifact.id})`;

  if (artifact.kind === "note") {
    return `${header}\n\n${truncate(artifact.markdown)}`;
  }

  const questions = artifact.questions;

  let gradedAttempt: GradedTestAttempt | undefined;
  let isUngraded = false;

  if (attempt !== undefined) {
    if (attempt.status === "graded" && (attempt.artifactKind === "test" || attempt.artifactKind === "quiz")) {
      if (attempt.artifactKind === "test") {
        gradedAttempt = attempt as GradedTestAttempt;
      }
    } else if (attempt.status === "ungraded") {
      isUngraded = true;
    }
  }

  const questionLines = questions.map((question, index) => {
    const correction = gradedAttempt?.corrections.find((c) => c.questionId === question.id);
    return formatQuestion(index, question, correction, gradedAttempt);
  });

  const body = questionLines.join("\n\n");

  if (gradedAttempt !== undefined) {
    return `${header}\nScore: ${gradedAttempt.score}/${gradedAttempt.maxScore} — ${truncate(gradedAttempt.summary)}\n\n${body}`;
  }

  if (isUngraded) {
    return `${header} (submitted, not yet graded)\n\n${body}`;
  }

  return `${header}\n\n${body}`;
};
