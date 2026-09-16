import { Effect, Schema } from "effect";
import { PdfCitation } from "./citation.ts";

/** Contrato estricto de la respuesta del Juez. Lo que el LLM debe producir. */
export const FinalFeedbackSchema = Schema.Struct({
  is_correct: Schema.Boolean,
  feedback: Schema.String,
  citas_pdf: Schema.Array(Schema.String)
});
export type FinalFeedbackSchema = typeof FinalFeedbackSchema.Type;

/**
 * Resultado de un profe. Mismo par de casos que ya usa la traza,
 * pero ahora vive en shared para que traza y API no puedan divergir.
 */
export const PanelAgentOutcome = Schema.Union([
  Schema.Struct({ status: Schema.Literal("ok"), text: Schema.String }),
  Schema.Struct({ status: Schema.Literal("failed"), reason: Schema.String })
]);
export type PanelAgentOutcome = typeof PanelAgentOutcome.Type;

/** Contrato enriquecido que consume la UI, tras verificar cada cita en servidor. */
export const EnrichedFeedbackSchema = Schema.Struct({
  is_correct: Schema.Boolean,
  feedback: Schema.String,
  citas_pdf: Schema.Array(PdfCitation),
  grounded: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  // Opcionales: los intentos anteriores a este PR no los llevan y deben
  // seguir decodificando. Sin default: "no lo sé" y "falló" son cosas distintas.
  goodTeacher: Schema.optional(PanelAgentOutcome),
  badTeacher: Schema.optional(PanelAgentOutcome)
});
export type EnrichedFeedbackSchema = typeof EnrichedFeedbackSchema.Type;
