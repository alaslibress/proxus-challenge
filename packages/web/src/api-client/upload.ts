import type { PdfMaterial } from "@proxus/shared";
import { apiClientConfig } from "./config.ts";

export interface UploadProgress {
  readonly loaded: number;
  readonly total: number;
}

export interface UploadOptions {
  readonly onProgress: (progress: UploadProgress) => void;
  readonly signal?: AbortSignal;
}

export const uploadMaterial = (file: File, options: UploadOptions): Promise<PdfMaterial> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const body = new FormData();
    body.append("file", file);

    xhr.open("POST", `${apiClientConfig.apiUrl}/api/materials`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress({ loaded: event.loaded, total: event.total });
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          resolve(JSON.parse(xhr.responseText) as PdfMaterial);
        } catch {
          reject(new Error("Could not upload the PDF. Check that the server is running."));
        }
        return;
      }
      if (xhr.status === 400) {
        try {
          const body = JSON.parse(xhr.responseText) as { message?: string };
          reject(new Error(body.message ?? "Could not upload the PDF."));
        } catch {
          reject(new Error("Could not upload the PDF."));
        }
        return;
      }
      console.error("Upload failed:", xhr.responseText);
      reject(new Error("Could not upload the PDF. Check that the server is running."));
    };

    xhr.onerror = () => {
      reject(new Error("Could not upload the PDF. Check that the server is running."));
    };

    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        xhr.abort();
        reject(new DOMException("Upload cancelled", "AbortError"));
      });
    }

    xhr.send(body);
  });
