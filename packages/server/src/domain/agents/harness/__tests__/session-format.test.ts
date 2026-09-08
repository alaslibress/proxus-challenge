import { describe, it, expect } from "vitest";
import { formatToolResult } from "../session.ts";

describe("formatToolResult", () => {
  it("returns string as-is", () => {
    expect(formatToolResult("hello")).toBe("hello");
  });

  it("serializes objects to JSON", () => {
    expect(formatToolResult({ a: 1 })).toBe('{"a":1}');
  });

  it("serializes arrays", () => {
    expect(formatToolResult([1, 2, 3])).toBe("[1,2,3]");
  });

  it("serializes numbers", () => {
    expect(formatToolResult(42)).toBe("42");
  });

  it("serializes null", () => {
    expect(formatToolResult(null)).toBe("null");
  });

  it("serializes booleans", () => {
    expect(formatToolResult(true)).toBe("true");
    expect(formatToolResult(false)).toBe("false");
  });

  it("falls back to String() for non-serializable (circular)", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const result = formatToolResult(circular);
    expect(typeof result).toBe("string");
  });
});
