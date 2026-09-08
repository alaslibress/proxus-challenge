import { Effect, FileSystem, Option, Path, Stream } from "effect";
import { Multipart } from "effect/unstable/http";
import { InvalidPdf } from "../../domain/materials/material.ts";

export interface UploadedFile {
  // The name as the client sent it: still untrusted, sanitized when the repository saves.
  readonly fileName: string;
  // A path we chose, so no client-supplied character ever reaches the filesystem.
  readonly path: string;
}

// The buffered multipart decoder writes the temporary file under the client's own file
// name. On Windows a name holding `: ? * " < > |` cannot be written at all, so the
// request failed before any sanitizing could run. Consuming the parts as a stream lets us
// pick the name ourselves, which is the only point where that name is under our control.
export const withUploadedFile = <A, E, R>(
  parts: Stream.Stream<Multipart.Part, Multipart.MultipartError>,
  use: (file: UploadedFile) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | InvalidPdf, R | FileSystem.FileSystem | Path.Path> => Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const directory = yield* fs.makeTempDirectory({ prefix: "proxus-upload-" }).pipe(
    Effect.orDie
  );

  const collect = Effect.gen(function* () {
    const found = yield* Stream.runFoldEffect(
      parts,
      (): Option.Option<UploadedFile> => Option.none(),
      (accumulator, part) => Option.isSome(accumulator) || !Multipart.isFile(part)
        ? Effect.succeed(accumulator)
        : Effect.gen(function* () {
          const target = path.join(directory, "upload.pdf");
          yield* Stream.run(part.content, fs.sink(target)).pipe(Effect.orDie);
          return Option.some({ fileName: part.name, path: target });
        })
    ).pipe(
      // A multipart failure here is the request's fault — a truncated body, or a file
      // over the declared limit — not a server fault.
      Effect.catchTag("MultipartError", () =>
        new InvalidPdf({ message: "That upload could not be read. The file may be larger than 25 MB." })
      )
    );

    if (Option.isNone(found)) {
      return yield* new InvalidPdf({ message: "No file was uploaded." });
    }

    return yield* use(found.value);
  });

  return yield* collect.pipe(
    Effect.ensuring(fs.remove(directory, { recursive: true }).pipe(Effect.ignore))
  );
});
