import { Effect, FileSystem, Layer, Path } from "effect";
import { EvaluationTrace, type EvaluationTraceEntry } from "../../domain/evaluation/trace.ts";
import { formatTraceEntry, formatTraceHeader } from "../../domain/evaluation/trace-format.ts";

export const FileEvaluationTrace = {
  make: (directory: string): Effect.Effect<EvaluationTrace, never, FileSystem.FileSystem | Path.Path> => Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const tracePath = (attemptId: string) => path.join(directory, `${encodeURIComponent(attemptId)}.md`);

    const appendEntry = (entry: EvaluationTraceEntry): Effect.Effect<void> => Effect.gen(function* () {
      const timestamp = new Date().toISOString();
      const filePath = tracePath(entry.attemptId);

      yield* fs.makeDirectory(directory, { recursive: true });

      const existing = yield* fs.readFileString(filePath).pipe(
        Effect.orElseSucceed(() => undefined)
      );

      const header = existing ?? formatTraceHeader(entry.attemptId, entry.artifactId, timestamp);
      const section = formatTraceEntry(entry, timestamp);
      const content = `${header}\n${section}\n`;

      yield* fs.writeFileString(filePath, content);
    }).pipe(Effect.ignore);

    const record = (entry: EvaluationTraceEntry): Effect.Effect<void> =>
      appendEntry(entry).pipe(
        Effect.forkDetach,
        Effect.asVoid
      );

    return { record };
  }),
  layer: (directory: string) => Layer.effect(EvaluationTrace)(FileEvaluationTrace.make(directory))
};
