import { describe, it, expect } from "vitest";
import { emptyTranscript, type PanelTranscripts } from "../evaluation-atoms.ts";
import { appendDelta, transcriptFor } from "../transcripts.ts";

describe("appendDelta", () => {
  it("creates the question entry with the remaining fields empty", () => {
    const result = appendDelta({}, {
      questionId: "q1",
      agent: "good_teacher",
      channel: "thought",
      delta: "hmm"
    });

    expect(result["q1"]).toEqual({
      good_teacher: { thought: "hmm", text: "" },
      bad_teacher: { thought: "", text: "" }
    });
  });

  it("concatenates two deltas of the same agent and channel in order", () => {
    const first = appendDelta({}, {
      questionId: "q1", agent: "good_teacher", channel: "text", delta: "one "
    });
    const second = appendDelta(first, {
      questionId: "q1", agent: "good_teacher", channel: "text", delta: "two"
    });

    expect(second["q1"]?.good_teacher.text).toBe("one two");
  });

  it("does not mix interleaved good_teacher and bad_teacher deltas", () => {
    let state: PanelTranscripts = {};
    state = appendDelta(state, { questionId: "q1", agent: "good_teacher", channel: "thought", delta: "G1" });
    state = appendDelta(state, { questionId: "q1", agent: "bad_teacher", channel: "thought", delta: "B1" });
    state = appendDelta(state, { questionId: "q1", agent: "good_teacher", channel: "thought", delta: "G2" });
    state = appendDelta(state, { questionId: "q1", agent: "bad_teacher", channel: "text", delta: "B-text" });

    expect(state["q1"]?.good_teacher).toEqual({ thought: "G1G2", text: "" });
    expect(state["q1"]?.bad_teacher).toEqual({ thought: "B1", text: "B-text" });
  });

  it("a delta of a new question does not erase the previous one", () => {
    const first = appendDelta({}, {
      questionId: "q1", agent: "good_teacher", channel: "text", delta: "first answer"
    });
    const second = appendDelta(first, {
      questionId: "q2", agent: "bad_teacher", channel: "text", delta: "second answer"
    });

    expect(second["q1"]?.good_teacher.text).toBe("first answer");
    expect(second["q2"]?.bad_teacher.text).toBe("second answer");
    expect(Object.keys(second)).toEqual(["q1", "q2"]);
  });

  it("does not mutate the input object", () => {
    const before: PanelTranscripts = {};
    const after = appendDelta(before, {
      questionId: "q1", agent: "good_teacher", channel: "text", delta: "x"
    });

    expect(after).not.toBe(before);
    expect(before).toEqual({});
  });
});

describe("transcriptFor", () => {
  it("returns emptyTranscript for an unknown questionId", () => {
    expect(transcriptFor({}, "nope")).toBe(emptyTranscript);
  });
});
