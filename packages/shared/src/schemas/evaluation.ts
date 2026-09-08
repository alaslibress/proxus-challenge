import { Schema } from "effect";
import { PdfCitation } from "./citation.ts";

/** Contrato estricto de la respuesta del Juez. Lo que el LLM debe producir. */
export const FinalFeedbackSchema = Schema.Struct({
  is_correct: Schema.Boolean,
  feedback: Schema.String,
  citas_pdf: Schema.Array(Schema.String)
});
export type FinalFeedbackSchema = typeof FinalFeedbackSchema.Type;

/** Contrato enriquecido que consume la UI, tras verificar cada cita en servidor. */
export const EnrichedFeedbackSchema = Schema.Struct({
  is_correct: Schema.Boolean,
  feedback: Schema.String,
  citas_pdf: Schema.Array(PdfCitation)
});
export type EnrichedFeedbackSchema = typeof EnrichedFeedbackSchema.Type;
