import { Context, Data, Effect } from "effect";

export interface PdfMaterial {
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  readonly pageCount: number;
  readonly uploadedAt: string;
}

export interface PageImage {
  readonly page: number;
  readonly mediaType: "image/png";
  readonly data: string;
}

export interface MaterialPageImages {
  readonly type: "material-page-images";
  readonly material: PdfMaterial;
  readonly pages: readonly PageImage[];
}

export class MaterialNotFound extends Data.TaggedError("MaterialNotFound")<{
  readonly materialId: string;
}> {}

export class InvalidPageRange extends Data.TaggedError("InvalidPageRange")<{
  readonly range: string;
  readonly reason: string;
}> {}

export class MaterialRepositoryError extends Data.TaggedError("MaterialRepositoryError")<{
  readonly reason: unknown;
}> {}

export class InvalidPdf extends Data.TaggedError("InvalidPdf")<{
  readonly message: string;
}> {}

export interface MaterialRepository {
  readonly list: () => Effect.Effect<readonly PdfMaterial[], MaterialRepositoryError>;
  readonly save: (input: {
    readonly fileName: string;
    readonly path: string;
  }) => Effect.Effect<PdfMaterial, InvalidPdf | MaterialRepositoryError>;
  readonly get: (id: string) => Effect.Effect<PdfMaterial, MaterialNotFound | MaterialRepositoryError>;
  readonly delete: (id: string) => Effect.Effect<void, MaterialNotFound | MaterialRepositoryError>;
  readonly renderPages: (
    id: string,
    pages: readonly number[]
  ) => Effect.Effect<MaterialPageImages, MaterialNotFound | MaterialRepositoryError>;
}

export const MaterialRepository = Context.Service<MaterialRepository>(
  "@proxus/server/materials/MaterialRepository"
);

export const parsePageSelection = (
  selection: string
): Effect.Effect<readonly number[], InvalidPageRange> => Effect.gen(function* () {
  const pages = new Set<number>();
  const parts = selection.split(",").map((part) => part.trim()).filter((part) => part.length > 0);

  if (parts.length === 0) {
    return yield* new InvalidPageRange({ range: selection, reason: "Expected pages like 10 or 13-20" });
  }

  for (const part of parts) {
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (rangeMatch !== null) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
        return yield* new InvalidPageRange({ range: selection, reason: `Invalid range: ${part}` });
      }
      for (let page = start; page <= end; page++) {
        pages.add(page);
      }
      continue;
    }

    const page = Number(part);
    if (!Number.isSafeInteger(page) || page < 1) {
      return yield* new InvalidPageRange({ range: selection, reason: `Invalid page: ${part}` });
    }
    pages.add(page);
  }

  return [...pages].sort((a, b) => a - b);
});

export const isMaterialPageImages = (value: unknown): value is MaterialPageImages => {
  if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "material-page-images") {
    return false;
  }

  const candidate = value as { readonly pages?: unknown };
  return Array.isArray(candidate.pages);
};

// The uploaded file name comes from the client, so it is a trust boundary: it may carry
// directory components, or characters the filesystem refuses. The id and title of a
// material are derived from this name, so it also has to stay readable.
export const sanitizeFileName = (raw: string): string => {
  // Own basename: Node's is platform specific, and on POSIX it would keep "..\evil.pdf"
  // whole. Both separators are stripped here regardless of platform.
  const withoutDirectory = raw.split(/[/\\]/).pop() ?? "";
  const withoutExtension = withoutDirectory.replace(/\.pdf$/i, "");
  const stem = withoutExtension
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\-\s]+|[.\-\s]+$/g, "");

  return `${stem.length === 0 ? "material" : stem}.pdf`;
};

// Two materials cannot share a file name: the id is the file name without extension, and
// `getFile` resolves by the first id that matches. Comparison is case insensitive because
// on Windows "Doc.pdf" and "doc.pdf" are the same file, and overwriting one with the
// other would lose the original.
export const resolveFileNameCollision = (
  name: string,
  taken: ReadonlySet<string>
): string => {
  const isTaken = (candidate: string) => taken.has(candidate.toLowerCase());
  if (!isTaken(name)) {
    return name;
  }

  const stem = name.replace(/\.pdf$/i, "");
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-${suffix}.pdf`;
    if (!isTaken(candidate)) {
      return candidate;
    }
  }
};
