import { Data } from "effect";

export class EvaluationUnavailable extends Data.TaggedError("EvaluationUnavailable")<{
  readonly reason: unknown;
  readonly stage: "judge" | "evidence";
}> {}

export type EvaluationError = EvaluationUnavailable;
