import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function Modal({ open, title, onClose, children }: ModalProps) {
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement;
    } else {
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
      triggerRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    // Capture phase: intercept Escape before ArtifactWorkspace bubble handler sees it.
    // Without stopPropagation here, one Escape would close both the modal and the workspace.
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem"
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(20, 16, 42, 0.45)"
        }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog box */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          background: "var(--color-surface)",
          border: "1px solid var(--color-line-strong)",
          borderRadius: 12,
          maxWidth: 720,
          width: "100%",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "1rem 1.25rem",
            borderBottom: "1px solid var(--color-line)"
          }}
        >
          <h2
            id={titleId.current}
            style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--color-ink)" }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-ink-mute)",
              fontSize: 18,
              lineHeight: 1,
              padding: "0.25rem"
            }}
          >
            ×
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: "1.25rem", flex: 1 }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
