import { describe, it, expect } from "vitest";
import { encodeToolCallId, decodeThoughtSignature } from "../gemini.ts";

describe("encodeToolCallId", () => {
  it("returns base id when no signature", () => {
    expect(encodeToolCallId("call_abc", undefined)).toBe("call_abc");
  });

  it("appends signature with || separator", () => {
    expect(encodeToolCallId("call_abc", "sig123")).toBe("call_abc||sig123");
  });

  it("works with long base64 signature", () => {
    const sig = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/==";
    const encoded = encodeToolCallId("call_xyz", sig);
    expect(encoded).toBe(`call_xyz||${sig}`);
  });
});

describe("decodeThoughtSignature", () => {
  it("returns undefined when no separator", () => {
    expect(decodeThoughtSignature("call_abc")).toBeUndefined();
  });

  it("extracts signature after first ||", () => {
    expect(decodeThoughtSignature("call_abc||sig123")).toBe("sig123");
  });

  it("handles signature that itself contains ||", () => {
    // base64 doesn't contain || but test robustness
    expect(decodeThoughtSignature("call_abc||sig||extra")).toBe("sig||extra");
  });

  it("round-trips correctly", () => {
    const sig = "base64SignatureValue==";
    const id = encodeToolCallId("call_uuid", sig);
    expect(decodeThoughtSignature(id)).toBe(sig);
  });

  it("round-trips when no signature", () => {
    const id = encodeToolCallId("call_uuid", undefined);
    expect(decodeThoughtSignature(id)).toBeUndefined();
  });
});
