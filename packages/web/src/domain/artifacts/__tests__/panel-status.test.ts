import { describe, it, expect } from "vitest";
import { describePanelStatus } from "../panel-status.ts";

describe("describePanelStatus", () => {
  it("returns undefined when panel is undefined", () => {
    expect(describePanelStatus(undefined)).toBeUndefined();
  });

  it("ran: false → unavailable icon and label", () => {
    const result = describePanelStatus({ ran: false, why: "judge-unavailable" });
    expect(result?.icon).toBe("⚠️");
    expect(result?.label).toContain("unavailable");
  });

  it("ran: true, grounded: true → grounded icon and label", () => {
    const result = describePanelStatus({ ran: true, grounded: true });
    expect(result?.icon).toBe("📄");
    expect(result?.label).toContain("grounded");
  });

  it("ran: true, grounded: false, why: 'no-source' → detail mentions material", () => {
    const result = describePanelStatus({ ran: true, grounded: false, why: "no-source" });
    expect(result?.icon).toBe("📋");
    expect(result?.detail).toContain("material");
  });

  it("ran: true, grounded: false, why: 'no-pages' → detail mentions pages", () => {
    const result = describePanelStatus({ ran: true, grounded: false, why: "no-pages" });
    expect(result?.detail).toContain("pages");
  });

  it("ran: true, grounded: false, why: 'extract-failed' → detail mentions PDF", () => {
    const result = describePanelStatus({ ran: true, grounded: false, why: "extract-failed" });
    expect(result?.detail).toContain("PDF");
  });

  it("ran: true, grounded: false, why: 'empty-pages' → detail mentions extractable", () => {
    const result = describePanelStatus({ ran: true, grounded: false, why: "empty-pages" });
    expect(result?.detail).toContain("extractable");
  });
});
