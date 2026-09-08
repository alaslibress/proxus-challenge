import { Context, Effect } from "effect";
import type { FinalFeedbackSchema, PdfCitation } from "@proxus/shared";
import type { PageText } from "../materials/material.ts";

export interface EvaluationTraceEntry {
  readonly attemptId: string;
  readonly artifactId: string;
  readonly questionId: string;
  readonly questionPrompt: string;
  readonly expectedAnswer: string;
  readonly studentAnswer: string;
  readonly materialId: string | undefined;
  readonly pages: readonly number[];
  readonly evidence: readonly PageText[];
  readonly goodTeacher: { readonly ok: true; readonly text: string }
                      | { readonly ok: false; readonly reason: string };
  readonly badTeacher:  { readonly ok: true; readonly text: string }
                      | { readonly ok: false; readonly reason: string };
  readonly judge: FinalFeedbackSchema | { readonly failed: string };
  readonly citations: readonly PdfCitation[];
  readonly deterministicScore: number;
  readonly finalScore: number;
  readonly scoreOverridden: boolean;
  readonly durationMs: number;
}

export interface EvaluationTrace {
  /** Devuelve inmediatamente: la escritura ocurre en un fiber aparte. */
  readonly record: (entry: EvaluationTraceEntry) => Effect.Effect<void>;
}

/**
 * Lo que produce el motor: todo salvo lo que solo conoce `review.ts` (el intento y el
 * artefacto a los que pertenece, y las notas antes/después del panel).
 */
export type EvaluationTraceDraft = Omit<
  EvaluationTraceEntry,
  "attemptId" | "artifactId" | "deterministicScore" | "finalScore" | "scoreOverridden"
>;

export const EvaluationTrace = Context.Service<EvaluationTrace>(
  "@proxus/server/evaluation/EvaluationTrace"
);
