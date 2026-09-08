import type { PdfCitation, ShortAnswerCorrection } from "@proxus/shared";
import { Streamdown } from "streamdown";

export function ShortAnswerDetails({ correction }: { readonly correction: ShortAnswerCorrection }) {
  if (correction.review === undefined) {
    return <p className="text-ink-soft">{correction.feedback}</p>;
  }

  const { review } = correction;
  const hasVerifiedCitation = review.citas_pdf.some((citation) => citation.verified);

  return (
    <div>
      <div className="prose prose-invert max-w-none">
        <Streamdown>{review.feedback}</Streamdown>
      </div>
      {!hasVerifiedCitation && (
        <p className="mt-3 text-ink-mute" style={{ fontSize: 12.5, fontStyle: "italic" }}>
          Evaluación orientativa: no se pudo verificar ninguna cita, la nota es la automática.
        </p>
      )}
      {review.citas_pdf.length > 0 && (
        <CitationList citations={review.citas_pdf} />
      )}
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
              ? `✅ Verificada · ${citation.materialId} · pág. ${citation.page}`
              : "⚠️ Sin verificar en el PDF"}
          </p>
          <p className="mt-1 text-ink-soft" style={{ fontSize: 13, fontStyle: "italic" }}>
            "{citation.quote}"
          </p>
        </li>
      ))}
    </ul>
  );
}
