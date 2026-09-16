import { describe, it, expect } from "vitest";
import {
  goodTeacherSystemPrompt,
  badTeacherSystemPrompt,
  judgeSystemPrompt
} from "../prompts.ts";

const MODES = ["grounded", "ungrounded"] as const;
const ALL_PROMPTS = MODES.flatMap((mode) => [
  goodTeacherSystemPrompt(mode),
  badTeacherSystemPrompt(mode),
  judgeSystemPrompt(mode)
]);

describe("system prompts — language rule", () => {
  it("no prompt contains 'in English'", () => {
    for (const prompt of ALL_PROMPTS) {
      expect(prompt).not.toContain("in English");
    }
  });

  it("every prompt contains the language rule text", () => {
    for (const prompt of ALL_PROMPTS) {
      expect(prompt).toContain("Write in the same language as the question");
    }
  });
});
