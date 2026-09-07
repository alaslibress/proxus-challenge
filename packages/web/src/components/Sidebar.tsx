import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { artifactsQuery } from "../domain/artifacts/atoms.ts";
import { materialsQuery } from "../domain/materials/atoms.ts";

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

export function Sidebar({ selectedArtifactId, onSelectArtifact }: SidebarProps) {
  const materials = useAtomValue(materialsQuery);
  const artifacts = useAtomValue(artifactsQuery);

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
          P
        </div>
        <div>
          <strong
            className="block text-ink"
            style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-.01em" }}
          >
            Proxus Tutor
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
                      <li
                        key={material.id}
                        className="flex items-center gap-2.5 cursor-default rounded-[10px]"
                        style={{ padding: "10px 8px" }}
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
                      </li>
                    ))}
                  </ul>
                ),
        })}
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
