import { useEffect, useRef } from "react";
import type { AttemptEvaluationStage } from "@proxus/shared";
import type { EvaluationRunState, PanelTranscript } from "../../domain/artifacts/evaluation-atoms.ts";
import { transcriptFor } from "../../domain/artifacts/transcripts.ts";

const STAGE_LABEL: Record<AttemptEvaluationStage, string> = {
  evaluating_good: "Good Teacher analysing…",
  evaluating_bad: "Bad Teacher challenging…",
  deliberating: "Judge deliberating and checking the PDF…"
};

const STAGE_ORDER: readonly AttemptEvaluationStage[] = ["evaluating_good", "evaluating_bad", "deliberating"];

const AGENT_LABEL: Record<"good_teacher" | "bad_teacher", string> = {
  good_teacher: "Good Teacher reasoning",
  bad_teacher: "Bad Teacher reasoning"
};

function TranscriptPanel({
  agent,
  transcript
}: {
  readonly agent: "good_teacher" | "bad_teacher";
  readonly transcript: PanelTranscript;
}) {
  const { thought, text } = transcript[agent];
  const containerRef = useRef<HTMLDivElement>(null);
  // El usuario que sube a leer manda: dejamos de forzar el fondo hasta que vuelve a él.
  const stickToBottomRef = useRef<boolean>(true);

  const onScroll = () => {
    const el = containerRef.current;
    if (el === null) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  useEffect(() => {
    const el = containerRef.current;
    if (el !== null && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [thought, text]);

  if (thought.length === 0 && text.length === 0) return null;

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      aria-live="off"
      aria-label={AGENT_LABEL[agent]}
      className="border border-line bg-surface-muted"
      style={{
        borderRadius: 10,
        padding: "8px 12px",
        maxHeight: 180,
        overflowY: "auto",
        whiteSpace: "pre-wrap",
        fontSize: 12.5
      }}
    >
      {thought.length > 0 && (
        <p className="text-ink-faint" style={{ fontStyle: "italic", marginBottom: 4 }}>
          Thinking… {thought}
        </p>
      )}
      {text.length > 0 && (
        <p className="text-ink-soft">{text}</p>
      )}
    </div>
  );
}

export function EvaluationProgress({
  run,
  onCancel
}: {
  readonly run: Extract<EvaluationRunState, { readonly phase: "running" }>;
  readonly onCancel: () => void;
}) {
  const currentTranscript = transcriptFor(run.transcripts, run.questionId);
  const questionIds = Object.keys(run.transcripts);
  const previousQuestionIds = questionIds.filter((id) => id !== run.questionId);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-mute" style={{ fontSize: 13 }}>
          {run.questionTotal > 0
            ? `Question ${run.questionIndex + 1} of ${run.questionTotal}`
            : "Grading…"}
        </p>
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
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      <ul aria-live="polite" aria-busy={true} className="mt-3 grid gap-2">
        {STAGE_ORDER.map((stage) => {
          const active = run.activeStages.includes(stage);
          const isTeacher = stage === "evaluating_good" || stage === "evaluating_bad";
          const agent = stage === "evaluating_good" ? "good_teacher" : "bad_teacher";
          return (
            <li key={stage} className="grid gap-1">
              <div
                className="flex items-center gap-2 text-ink-mute"
                style={{ fontSize: 13, opacity: active ? 1 : 0.5 }}
              >
                <span aria-hidden="true" className={active ? "animate-pulse" : undefined}>
                  {active ? "◐" : "○"}
                </span>
                {STAGE_LABEL[stage]}
              </div>
              {isTeacher && (
                <TranscriptPanel agent={agent} transcript={currentTranscript} />
              )}
            </li>
          );
        })}
      </ul>
      {questionIds.length > 1 && (
        <details className="mt-3">
          <summary className="text-ink-mute" style={{ cursor: "pointer", fontSize: 12.5 }}>
            Previous questions
          </summary>
          <div className="mt-2 grid gap-3">
            {previousQuestionIds.map((questionId) => (
              <div key={questionId} className="grid gap-1">
                <h4 className="text-ink-mute" style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>
                  Question {questionIds.indexOf(questionId) + 1}
                </h4>
                <TranscriptPanel
                  agent="good_teacher"
                  transcript={transcriptFor(run.transcripts, questionId)}
                />
                <TranscriptPanel
                  agent="bad_teacher"
                  transcript={transcriptFor(run.transcripts, questionId)}
                />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
