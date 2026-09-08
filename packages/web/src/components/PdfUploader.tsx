import { useEffect, useRef, useState } from "react";
import { uploadMaterial } from "../api-client/upload.ts";

type UploadState =
  | { readonly status: "idle" }
  | { readonly status: "uploading"; readonly fileName: string; readonly percent: number }
  | { readonly status: "success"; readonly title: string }
  | { readonly status: "error"; readonly message: string };

interface PdfUploaderProps {
  readonly onUploaded: () => void;
}

const MAX_SIZE = 25 * 1024 * 1024;

const validateFile = (file: File): string | null => {
  const isExtPdf = file.name.toLowerCase().endsWith(".pdf");
  const isMimePdf = file.type === "application/pdf";
  if (!isExtPdf && !isMimePdf) return "Only PDF files are supported.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_SIZE) return "That file is too large (max 25 MB).";
  return null;
};

export function PdfUploader({ onUploaded }: PdfUploaderProps) {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.status !== "success") return;
    const id = setTimeout(() => setState({ status: "idle" }), 4000);
    return () => clearTimeout(id);
  }, [state.status]);

  const upload = (file: File) => {
    if (state.status === "uploading") return;

    const validationError = validateFile(file);
    if (validationError !== null) {
      setState({ status: "error", message: validationError });
      return;
    }

    setState({ status: "uploading", fileName: file.name, percent: 0 });

    uploadMaterial(file, {
      onProgress: ({ loaded, total }) => {
        setState((prev) =>
          prev.status === "uploading"
            ? { ...prev, percent: total > 0 ? Math.round((loaded / total) * 100) : 0 }
            : prev
        );
      }
    })
      .then((material) => {
        setState({ status: "success", title: material.title });
        onUploaded();
        if (inputRef.current) inputRef.current.value = "";
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Could not upload the PDF.";
        setState({ status: "error", message });
        if (inputRef.current) inputRef.current.value = "";
      });
  };

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file !== undefined) upload(file);
  };

  const isDisabled = state.status === "uploading";

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        aria-hidden="true"
        onChange={(e) => handleFiles(e.currentTarget.files)}
      />

      <div
        role="button"
        tabIndex={isDisabled ? -1 : 0}
        aria-disabled={isDisabled}
        className={`rounded-2xl border border-dashed p-4 text-center transition-colors ${
          isDragging
            ? "border-brand bg-brand-tint"
            : "border-line bg-surface-muted hover:border-line-strong"
        } ${isDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
        style={{ transitionDuration: "120ms", transitionTimingFunction: "var(--ease-dc)" }}
        onClick={() => { if (!isDisabled) inputRef.current?.click(); }}
        onKeyDown={(e) => {
          if (!isDisabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => { e.preventDefault(); if (!isDisabled) setIsDragging(true); }}
        onDragEnter={(e) => { e.preventDefault(); if (!isDisabled) setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (!isDisabled) handleFiles(e.dataTransfer.files);
        }}
      >
        <p className="text-ink-mute" style={{ fontSize: 12.5 }}>
          Drop a PDF here or{" "}
          <span className="text-brand underline underline-offset-2">choose a file</span>
        </p>
      </div>

      <div aria-live="polite">
        {state.status === "uploading" && (
          <div className="flex flex-col gap-1.5">
            <p className="text-ink-faint truncate" style={{ fontSize: 12 }}>{state.fileName}</p>
            <div
              className="h-1 w-full overflow-hidden bg-track"
              style={{ borderRadius: 999 }}
              role="progressbar"
              aria-valuenow={state.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
            >
              <div
                className="h-full bg-brand"
                style={{
                  width: `${state.percent}%`,
                  transitionProperty: "width",
                  transitionDuration: "150ms",
                  transitionTimingFunction: "linear",
                }}
              />
            </div>
          </div>
        )}

        {state.status === "success" && (
          <p className="text-good" style={{ fontSize: 12.5 }}>
            ✓ {state.title} uploaded
          </p>
        )}

        {state.status === "error" && (
          <div
            className="flex items-start justify-between gap-2 border border-danger-line bg-danger-tint"
            style={{ borderRadius: 8, padding: "8px 10px" }}
          >
            <p className="text-danger" style={{ fontSize: 12 }}>{state.message}</p>
            <button
              type="button"
              className="text-danger-ink flex-shrink-0"
              style={{ fontSize: 11, fontWeight: 500 }}
              onClick={() => setState({ status: "idle" })}
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
