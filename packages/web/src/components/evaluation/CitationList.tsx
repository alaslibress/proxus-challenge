import { useState } from "react";
import type { PdfCitation, ShortAnswerCorrection } from "@proxus/shared";
import { Markdown } from "../Markdown.tsx";
import { describePanelStatus } from "../../domain/artifacts/panel-status.ts";
import { PanelDebateModal } from "./PanelDebateModal.tsx";

function PanelIndicator({ correction }: { readonly correction: ShortAnswerCorrection }) {
  const display = describePanelStatus(correction.panel);
  if (display === undefined) return null;

  return (
    <p style={{ fontSize: 12, color: "var(--color-ink-mute)", marginBottom: "0.5rem" }}>
      <span style={{ fontWeight: 500 }}>{display.label}</span>
      {" — "}<span style={{ fontStyle: "italic" }}>{display.detail}</span>
    </p>
  );
}

export function ShortAnswerDetails({ correction }: { readonly correction: ShortAnswerCorrection }) {
  const [debateOpen, setDebateOpen] = useState(false);

  const hasTeacherText =
    correction.review?.goodTeacher?.status === "ok" ||
    correction.review?.badTeacher?.status === "ok";

  if (correction.review === undefined) {
    return (
      <div>
        <PanelIndicator correction={correction} />
        <p className="text-ink-soft">{correction.feedback}</p>
        <PanelDebateModal
          correction={correction}
          open={debateOpen}
          onClose={() => setDebateOpen(false)}
        />
      </div>
    );
  }

  const { review } = correction;

  const hasVerifiedCitation = review.citas_pdf.some((citation) => citation.verified);

  return (
    <div>
      <PanelIndicator correction={correction} />
      <div className="prose prose-invert max-w-none">
        <Markdown>{review.feedback}</Markdown>
      </div>
      {review.grounded === false && (
        <p className="mt-3 text-ink-mute" style={{ fontSize: 12.5, fontStyle: "italic" }}>
          Graded without PDF evidence: the panel judged your answer against the expected answer.
        </p>
      )}
      {review.grounded !== false && !hasVerifiedCitation && (
        <p className="mt-3 text-ink-mute" style={{ fontSize: 12.5, fontStyle: "italic" }}>
          Advisory evaluation: no citation could be verified, so the automatic mark stands.
        </p>
      )}
      {review.citas_pdf.length > 0 && (
        <CitationList citations={review.citas_pdf} />
      )}
      {hasTeacherText && (
        <button
          onClick={() => setDebateOpen(true)}
          style={{
            marginTop: "0.75rem",
            background: "none",
            border: "1px solid var(--color-line-strong)",
            borderRadius: 6,
            padding: "0.3rem 0.75rem",
            fontSize: 12.5,
            color: "var(--color-ink-soft)",
            cursor: "pointer"
          }}
        >
          See the panel debate
        </button>
      )}
      <PanelDebateModal
        correction={correction}
        open={debateOpen}
        onClose={() => setDebateOpen(false)}
      />
    </div>
  );
}

export function CitationList({ citations }: { readonly citations: readonly PdfCitation[] }) {
  return (
    <ul className="mt-3 grid gap-2">
      {citations.map((citation, index) => (
        <li
          key={index}
          className={
            citation.verified
              ? "border border-good-line bg-good-tint"
              : "border border-warn-line bg-warn-tint"
          }
          style={{ borderRadius: 12, padding: 12 }}
        >
          <p
            className={citation.verified ? "text-good-ink" : "text-warn-ink"}
            style={{ fontSize: 12, fontWeight: 600 }}
          >
            {citation.verified
              ? `✅ Verified · ${citation.materialId} · p. ${citation.page}`
              : "⚠️ Not verified against the PDF"}
          </p>
          <p className="mt-1 text-ink-soft" style={{ fontSize: 13, fontStyle: "italic" }}>
            "{citation.quote}"
          </p>
        </li>
      ))}
    </ul>
  );
}
