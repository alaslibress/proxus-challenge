import { Data } from "effect";
import type { EvaluationTraceDraft } from "./trace.ts";

export class EvaluationUnavailable extends Data.TaggedError("EvaluationUnavailable")<{
  readonly reason: unknown;
  readonly stage: "judge" | "evidence";
  readonly trace: EvaluationTraceDraft;
}> {}

/** El stream de un profe terminó sin emitir texto. Error interno del panel: `evaluate`
 *  lo convierte en un `PanelAgentOutcome` fallido, nunca sale por el canal de error. */
export class TeacherStreamEmpty extends Data.TaggedError("TeacherStreamEmpty")<{
  readonly message: string;
}> {}

export type EvaluationError = EvaluationUnavailable;
