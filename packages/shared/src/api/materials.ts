import { Schema } from "effect";
import { Multipart } from "effect/unstable/http";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";
import { InvalidPdfError, MaterialListResponse, MaterialNotFoundError, PdfMaterial } from "../schemas/material.ts";

// Mirrors the client-side limit in packages/web/src/components/PdfUploader.tsx. That one
// is UX; this one is the trust boundary.
const MAX_PDF_SIZE = 25 * 1024 * 1024;

export class MaterialsApi extends HttpApiGroup.make("materials")
  .add(
    HttpApiEndpoint.get("list", "/", {
      success: MaterialListResponse
    }),
    HttpApiEndpoint.get("get", "/:id", {
      params: {
        id: Schema.String
      },
      success: PdfMaterial
    }),
    HttpApiEndpoint.delete("delete", "/:id", {
      params: {
        id: Schema.String
      },
      success: HttpApiSchema.NoContent,
      error: MaterialNotFoundError.pipe(HttpApiSchema.status(404))
    }),
    // Streamed rather than buffered on purpose: the buffered decoder persists the
    // temporary file under the client's own file name, which on Windows can be a name the
    // filesystem refuses. Streaming lets the server choose that name.
    HttpApiEndpoint.post("upload", "/", {
      payload: Schema.Struct({
        file: Multipart.SingleFileSchema
      }).pipe(HttpApiSchema.asMultipartStream({ maxFileSize: MAX_PDF_SIZE, maxParts: 2 })),
      success: PdfMaterial.pipe(HttpApiSchema.status(200)),
      error: InvalidPdfError.pipe(HttpApiSchema.status(400))
    })
  )
  .prefix("/materials")
{}
