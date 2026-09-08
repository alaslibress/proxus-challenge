import { describe, it, expect } from "vitest";
import { resolveStreamFailure } from "../stream.ts";

describe("resolveStreamFailure", () => {
  it("keeps the messages when the user pressed Stop", () => {
    const abort = new DOMException("signal aborted", "AbortError");
    expect(resolveStreamFailure(abort)).toEqual({
      keepMessages: true,
      restoreInput: false,
      showError: false
    });
  });

  it("rolls the turn back when the stream really failed", () => {
    expect(resolveStreamFailure(new Error("network down"))).toEqual({
      keepMessages: false,
      restoreInput: true,
      showError: true
    });
  });

  it("treats an unknown cause as a failure, not as a stop", () => {
    for (const cause of [null, undefined, "boom", { name: "AbortError" }]) {
      expect(resolveStreamFailure(cause).keepMessages).toBe(false);
    }
  });
});
