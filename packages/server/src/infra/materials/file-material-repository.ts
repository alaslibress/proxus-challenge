import { Effect, FileSystem, Layer, Option, Path } from "effect";
import {
  InvalidPdf,
  MaterialNotFound,
  MaterialRepository,
  MaterialRepositoryError,
  resolveFileNameCollision,
  sanitizeFileName,
  type MaterialPageImages,
  type MaterialPageTexts,
  type MaterialRepository as MaterialRepositoryType,
  type PdfMaterial
} from "../../domain/materials/material.ts";
import { PdfService } from "../../domain/materials/pdf-service.ts";

interface PdfFile {
  readonly material: PdfMaterial;
  readonly path: string;
}

export const FileMaterialRepository = {
  make: (directory: string): Effect.Effect<MaterialRepositoryType, never, FileSystem.FileSystem | Path.Path | PdfService> => Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const pdf = yield* PdfService;
    const mapError = (reason: unknown) => new MaterialRepositoryError({ reason });

    const pdfPath = (fileName: string) => path.join(directory, fileName);

    const listFiles = (): Effect.Effect<readonly PdfFile[], MaterialRepositoryError> => Effect.gen(function* () {
      yield* fs.makeDirectory(directory, { recursive: true }).pipe(
        Effect.mapError(mapError)
      );

      const entries = yield* fs.readDirectory(directory).pipe(
        Effect.mapError(mapError)
      );

      return yield* Effect.forEach(
        entries.filter((entry) => path.extname(entry).toLowerCase() === ".pdf").sort(),
        (fileName): Effect.Effect<PdfFile, MaterialRepositoryError> => Effect.gen(function* () {
          const fullPath = pdfPath(fileName);
          const stat = yield* fs.stat(fullPath).pipe(
            Effect.mapError(mapError)
          );
          const material: PdfMaterial = {
            id: path.basename(fileName, ".pdf"),
            title: path.basename(fileName, ".pdf"),
            fileName,
            pageCount: yield* pdf.pageCount(fullPath).pipe(Effect.mapError(mapError)),
            uploadedAt: Option.getOrElse(stat.mtime, () => new Date(0)).toISOString()
          };
          return { material, path: fullPath };
        }),
        { concurrency: 1 }
      );
    });

    const getFile = (id: string): Effect.Effect<PdfFile, MaterialNotFound | MaterialRepositoryError> => Effect.gen(function* () {
      const files = yield* listFiles();
      const found = files.find((file) => file.material.id === id);
      if (found === undefined) {
        return yield* new MaterialNotFound({ materialId: id });
      }
      return found;
    });

    const list = () => listFiles().pipe(
      Effect.map((files) => files.map((file) => file.material))
    );

    const get = (id: string) => getFile(id).pipe(
      Effect.map((file) => file.material)
    );

    const save = (input: {
      readonly fileName: string;
      readonly path: string;
    }): Effect.Effect<PdfMaterial, InvalidPdf | MaterialRepositoryError> => Effect.gen(function* () {
      yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(mapError));

      // Validate on the temporary file, before it enters the materials directory.
      // `listFiles` runs pdfinfo over every file in there on each list/get/renderPages,
      // so a single unreadable PDF would break the whole catalogue, not just this one.
      yield* pdf.pageCount(input.path).pipe(
        Effect.mapError(() => new InvalidPdf({ message: "That file is not a readable PDF." }))
      );

      const existing = yield* listFiles();
      const taken = new Set(existing.map((file) => file.material.fileName.toLowerCase()));
      const fileName = resolveFileNameCollision(sanitizeFileName(input.fileName), taken);
      const destination = pdfPath(fileName);

      yield* fs.rename(input.path, destination).pipe(
        Effect.catch(() =>
          // Multipart persists uploads to a temp directory that may sit on another
          // volume, where rename fails with EXDEV. Fall back to copying.
          fs.copyFile(input.path, destination).pipe(
            Effect.andThen(fs.remove(input.path).pipe(Effect.ignore)),
            Effect.mapError(mapError)
          )
        )
      );

      // Read the material back through the same path `list` uses, so a freshly uploaded
      // material is byte-for-byte what the catalogue will report from now on.
      return yield* getFile(path.basename(fileName, ".pdf")).pipe(
        Effect.map((file) => file.material),
        Effect.catchTag("MaterialNotFound", (e) => new MaterialRepositoryError({ reason: e }))
      );
    });

    const deleteMaterial = (id: string): Effect.Effect<void, MaterialNotFound | MaterialRepositoryError> =>
      Effect.gen(function* () {
        // Resolve path via repository listing — never by concatenating the raw id.
        // This prevents path traversal (e.g. id = "../../etc/passwd").
        const file = yield* getFile(id);
        yield* fs.remove(file.path).pipe(Effect.mapError(mapError));
      });

    const renderPages = (
      id: string,
      pages: readonly number[]
    ): Effect.Effect<MaterialPageImages, MaterialNotFound | MaterialRepositoryError> => Effect.gen(function* () {
      const file = yield* getFile(id);
      const invalidPage = pages.find((page) => page < 1 || page > file.material.pageCount);
      if (invalidPage !== undefined) {
        return yield* new MaterialRepositoryError({
          reason: `Page ${invalidPage} is outside 1-${file.material.pageCount} for material ${id}`
        });
      }

      const images = yield* Effect.forEach(pages, (page) => pdf.renderPage({ path: file.path, page }).pipe(
        Effect.mapError(mapError)
      ), { concurrency: 1 });

      return {
        type: "material-page-images" as const,
        material: file.material,
        pages: images
      };
    });

    const extractText = (
      id: string,
      pages: readonly number[]
    ): Effect.Effect<MaterialPageTexts, MaterialNotFound | MaterialRepositoryError> => Effect.gen(function* () {
      const file = yield* getFile(id);
      const invalidPage = pages.find((page) => page < 1 || page > file.material.pageCount);
      if (invalidPage !== undefined) {
        return yield* new MaterialRepositoryError({
          reason: `Page ${invalidPage} is outside 1-${file.material.pageCount} for material ${id}`
        });
      }

      const texts = yield* Effect.forEach(pages, (page) => pdf.extractPageText({ path: file.path, page }).pipe(
        Effect.mapError(mapError)
      ), { concurrency: 1 });

      return {
        type: "material-page-texts" as const,
        material: file.material,
        pages: texts
      };
    });

    return { list, get, save, delete: deleteMaterial, renderPages, extractText };
  }),
  layer: (directory: string) => Layer.effect(MaterialRepository)(FileMaterialRepository.make(directory))
};
