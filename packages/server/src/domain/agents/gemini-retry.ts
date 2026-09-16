import { Data, Schedule } from "effect";

/** Fallo de transporte contra la API de Gemini.
 *  `status: null` = la petición nunca llegó a recibir respuesta (DNS, socket, abort). */
export class GeminiTransportError extends Data.TaggedError("GeminiTransportError")<{
  readonly status: number | null;
  readonly body: string;
}> {}

/** 408 y 429 son de ritmo; 5xx son de servidor. Todos transitorios según Google.
 *  Un 4xx que no sea 408/429 es culpa nuestra: reintentarlo sólo retrasa el error. */
export const RETRYABLE_STATUSES: readonly number[] = [408, 429, 500, 502, 503, 504];

export const isRetryableTransportError = (error: GeminiTransportError): boolean =>
  error.status === null || RETRYABLE_STATUSES.includes(error.status);

/** 3 reintentos sobre el intento inicial. Backoff 500ms → 1s → 2s, con jitter para no
 *  sincronizar los dos profes, que salen a la vez y chocarían con el mismo pico. */
export const geminiRetryPolicy = {
  while: isRetryableTransportError,
  times: 3,
  schedule: Schedule.jittered(Schedule.exponential("500 millis"))
} as const;
