import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import {
  GeminiTransportError,
  isRetryableTransportError,
  geminiRetryPolicy
} from "../gemini-retry.ts";

describe("isRetryableTransportError", () => {
  it.each([408, 429, 500, 502, 503, 504])("says yes to %i", (status) => {
    expect(isRetryableTransportError(new GeminiTransportError({ status, body: "" }))).toBe(true);
  });

  it("says yes to status null (network failure)", () => {
    expect(isRetryableTransportError(new GeminiTransportError({ status: null, body: "" }))).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])("says no to %i", (status) => {
    expect(isRetryableTransportError(new GeminiTransportError({ status, body: "" }))).toBe(false);
  });
});

describe("geminiRetryPolicy", () => {
  it("retries a 503 twice and succeeds on third attempt", async () => {
    let calls = 0;
    const effect = Effect.retry(
      Effect.suspend(() => {
        calls++;
        if (calls < 3) return Effect.fail(new GeminiTransportError({ status: 503, body: "unavailable" }));
        return Effect.succeed("ok");
      }),
      geminiRetryPolicy
    );
    const result = await Effect.runPromise(effect);
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry a 401 — runs exactly once", async () => {
    let calls = 0;
    const effect = Effect.retry(
      Effect.suspend(() => {
        calls++;
        return Effect.fail(new GeminiTransportError({ status: 401, body: "unauthorized" }));
      }),
      geminiRetryPolicy
    );
    const exit = await Effect.runPromiseExit(effect);
    expect(exit._tag).toBe("Failure");
    expect(calls).toBe(1);
  });

  it("retries a 503 exactly 4 times (1 initial + 3 retries) then fails", async () => {
    let calls = 0;
    const effect = Effect.retry(
      Effect.suspend(() => {
        calls++;
        return Effect.fail(new GeminiTransportError({ status: 503, body: "unavailable" }));
      }),
      geminiRetryPolicy
    );
    const exit = await Effect.runPromiseExit(effect);
    expect(exit._tag).toBe("Failure");
    expect(calls).toBe(4);
  }, 30_000);
});
