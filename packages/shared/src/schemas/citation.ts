import { Schema } from "effect";

export const PdfCitation = Schema.Struct({
  materialId: Schema.String,
  page: Schema.Number,
  quote: Schema.String,
  verified: Schema.Boolean
});
export type PdfCitation = typeof PdfCitation.Type;
