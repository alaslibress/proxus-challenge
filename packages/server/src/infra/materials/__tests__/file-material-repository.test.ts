import { describe, it, expect } from "vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import type { PlatformError } from "effect/PlatformError";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { FileMaterialRepository } from "../file-material-repository.ts";
import { PdfService, PdfServiceError } from "../../../domain/materials/pdf-service.ts";
import type { PageText } from "../../../domain/materials/material.ts";

// A fake PdfService avoids depending on the real Poppler binaries in unit tests: page
// count and text extraction are entirely under the test's control here.
const makeFakePdfService = (options: {
  readonly pageCount: number;
  readonly textForPage?: (page: number) => string;
}) => Layer.succeed(PdfService)({
  pageCount: () => Effect.succeed(options.pageCount),
  renderPage: ({ page }) => Effect.succeed({ page, mediaType: "image/png" as const, data: "" }),
  extractPageText: ({ page }): Effect.Effect<PageText, PdfServiceError> =>
    Effect.succeed({ page, text: options.textForPage?.(page) ?? `text of page ${page}` })
});

const withTempMaterialsDir = <A, E, R>(
  run: (directory: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PlatformError, R | FileSystem.FileSystem | Path.Path> => Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectory({ prefix: "proxus-material-repo-test-" });
  yield* fs.writeFile(path.join(directory, "sample.pdf"), new Uint8Array());
  return yield* run(directory).pipe(
    Effect.ensuring(fs.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore))
  );
});

describe("FileMaterialRepository.extractText", () => {
  it("fails with the same out-of-range shape as renderPages when a page number exceeds pageCount", async () => {
    const pdf = makeFakePdfService({ pageCount: 3 });

    const program = withTempMaterialsDir((directory) => Effect.gen(function* () {
      const repository = yield* FileMaterialRepository.make(directory);
      return yield* repository.extractText("sample", [999]).pipe(Effect.flip);
    })).pipe(
      Effect.provide(Layer.mergeAll(pdf, NodeServices.layer))
    );

    const error = await Effect.runPromise(program);
    expect(error._tag).toBe("MaterialRepositoryError");
    expect(String((error as { readonly reason: unknown }).reason)).toContain("outside 1-3");
  });

  it("rejects page 0 as out of range, same as page > pageCount", async () => {
    const pdf = makeFakePdfService({ pageCount: 3 });

    const program = withTempMaterialsDir((directory) => Effect.gen(function* () {
      const repository = yield* FileMaterialRepository.make(directory);
      return yield* repository.extractText("sample", [0]).pipe(Effect.flip);
    })).pipe(
      Effect.provide(Layer.mergeAll(pdf, NodeServices.layer))
    );

    const error = await Effect.runPromise(program);
    expect(error._tag).toBe("MaterialRepositoryError");
  });

  it("returns blank page text (not an error) for a material with no extractable text layer", async () => {
    const pdf = makeFakePdfService({ pageCount: 2, textForPage: () => "" });

    const program = withTempMaterialsDir((directory) => Effect.gen(function* () {
      const repository = yield* FileMaterialRepository.make(directory);
      return yield* repository.extractText("sample", [1, 2]);
    })).pipe(
      Effect.provide(Layer.mergeAll(pdf, NodeServices.layer))
    );

    const result = await Effect.runPromise(program);
    expect(result.type).toBe("material-page-texts");
    expect(result.pages).toEqual([
      { page: 1, text: "" },
      { page: 2, text: "" }
    ]);
  });

  it("returns the same result on repeated calls for the same material (idempotent)", async () => {
    const pdf = makeFakePdfService({ pageCount: 2 });

    const program = withTempMaterialsDir((directory) => Effect.gen(function* () {
      const repository = yield* FileMaterialRepository.make(directory);
      const first = yield* repository.extractText("sample", [1, 2]);
      const second = yield* repository.extractText("sample", [1, 2]);
      return { first, second };
    })).pipe(
      Effect.provide(Layer.mergeAll(pdf, NodeServices.layer))
    );

    const { first, second } = await Effect.runPromise(program);
    expect(first.pages).toEqual(second.pages);
    expect(first.material).toEqual(second.material);
  });

  it("resolves concurrent calls to extractText for the same material without interference", async () => {
    const pdf = makeFakePdfService({ pageCount: 2 });

    const program = withTempMaterialsDir((directory) => Effect.gen(function* () {
      const repository = yield* FileMaterialRepository.make(directory);
      return yield* Effect.all(
        [repository.extractText("sample", [1]), repository.extractText("sample", [2])],
        { concurrency: "unbounded" }
      );
    })).pipe(
      Effect.provide(Layer.mergeAll(pdf, NodeServices.layer))
    );

    const [first, second] = await Effect.runPromise(program);
    expect(first.pages).toEqual([{ page: 1, text: "text of page 1" }]);
    expect(second.pages).toEqual([{ page: 2, text: "text of page 2" }]);
  });
});
