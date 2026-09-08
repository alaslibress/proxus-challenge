import { Schema } from "effect";
import { AttemptStreamEvent, type SubmitAttemptInput, type AttemptStreamEvent as AttemptStreamEventType } from "@proxus/shared";
import { apiClientConfig } from "../../api-client/config.ts";
import { readNdjson } from "../../lib/ndjson.ts";

const AttemptStreamEventFromJsonString = Schema.fromJsonString(AttemptStreamEvent);
const decodeEvent = Schema.decodeUnknownSync(AttemptStreamEventFromJsonString);

export async function* streamAttemptSubmission(
  artifactId: string,
  input: SubmitAttemptInput,
  signal?: AbortSignal
): AsyncGenerator<AttemptStreamEventType> {
  const response = await fetch(`${apiClientConfig.apiUrl}/api/artifacts/${artifactId}/submit/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/x-ndjson"
    },
    body: JSON.stringify(input),
    ...(signal !== undefined ? { signal } : {})
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    console.error("attempt stream failed", response.status, raw);
    throw new Error(
      response.status >= 500
        ? "The evaluation service failed while grading. Try again."
        : "The evaluation service rejected the request."
    );
  }

  yield* readNdjson(response, decodeEvent);
}
