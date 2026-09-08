import { Schema } from "effect";

export const PdfCitation = Schema.Struct({
  materialId: Schema.String,
  page: Schema.Number,
  quote: Schema.String,
  verified: Schema.Boolean
});
export type PdfCitation = typeof PdfCitation.Type;

export const ArtifactSource = Schema.Struct({
  materialId: Schema.String,
  pages: Schema.Array(Schema.Number)
});
export type ArtifactSource = typeof ArtifactSource.Type;
