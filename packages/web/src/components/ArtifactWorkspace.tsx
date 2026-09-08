import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type {
  Artifact,
  ArtifactAttempt,
  MultipleChoiceQuestion,
  QuestionCorrection,
  QuizQuestion,
  SubmitAttemptInput,
  TestQuestion
} from "@proxus/shared";
import { useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { artifactQuery, submitArtifactAttemptAction } from "../domain/artifacts/atoms.ts";

type Answers = Record<string, string>;

interface ArtifactWorkspaceProps {
  readonly artifactId: string | null;
  readonly onClose?: () => void;
}

export function ArtifactWorkspace({ artifactId, onClose }: ArtifactWorkspaceProps) {
  if (artifactId === null) {
    return <EmptyWorkspace />;
  }

  return onClose !== undefined
    ? <ArtifactDetail artifactId={artifactId} onClose={onClose} />
    : <ArtifactDetail artifactId={artifactId} />;
}

function EmptyWorkspace() {
  return (
    <main className="h-screen min-w-0 overflow-y-auto border-r border-line bg-canvas p-6 max-md:h-auto max-md:border-r-0 max-md:border-b">
      <div className="grid h-full place-items-center rounded-2xl border border-dashed border-line p-8 text-center">
        <div>
          <p
            className="mb-2 text-brand"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: ".14em",
              textTransform: "uppercase",
            }}
          >
            Practice workspace
          </p>
          <h2
            className="text-balance text-ink"
            style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: "32ch" }}
          >
            Select a note, quiz, or test from the sidebar.
          </h2>
          <p className="mt-3 text-ink-mute" style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: "32ch" }}>
            Quizzes and tests can be solved directly here. The tutor chat remains available for hints and explanations.
          </p>
        </div>
      </div>
    </main>
  );
}

function ArtifactDetail({ artifactId, onClose }: { readonly artifactId: string; readonly onClose?: () => void }) {
  const artifact = useAtomValue(artifactQuery(artifactId));

  useEffect(() => {
    if (onClose === undefined) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement;
      // Don't close while typing inside an input or textarea
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      onClose();
    };
    document.addEventListener("keydown", handler);
    return () => { document.removeEventListener("keydown", handler); };
  }, [onClose]);

  return (
    <main className="h-screen min-w-0 overflow-y-auto border-r border-line bg-canvas max-md:h-auto max-md:border-r-0 max-md:border-b">
      <div
        className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface-raised"
        style={{ padding: "10px 16px" }}
      >
        <span className="text-ink-faint" style={{ fontSize: 12, fontWeight: 500, letterSpacing: ".06em" }}>
          ARTIFACT
        </span>
        {onClose !== undefined && (
          <button
            type="button"
            aria-label="Close artifact"
            onClick={onClose}
            className="border border-line-strong text-ink-mute hover:bg-surface-muted"
            style={{
              borderRadius: 8,
              padding: "5px 14px",
              fontSize: 13,
              fontWeight: 500,
              transitionDuration: "120ms",
              transitionTimingFunction: "var(--ease-dc)"
            }}
          >
            Close
          </button>
        )}
      </div>
      <div style={{ padding: 24 }}>
        {AsyncResult.matchWithError(artifact, {
          onInitial: () => <p className="text-ink-mute" style={{ fontSize: 13 }}>Loading artifact…</p>,
          onError: (error) => <p className="text-danger" style={{ fontSize: 13 }}>{String(error)}</p>,
          onDefect: (defect) => <p className="text-danger" style={{ fontSize: 13 }}>{String(defect)}</p>,
          onSuccess: ({ value }) => <ArtifactContent artifact={value} />
        })}
      </div>
    </main>
  );
}

function ArtifactContent({ artifact }: { readonly artifact: Artifact }) {
  switch (artifact.kind) {
    case "note":
      return <NoteViewer artifact={artifact} />;
    case "quiz":
    case "test":
      return <ExerciseSolver artifact={artifact} />;
  }
}

function NoteViewer({ artifact }: { readonly artifact: Extract<Artifact, { readonly kind: "note" }> }) {
  return (
    <article
      className="mx-auto max-w-4xl bg-surface border border-line shadow-card"
      style={{ borderRadius: 16, padding: 18 }}
    >
      <p
        className="mb-2 text-ink-faint"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: ".14em",
          textTransform: "uppercase",
        }}
      >
        Note
      </p>
      <h2 className="mb-6 text-ink" style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em" }}>
        {artifact.title}
      </h2>
      <div className="prose prose-invert max-w-none">
        <Streamdown>{artifact.markdown}</Streamdown>
      </div>
    </article>
  );
}

function ExerciseSolver({ artifact }: { readonly artifact: Extract<Artifact, { readonly kind: "quiz" | "test" }> }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [attempt, setAttempt] = useState<ArtifactAttempt | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitAttempt = useAtomSet(submitArtifactAttemptAction, { mode: "promise" });

  const unansweredQuestions = useMemo(
    () => artifact.questions.filter((question) => (answers[question.id] ?? "").trim().length === 0),
    [answers, artifact.questions]
  );

  const setAnswer = (questionId: string, value: string) => {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  };

  const submit = async () => {
    if (unansweredQuestions.length > 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(undefined);

    try {
      const payload = buildSubmitInput(artifact, answers);
      const result = await submitAttempt(payload);
      setAttempt(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <article className="mx-auto max-w-4xl">
      <header className="mb-5 bg-surface border border-line shadow-card" style={{ borderRadius: 16, padding: 18 }}>
        <p
          className="mb-2 text-ink-faint"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: ".14em",
            textTransform: "uppercase",
          }}
        >
          {artifact.kind}
        </p>
        <h2 className="text-ink" style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em" }}>
          {artifact.title}
        </h2>
        <p className="mt-2 text-ink-mute" style={{ fontSize: 13 }}>
          Answer every question, submit, and review your corrections.
        </p>
      </header>

      <div className="grid gap-4">
        {artifact.questions.map((question, index) => (
          <QuestionCard
            key={question.id}
            index={index}
            question={question}
            value={answers[question.id] ?? ""}
            correction={attempt?.status === "graded" ? attempt.corrections.find((item) => item.questionId === question.id) : undefined}
            disabled={attempt !== null}
            onChange={(value) => setAnswer(question.id, value)}
          />
        ))}
      </div>

      {error !== undefined && (
        <p
          className="mt-4 border border-danger-line bg-danger-tint text-danger"
          style={{ borderRadius: 16, padding: 16, fontSize: 13 }}
        >
          {error}
        </p>
      )}

      {attempt?.status === "graded" && <AttemptSummary attempt={attempt} />}

      <footer
        className="sticky bottom-0 mt-6 border border-line bg-surface-raised backdrop-blur"
        style={{ borderRadius: 16, padding: 16 }}
      >
        {attempt === null
          ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-ink-mute" style={{ fontSize: 13 }}>
                  {unansweredQuestions.length === 0
                    ? "Ready to submit."
                    : `${unansweredQuestions.length} question${unansweredQuestions.length === 1 ? "" : "s"} unanswered.`}
                </p>
                <button
                  className="text-white bg-brand hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                  style={{
                    borderRadius: 8,
                    padding: "12px 20px",
                    fontSize: 14,
                    fontWeight: 600,
                    boxShadow: "var(--shadow-brand)",
                    transitionProperty: "background-color, box-shadow",
                    transitionDuration: "120ms",
                    transitionTimingFunction: "var(--ease-dc)",
                  }}
                  type="button"
                  disabled={unansweredQuestions.length > 0 || isSubmitting}
                  onClick={submit}
                >
                  {isSubmitting ? "Submitting…" : `Submit ${artifact.kind}`}
                </button>
              </div>
            )
          : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-semibold text-good" style={{ fontSize: 14 }}>Attempt graded.</p>
                <button
                  className="border border-line-strong bg-transparent text-ink-mute hover:bg-surface-muted"
                  style={{
                    borderRadius: 999,
                    padding: "8px 20px",
                    fontSize: 13,
                    transitionDuration: "120ms",
                    transitionTimingFunction: "var(--ease-dc)",
                  }}
                  type="button"
                  onClick={() => {
                    setAnswers({});
                    setAttempt(null);
                    setError(undefined);
                  }}
                >
                  Try again
                </button>
              </div>
            )}
      </footer>
    </article>
  );
}

function QuestionCard({
  index,
  question,
  value,
  correction,
  disabled,
  onChange
}: {
  readonly index: number;
  readonly question: QuizQuestion | TestQuestion;
  readonly value: string;
  readonly correction: QuestionCorrection | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <section className="bg-surface border border-line shadow-card" style={{ borderRadius: 16, padding: 20 }}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          {/* Badge de tipo de pregunta */}
          <span
            className="inline-flex items-center bg-cite-tint text-cite-ink border border-cite-line mb-3"
            style={{
              borderRadius: 7,
              padding: "6px 10px",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: ".1em",
            }}
          >
            {question.type}
          </span>
          <h3
            className="text-ink"
            style={{ fontSize: 19, fontWeight: 500, lineHeight: 1.45, maxWidth: "46ch", textWrap: "pretty" } as React.CSSProperties}
          >
            {index + 1}. {question.prompt}
          </h3>
        </div>
        {correction !== undefined && <CorrectionBadge correction={correction} />}
      </div>

      {question.type === "multiple-choice" && (
        <MultipleChoiceInput question={question} value={value} disabled={disabled} onChange={onChange} />
      )}
      {question.type === "true-false" && (
        <TrueFalseInput value={value} disabled={disabled} onChange={onChange} />
      )}
      {question.type === "short-answer" && (
        <textarea
          className="min-h-32 w-full bg-surface border border-line-strong text-ink outline-none disabled:opacity-70"
          style={{
            borderRadius: 14,
            padding: "14px 16px",
            fontSize: 14.5,
            lineHeight: 1.7,
            transitionProperty: "border-color, box-shadow",
            transitionDuration: "120ms",
            transitionTimingFunction: "var(--ease-dc)",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--color-focus-line)";
            e.currentTarget.style.boxShadow = "0 0 0 3px var(--color-focus-ring)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "";
            e.currentTarget.style.boxShadow = "";
          }}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="Write your answer…"
        />
      )}

      {correction !== undefined && <CorrectionDetails correction={correction} question={question} />}
    </section>
  );
}

function MultipleChoiceInput({
  question,
  value,
  disabled,
  onChange
}: {
  readonly question: MultipleChoiceQuestion;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      {question.options.map((option) => (
        <label
          className="flex cursor-pointer items-center gap-3 border border-line bg-surface-muted hover:bg-surface"
          style={{ borderRadius: 16, padding: 12, transitionDuration: "120ms", transitionTimingFunction: "var(--ease-dc)" }}
          key={option.id}
        >
          <input
            type="radio"
            name={question.id}
            value={option.id}
            checked={value === option.id}
            disabled={disabled}
            onChange={() => onChange(option.id)}
          />
          <span className="text-ink" style={{ fontSize: 13.5 }}>{option.text}</span>
        </label>
      ))}
    </div>
  );
}

function TrueFalseInput({
  value,
  disabled,
  onChange
}: {
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
      {([
        ["true", "True"],
        ["false", "False"]
      ] as const).map(([nextValue, label]) => (
        <label
          className="flex cursor-pointer items-center gap-3 border border-line bg-surface-muted hover:bg-surface"
          style={{ borderRadius: 16, padding: 12, transitionDuration: "120ms", transitionTimingFunction: "var(--ease-dc)" }}
          key={nextValue}
        >
          <input
            type="radio"
            name={`true-false-${label}`}
            value={nextValue}
            checked={value === nextValue}
            disabled={disabled}
            onChange={() => onChange(nextValue)}
          />
          <span className="text-ink" style={{ fontSize: 13.5 }}>{label}</span>
        </label>
      ))}
    </div>
  );
}

function AttemptSummary({ attempt }: { readonly attempt: Extract<ArtifactAttempt, { readonly status: "graded" }> }) {
  return (
    <section
      className="mt-6 border border-good-line bg-good-tint"
      style={{ borderRadius: 16, padding: 20 }}
    >
      <p className="font-bold text-good-ink" style={{ fontSize: 20 }}>
        Score: {attempt.score} / {attempt.maxScore}
      </p>
      <p className="mt-1 text-good" style={{ fontSize: 14 }}>{attempt.summary}</p>
    </section>
  );
}

function CorrectionBadge({ correction }: { readonly correction: QuestionCorrection }) {
  if (correction.questionType === "short-answer") {
    return (
      <span
        className="rounded-full bg-cite-tint text-cite-ink border border-cite-line"
        style={{ padding: "4px 12px", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}
      >
        {correction.score}/{correction.maxScore}
      </span>
    );
  }

  return correction.correct
    ? (
        <span
          className="rounded-full bg-good-tint text-good-ink border border-good-line"
          style={{ padding: "4px 12px", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}
        >
          Correct
        </span>
      )
    : (
        <span
          className="rounded-full bg-warn-tint text-warn-ink border border-warn-line"
          style={{ padding: "4px 12px", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}
        >
          Review
        </span>
      );
}

function CorrectionDetails({
  correction,
  question
}: {
  readonly correction: QuestionCorrection;
  readonly question: QuizQuestion | TestQuestion;
}) {
  return (
    <div className="mt-4 bg-surface border border-line" style={{ borderRadius: 16, padding: 16, fontSize: 13 }}>
      {correction.questionType === "multiple-choice" && question.type === "multiple-choice" && (
        <>
          <p className="text-ink-soft">Correct answer: <strong>{optionText(question, correction.correctOptionId)}</strong></p>
          <p className="mt-2 text-ink-mute">{correction.explanation}</p>
        </>
      )}
      {correction.questionType === "true-false" && (
        <>
          <p className="text-ink-soft">Correct answer: <strong>{correction.correctAnswer ? "True" : "False"}</strong></p>
          <p className="mt-2 text-ink-mute">{correction.explanation}</p>
        </>
      )}
      {correction.questionType === "short-answer" && (
        <p className="text-ink-soft">{correction.feedback}</p>
      )}
    </div>
  );
}

const optionText = (question: MultipleChoiceQuestion, optionId: string) =>
  question.options.find((option) => option.id === optionId)?.text ?? optionId;

function buildSubmitInput(
  artifact: Extract<Artifact, { readonly kind: "quiz" | "test" }>,
  answers: Answers
): SubmitAttemptInput {
  const builtAnswers = artifact.questions.map((question) => {
    const value = answers[question.id] ?? "";
    switch (question.type) {
      case "multiple-choice":
        return {
          questionType: "multiple-choice" as const,
          questionId: question.id,
          selectedOptionId: value
        };
      case "true-false":
        return {
          questionType: "true-false" as const,
          questionId: question.id,
          answer: value === "true"
        };
      case "short-answer":
        return {
          questionType: "short-answer" as const,
          questionId: question.id,
          answer: value
        };
    }
  });

  if (artifact.kind === "quiz") {
    return {
      artifactKind: "quiz",
      artifactId: artifact.id,
      answers: builtAnswers.filter((answer) => answer.questionType !== "short-answer")
    };
  }

  return {
    artifactKind: "test",
    artifactId: artifact.id,
    answers: builtAnswers
  };
}
