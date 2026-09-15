import { describe, it, expect } from "vitest";
import { normalizeMath } from "../math.ts";

describe("normalizeMath", () => {
  it("converts inline \\(...\\) to $...$", () => {
    expect(normalizeMath("area \\(A = \\pi r^2\\) here")).toBe("area $A = \\pi r^2$ here");
  });

  it("converts display \\[...\\] to $$...$$", () => {
    expect(normalizeMath("formula \\[E = mc^2\\] end")).toBe("formula $$E = mc^2$$ end");
  });

  it("converts multiple formulas in one text", () => {
    const input = "\\(x\\) and \\[y\\] and \\(z\\)";
    expect(normalizeMath(input)).toBe("$x$ and $$y$$ and $z$");
  });

  it("leaves plain text untouched", () => {
    const text = "No formulas here. Just plain text.";
    expect(normalizeMath(text)).toBe(text);
  });

  it("leaves already correct $...$ untouched", () => {
    const text = "already $x + y$ correct";
    expect(normalizeMath(text)).toBe(text);
  });

  it("does not touch content inside fenced code blocks", () => {
    const input = "```python\nprint('\\(not math\\)')\n```";
    expect(normalizeMath(input)).toBe(input);
  });

  it("does not touch content inside inline code", () => {
    const input = "use `\\[escape\\]` syntax";
    expect(normalizeMath(input)).toBe(input);
  });

  it("converts outside code but not inside in mixed content", () => {
    const input = "\\(x\\) then `\\(no\\)` then \\(y\\)";
    expect(normalizeMath(input)).toBe("$x$ then `\\(no\\)` then $y$");
  });
});
