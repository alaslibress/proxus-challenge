import { describe, it, expect } from "vitest";
import { resolveFileNameCollision, sanitizeFileName } from "../material.ts";

describe("sanitizeFileName", () => {
  it("keeps an already clean name", () => {
    expect(sanitizeFileName("estadistica.pdf")).toBe("estadistica.pdf");
  });

  it("strips POSIX directory components", () => {
    expect(sanitizeFileName("../../etc/passwd.pdf")).toBe("passwd.pdf");
  });

  it("strips Windows directory components", () => {
    expect(sanitizeFileName("..\\..\\windows\\system32\\evil.pdf")).toBe("evil.pdf");
  });

  it("adds the extension when the name has none", () => {
    expect(sanitizeFileName("apuntes")).toBe("apuntes.pdf");
  });

  it("normalises the extension to lower case", () => {
    expect(sanitizeFileName("apuntes.PDF")).toBe("apuntes.pdf");
  });

  it("replaces characters the filesystem rejects", () => {
    expect(sanitizeFileName("tema 1: variables?.pdf")).toBe("tema 1- variables.pdf");
  });

  it("falls back to a default when nothing usable is left", () => {
    expect(sanitizeFileName("...")).toBe("material.pdf");
    expect(sanitizeFileName("")).toBe("material.pdf");
    expect(sanitizeFileName("///")).toBe("material.pdf");
  });

  it("never returns a name containing a separator", () => {
    for (const raw of ["a/b.pdf", "a\\b.pdf", "../x.pdf", "..\\x.pdf"]) {
      const sanitized = sanitizeFileName(raw);
      expect(sanitized).not.toContain("/");
      expect(sanitized).not.toContain("\\");
    }
  });
});

describe("resolveFileNameCollision", () => {
  it("returns the name untouched when it is free", () => {
    expect(resolveFileNameCollision("apuntes.pdf", new Set())).toBe("apuntes.pdf");
  });

  it("suffixes with -2 on the first collision", () => {
    const taken = new Set(["apuntes.pdf"]);
    expect(resolveFileNameCollision("apuntes.pdf", taken)).toBe("apuntes-2.pdf");
  });

  it("keeps counting while suffixed names are taken", () => {
    const taken = new Set(["apuntes.pdf", "apuntes-2.pdf"]);
    expect(resolveFileNameCollision("apuntes.pdf", taken)).toBe("apuntes-3.pdf");
  });

  it("compares case insensitively, since Windows paths are", () => {
    const taken = new Set(["apuntes.pdf"]);
    expect(resolveFileNameCollision("Apuntes.pdf", taken)).toBe("Apuntes-2.pdf");
  });
});
