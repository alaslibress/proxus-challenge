import type { ShortAnswerCorrection } from "@proxus/shared";
import { Modal } from "../ui/Modal.tsx";
import { Markdown } from "../Markdown.tsx";
import { CitationList } from "./CitationList.tsx";

function TeacherSection({
  title,
  outcome,
  accentStyle
}: {
  readonly title: string;
  readonly outcome: ShortAnswerCorrection["review"] extends undefined ? never : NonNullable<ShortAnswerCorrection["review"]>["goodTeacher"];
  readonly accentStyle: React.CSSProperties;
}) {
  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <h3
        style={{
          margin: "0 0 0.5rem",
          fontSize: 13,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          ...accentStyle
        }}
      >
        {title}
      </h3>
      {outcome !== undefined && outcome.thought !== undefined && (
        <details style={{ marginBottom: "0.5rem" }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--color-ink-mute)" }}>
            Reasoning
          </summary>
          <div
            className="border border-line bg-surface-muted"
            style={{ borderRadius: 8, padding: "8px 12px", marginTop: 6,
                     whiteSpace: "pre-wrap", fontSize: 12.5, maxHeight: 260, overflowY: "auto",
                     color: "var(--color-ink-faint)", fontStyle: "italic" }}
          >
            {outcome.thought}
          </div>
        </details>
      )}
      {outcome === undefined ? (
        <p style={{ color: "var(--color-ink-mute)", fontStyle: "italic", fontSize: 13 }}>
          Not recorded for this attempt.
        </p>
      ) : outcome.status === "ok" ? (
        <div className="prose prose-invert max-w-none">
          <Markdown>{outcome.text}</Markdown>
        </div>
      ) : (
        <p
          style={{
            color: "var(--color-warn-ink)",
            background: "var(--color-warn-tint)",
            border: "1px solid var(--color-warn-line)",
            borderRadius: 8,
            padding: "0.5rem 0.75rem",
            fontSize: 13
          }}
        >
          ⚠️ {outcome.reason}
        </p>
      )}
    </section>
  );
}

export function PanelDebateModal({
  correction,
  open,
  onClose
}: {
  readonly correction: ShortAnswerCorrection;
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const review = correction.review;

  return (
    <Modal open={open} title="Panel debate" onClose={onClose}>
      <TeacherSection
        title="Good Teacher"
        outcome={review?.goodTeacher}
        accentStyle={{ color: "var(--color-good-ink)" }}
      />

      <div
        style={{
          height: 1,
          background: "var(--color-line)",
          margin: "0 0 1.5rem"
        }}
      />

      <TeacherSection
        title="Bad Teacher"
        outcome={review?.badTeacher}
        accentStyle={{ color: "var(--color-warn-ink)" }}
      />

      <div
        style={{
          height: 1,
          background: "var(--color-line)",
          margin: "0 0 1.5rem"
        }}
      />

      <section style={{ marginBottom: review?.citas_pdf.length ? "1rem" : 0 }}>
        <h3
          style={{
            margin: "0 0 0.5rem",
            fontSize: 13,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--color-ink-soft)"
          }}
        >
          Judge
        </h3>
        {review !== undefined ? (
          <div className="prose prose-invert max-w-none">
            <Markdown>{review.feedback}</Markdown>
          </div>
        ) : (
          <p style={{ color: "var(--color-ink-mute)", fontStyle: "italic", fontSize: 13 }}>
            Not recorded for this attempt.
          </p>
        )}
      </section>

      {review !== undefined && review.citas_pdf.length > 0 && (
        <CitationList citations={review.citas_pdf} />
      )}
    </Modal>
  );
}
