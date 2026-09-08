import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { artifactsQuery } from "../domain/artifacts/atoms.ts";
import { deleteMaterialAction, materialsQuery } from "../domain/materials/atoms.ts";
import { PdfUploader } from "./PdfUploader.tsx";
import type { PdfMaterial } from "@proxus/shared";

interface SidebarProps {
  readonly selectedArtifactId: string | null;
  readonly onSelectArtifact: (artifactId: string) => void;
}

const kindBadge: Record<string, { letter: string; className: string }> = {
  note: { letter: "N", className: "text-cite bg-cite-tint border-cite-line" },
  quiz: { letter: "Q", className: "text-brand bg-brand-tint-strong border-brand" },
  test: { letter: "T", className: "text-good bg-good-tint border-good-line" },
};

function Skeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-9 rounded-[10px] bg-surface-muted" style={{ animation: "pxPulse 1.6s ease-in-out infinite" }} />
      <div className="h-9 rounded-[10px] bg-surface-muted" style={{ animation: "pxPulse 1.6s ease-in-out 0.2s infinite" }} />
      <div className="h-9 rounded-[10px] bg-surface-muted" style={{ animation: "pxPulse 1.6s ease-in-out 0.4s infinite" }} />
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-ink-faint px-1.5"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        fontWeight: 500,
        letterSpacing: ".14em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </p>
  );
}

function MaterialRow({ material }: { readonly material: PdfMaterial }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rowRef = useRef<HTMLLIElement>(null);
  const deleteMaterial = useAtomSet(deleteMaterialAction, { mode: "promise" });

  const startConfirm = () => {
    setConfirming(true);
    timerRef.current = setTimeout(() => setConfirming(false), 5000);
  };

  const cancelConfirm = () => {
    setConfirming(false);
    clearTimeout(timerRef.current);
  };

  const handleDelete = async () => {
    clearTimeout(timerRef.current);
    setDeleting(true);
    setError(undefined);
    try {
      await deleteMaterial(material.id);
    } catch (cause) {
      setDeleting(false);
      setConfirming(false);
      setError(cause instanceof Error ? cause.message : "Could not delete material.");
    }
  };

  // Cancel confirmation when clicking outside the row
  useEffect(() => {
    if (!confirming) return;
    const handler = (event: MouseEvent) => {
      if (rowRef.current !== null && !rowRef.current.contains(event.target as Node)) {
        cancelConfirm();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => { document.removeEventListener("mousedown", handler); };
  }, [confirming]);

  // Cancel on Escape
  useEffect(() => {
    if (!confirming) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelConfirm();
    };
    document.addEventListener("keydown", handler);
    return () => { document.removeEventListener("keydown", handler); };
  }, [confirming]);

  // Cleanup timer on unmount
  useEffect(() => () => { clearTimeout(timerRef.current); }, []);

  return (
    <li
      ref={rowRef}
      className="flex flex-col gap-1"
    >
      <div
        className={`flex items-center gap-2.5 rounded-[10px] ${deleting ? "opacity-50" : ""}`}
        style={{ padding: "10px 8px", transition: "opacity 120ms" }}
      >
        {/* Badge PDF */}
        <div
          className="grid place-items-center rounded border border-line-strong bg-surface-muted text-ink-faint flex-shrink-0"
          style={{
            width: 22,
            height: 26,
            fontFamily: "var(--font-mono)",
            fontSize: 8,
            fontWeight: 500,
          }}
        >
          PDF
        </div>
        {/* Nombre */}
        <span
          className="flex-1 min-w-0 truncate text-ink-mute"
          style={{ fontSize: 13, fontWeight: 400 }}
        >
          {material.title}
        </span>
        {/* Meta */}
        <span
          className="text-ink-faint flex-shrink-0"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
        >
          {material.pageCount} p
        </span>
        {/* Botón borrar */}
        {confirming
          ? (
              <button
                type="button"
                aria-label={`Confirm delete ${material.title}`}
                disabled={deleting}
                onClick={handleDelete}
                className="flex-shrink-0 border border-danger-line bg-danger-tint text-danger-ink"
                style={{
                  borderRadius: 6,
                  padding: "3px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  minWidth: 24,
                  minHeight: 24,
                  cursor: deleting ? "not-allowed" : "pointer"
                }}
              >
                Confirm
              </button>
            )
          : (
              <button
                type="button"
                aria-label={`Delete ${material.title}`}
                disabled={deleting}
                onClick={startConfirm}
                className="flex-shrink-0 text-ink-faint hover:text-danger"
                style={{
                  borderRadius: 6,
                  padding: "3px 6px",
                  fontSize: 14,
                  fontWeight: 400,
                  minWidth: 24,
                  minHeight: 24,
                  cursor: deleting ? "not-allowed" : "pointer",
                  transitionDuration: "120ms",
                  transitionTimingFunction: "var(--ease-dc)"
                }}
              >
                ×
              </button>
            )}
      </div>
      {error !== undefined && (
        <p className="text-danger px-2" style={{ fontSize: 11 }}>{error}</p>
      )}
    </li>
  );
}

export function Sidebar({ selectedArtifactId, onSelectArtifact }: SidebarProps) {
  const materials = useAtomValue(materialsQuery);
  const artifacts = useAtomValue(artifactsQuery);
  const refreshMaterials = useAtomRefresh(materialsQuery);

  return (
    <aside
      className="h-screen overflow-y-auto border-r border-line bg-surface-raised flex flex-col gap-5"
      style={{ padding: "16px 12px" }}
    >
      {/* Bloque de marca */}
      <div className="flex items-center gap-3">
        <div
          className="grid place-items-center rounded-[10px] text-white font-bold shadow-brand-sm"
          style={{
            width: 34,
            height: 34,
            flexShrink: 0,
            fontSize: 18,
            background: "linear-gradient(145deg, #8B5CF2, #6B33DC)",
          }}
        >
          M
        </div>
        <div>
          <strong
            className="block text-ink"
            style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-.01em" }}
          >
            My Favorite Teacher
          </strong>
          <span className="block text-ink-faint" style={{ fontSize: 11.5, fontWeight: 400 }}>
            Academic assistant
          </span>
        </div>
      </div>

      {/* Sección de materiales */}
      <section className="flex flex-col gap-2">
        <Eyebrow>Materials</Eyebrow>
        {AsyncResult.matchWithError(materials, {
          onInitial: () => <Skeleton />,
          onError: (error) => (
            <p className="text-danger" style={{ fontSize: 13 }}>{String(error)}</p>
          ),
          onDefect: (defect) => (
            <p className="text-danger" style={{ fontSize: 13 }}>{String(defect)}</p>
          ),
          onSuccess: ({ value }) =>
            value.materials.length === 0
              ? (
                  <p className="text-ink-mute" style={{ fontSize: 13, padding: "0 6px" }}>
                    No uploaded PDFs yet.
                  </p>
                )
              : (
                  <ul className="flex flex-col gap-0.5">
                    {value.materials.map((material) => (
                      <MaterialRow key={material.id} material={material} />
                    ))}
                  </ul>
                ),
        })}
        <PdfUploader onUploaded={refreshMaterials} />
      </section>

      {/* Sección de artifacts */}
      <section className="flex flex-col gap-2">
        <Eyebrow>Artifacts</Eyebrow>
        {AsyncResult.matchWithError(artifacts, {
          onInitial: () => <Skeleton />,
          onError: (error) => (
            <p className="text-danger" style={{ fontSize: 13 }}>{String(error)}</p>
          ),
          onDefect: (defect) => (
            <p className="text-danger" style={{ fontSize: 13 }}>{String(defect)}</p>
          ),
          onSuccess: ({ value }) =>
            value.artifacts.length === 0
              ? (
                  <p className="text-ink-mute" style={{ fontSize: 13, padding: "0 6px" }}>
                    No notes, quizzes, or tests yet.
                  </p>
                )
              : (
                  <ul className="flex flex-col gap-0.5">
                    {value.artifacts.map((artifact) => {
                      const badge = kindBadge[artifact.kind] ?? { letter: "?", className: "text-ink-mute bg-surface-muted border-line" };
                      const isSelected = selectedArtifactId === artifact.id;
                      return (
                        <li key={artifact.id}>
                          <button
                            className={`w-full flex items-center gap-2.5 rounded-[10px] text-left cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-brand-tint text-ink"
                                : "text-ink-mute hover:bg-surface-muted"
                            }`}
                            style={{
                              padding: "10px 8px",
                              transitionDuration: "120ms",
                              transitionTimingFunction: "var(--ease-dc)",
                            }}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => onSelectArtifact(artifact.id)}
                          >
                            {/* Badge de tipo */}
                            <div
                              className={`grid place-items-center rounded border flex-shrink-0 ${badge.className}`}
                              style={{
                                width: 22,
                                height: 26,
                                fontFamily: "var(--font-mono)",
                                fontSize: 9,
                                fontWeight: 600,
                              }}
                            >
                              {badge.letter}
                            </div>
                            {/* Nombre */}
                            <span
                              className="flex-1 min-w-0 truncate"
                              style={{ fontSize: 13, fontWeight: 400 }}
                            >
                              {artifact.title}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ),
        })}
      </section>
    </aside>
  );
}
