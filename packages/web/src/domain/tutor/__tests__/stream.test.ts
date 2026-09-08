import { describe, it, expect } from "vitest";
import { isAbortError } from "../stream.ts";

describe("isAbortError", () => {
  it("returns true for DOMException with name AbortError", () => {
    const e = new DOMException("signal aborted", "AbortError");
    expect(isAbortError(e)).toBe(true);
  });

  it("returns false for DOMException with a different name", () => {
    const e = new DOMException("not found", "NotFoundError");
    expect(isAbortError(e)).toBe(false);
  });

  it("returns false for a plain Error", () => {
    expect(isAbortError(new Error("oops"))).toBe(false);
  });

  it("returns false for null", () => {
    expect(isAbortError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAbortError(undefined)).toBe(false);
  });

  it("returns false for a string", () => {
    expect(isAbortError("AbortError")).toBe(false);
  });

  it("returns false for an object that looks like DOMException but is not", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(false);
  });
});
