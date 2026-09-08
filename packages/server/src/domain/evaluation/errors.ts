import { Data } from "effect";
import type { EvaluationTraceDraft } from "./trace.ts";

export class EvaluationUnavailable extends Data.TaggedError("EvaluationUnavailable")<{
  readonly reason: unknown;
  readonly stage: "judge" | "evidence";
  readonly trace: EvaluationTraceDraft;
}> {}

export type EvaluationError = EvaluationUnavailable;
