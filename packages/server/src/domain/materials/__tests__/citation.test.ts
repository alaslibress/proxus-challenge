import { describe, it, expect } from "vitest";
import { MIN_QUOTE_LENGTH, normalizeForMatch, verifyCitations, verifyQuote } from "../citation.ts";
import type { PageText } from "../material.ts";

const pages: readonly PageText[] = [
  { page: 1, text: "El teorema de Pitagoras relaciona los catetos con la hipotenusa." },
  { page: 2, text: "La deri-\nvada de una funcion constante es cero." },
  { page: 3, text: "   " }
];

describe("normalizeForMatch", () => {
  it("strips diacritics", () => {
    expect(normalizeForMatch("Pitágoras")).toBe("pitagoras");
  });

  it("collapses whitespace runs to a single space", () => {
    expect(normalizeForMatch("hola   \t  mundo")).toBe("hola mundo");
  });

  it("lowercases and trims", () => {
    expect(normalizeForMatch("  HOLA Mundo  ")).toBe("hola mundo");
  });

  it("joins a word split across a line break by a hyphen", () => {
    expect(normalizeForMatch("deri-\nvada")).toBe("derivada");
  });

  it("removes soft hyphens", () => {
    expect(normalizeForMatch("deri­vada")).toBe("derivada");
  });
});

describe("verifyQuote", () => {
  it("verifies a quote copied literally, returning the matching page", () => {
    expect(verifyQuote("teorema de Pitagoras", pages)).toEqual({ verified: true, page: 1 });
  });

  it("verifies regardless of whitespace/case differences from the source", () => {
    expect(verifyQuote("TEOREMA   DE   pitagoras", pages)).toEqual({ verified: true, page: 1 });
  });

  it("verifies a quote split across a line break/hyphen in the source", () => {
    expect(verifyQuote("la derivada de una funcion", pages)).toEqual({ verified: true, page: 2 });
  });

  it("does not verify an invented quote of similar length", () => {
    const result = verifyQuote("el teorema de Newton", pages);
    expect(result.verified).toBe(false);
    expect(result.page).toBeNull();
  });

  it("returns the first matching page, not a later one", () => {
    const multi: readonly PageText[] = [
      { page: 1, text: "shared phrase here" },
      { page: 2, text: "shared phrase here too" }
    ];
    expect(verifyQuote("shared phrase here", multi)).toEqual({ verified: true, page: 1 });
  });

  describe("MIN_QUOTE_LENGTH boundary", () => {
    it("MIN_QUOTE_LENGTH is 12", () => {
      expect(MIN_QUOTE_LENGTH).toBe(12);
    });

    it("rejects a quote normalizing to 11 characters even if present verbatim", () => {
      const elevenChars: readonly PageText[] = [{ page: 1, text: "abcdefghijk more text after" }];
      expect(normalizeForMatch("abcdefghijk").length).toBe(11);
      expect(verifyQuote("abcdefghijk", elevenChars)).toEqual({ verified: false, page: null });
    });

    it("accepts a quote normalizing to exactly 12 characters when present", () => {
      const twelveChars: readonly PageText[] = [{ page: 1, text: "abcdefghijkl more text after" }];
      expect(normalizeForMatch("abcdefghijkl").length).toBe(12);
      expect(verifyQuote("abcdefghijkl", twelveChars)).toEqual({ verified: true, page: 1 });
    });

    it("rejects a too-short quote even when it does not appear at all", () => {
      expect(verifyQuote("nope", pages)).toEqual({ verified: false, page: null });
    });
  });

  describe("empty and whitespace-only quotes", () => {
    it("rejects an empty string", () => {
      expect(verifyQuote("", pages)).toEqual({ verified: false, page: null });
    });

    it("rejects a whitespace-only string", () => {
      expect(verifyQuote("            ", pages)).toEqual({ verified: false, page: null });
    });
  });

  it("does not verify against a page with only blank text", () => {
    const result = verifyQuote("some long enough quote text", [{ page: 3, text: "   " }]);
    expect(result).toEqual({ verified: false, page: null });
  });

  it("is idempotent across repeated calls with the same input", () => {
    const first = verifyQuote("teorema de Pitagoras", pages);
    const second = verifyQuote("teorema de Pitagoras", pages);
    const third = verifyQuote("teorema de Pitagoras", pages);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });
});

describe("verifyCitations", () => {
  it("returns one PdfCitation per input quote, none dropped", () => {
    const quotes = ["teorema de Pitagoras", "invented quote here", "short"];
    const result = verifyCitations(quotes, pages, "material-1");
    expect(result).toHaveLength(quotes.length);
  });

  it("marks unverifiable quotes as verified: false instead of discarding them", () => {
    const result = verifyCitations(["completely invented phrase"], pages, "material-1");
    expect(result[0]).toMatchObject({ quote: "completely invented phrase", verified: false, materialId: "material-1" });
  });

  it("fills in the matched page for verified quotes and 0 for unverified ones", () => {
    const result = verifyCitations(["teorema de Pitagoras", "nope"], pages, "material-1");
    expect(result[0]).toMatchObject({ verified: true, page: 1 });
    expect(result[1]).toMatchObject({ verified: false, page: 0 });
  });

  it("handles an empty quotes array", () => {
    expect(verifyCitations([], pages, "material-1")).toEqual([]);
  });

  it("preserves quote order and the exact original quote text", () => {
    const quotes = ["b", "teorema de Pitagoras", "a"];
    const result = verifyCitations(quotes, pages, "material-1");
    expect(result.map((c) => c.quote)).toEqual(quotes);
  });
});
