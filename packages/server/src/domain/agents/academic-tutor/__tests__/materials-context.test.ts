import { describe, it, expect } from "vitest";
import { buildMaterialsContext } from "../tutor-chat-service.ts";

describe("buildMaterialsContext", () => {
  it("returns no-materials message for empty array", () => {
    expect(buildMaterialsContext([])).toBe("No PDF materials have been uploaded yet.");
  });

  it("formats a single material correctly", () => {
    const result = buildMaterialsContext([{ id: "abc123", title: "Calculus Notes", pageCount: 42 }]);
    expect(result).toBe('- abc123: "Calculus Notes" (42 pages)');
  });

  it("formats multiple materials as separate lines", () => {
    const materials = [
      { id: "m1", title: "First", pageCount: 5 },
      { id: "m2", title: "Second", pageCount: 10 }
    ];
    const result = buildMaterialsContext(materials);
    expect(result).toBe('- m1: "First" (5 pages)\n- m2: "Second" (10 pages)');
  });

  it("handles titles with special characters", () => {
    const result = buildMaterialsContext([{ id: "x", title: 'Say "hello" & goodbye', pageCount: 1 }]);
    expect(result).toBe('- x: "Say "hello" & goodbye" (1 pages)');
  });

  it("1 page uses singular form text as-is (format shows pages not page)", () => {
    const result = buildMaterialsContext([{ id: "y", title: "Short", pageCount: 1 }]);
    expect(result).toContain("(1 pages)");
  });
});
