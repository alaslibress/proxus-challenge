import { Schema } from "effect";

export const PdfMaterial = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  fileName: Schema.String,
  pageCount: Schema.Number,
  uploadedAt: Schema.String
});
export type PdfMaterial = typeof PdfMaterial.Type;

export const PageImage = Schema.Struct({
  page: Schema.Number,
  mediaType: Schema.Literal("image/png"),
  data: Schema.String
});
export type PageImage = typeof PageImage.Type;

export const MaterialPageImages = Schema.Struct({
  type: Schema.Literal("material-page-images"),
  material: PdfMaterial,
  pages: Schema.Array(PageImage)
});
export type MaterialPageImages = typeof MaterialPageImages.Type;

export const PageText = Schema.Struct({ page: Schema.Number, text: Schema.String });
export type PageText = typeof PageText.Type;

export const MaterialPageTexts = Schema.Struct({
  type: Schema.Literal("material-page-texts"),
  material: PdfMaterial,
  pages: Schema.Array(PageText)
});
export type MaterialPageTexts = typeof MaterialPageTexts.Type;

export const MaterialListResponse = Schema.Struct({
  materials: Schema.Array(PdfMaterial)
});
export type MaterialListResponse = typeof MaterialListResponse.Type;

export const MaterialNotFoundError = Schema.TaggedStruct("MaterialNotFound", {
  materialId: Schema.String
});
export type MaterialNotFoundError = typeof MaterialNotFoundError.Type;

// `message` is the field name the upload client already reads on a 400 response
// (packages/web/src/api-client/upload.ts).
export const InvalidPdfError = Schema.TaggedStruct("InvalidPdf", {
  message: Schema.String
});
export type InvalidPdfError = typeof InvalidPdfError.Type;
