import { describe, it, expect } from "vitest";
import { parseSseChunk } from "../gemini-sse.ts";

describe("parseSseChunk", () => {
  it("parses a single complete data event", () => {
    const { events, rest } = parseSseChunk("", "data: {\"x\":1}\n\n");
    expect(events).toEqual(["{\"x\":1}"]);
    expect(rest).toBe("");
  });

  it("splits two events separated by blank line", () => {
    const { events } = parseSseChunk("", "data: A\n\ndata: B\n\n");
    expect(events).toEqual(["A", "B"]);
  });

  it("handles \\r\\n line endings", () => {
    const { events, rest } = parseSseChunk("", "data: hello\r\n\r\n");
    expect(events).toEqual(["hello"]);
    expect(rest).toBe("");
  });

  it("ignores comment lines starting with ':'", () => {
    const { events } = parseSseChunk("", ": keep-alive\n\ndata: payload\n\n");
    expect(events).toEqual(["payload"]);
  });

  it("ignores unknown fields", () => {
    const { events } = parseSseChunk("", "id: 42\ndata: real\n\n");
    expect(events).toEqual(["real"]);
  });

  it("keeps incomplete event in rest", () => {
    const { events, rest } = parseSseChunk("", "data: complete\n\ndata: partial");
    expect(events).toEqual(["complete"]);
    expect(rest).toBe("data: partial");
  });

  it("reassembles a data: line split across two chunks", () => {
    const first = parseSseChunk("", "data: hel");
    expect(first.events).toEqual([]);
    expect(first.rest).toBe("data: hel");

    const second = parseSseChunk(first.rest, "lo\n\n");
    expect(second.events).toEqual(["hello"]);
    expect(second.rest).toBe("");
  });

  it("passes through [DONE] as an event (caller filters it)", () => {
    const { events } = parseSseChunk("", "data: [DONE]\n\n");
    expect(events).toEqual(["[DONE]"]);
  });
});
