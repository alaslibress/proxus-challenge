import type { PdfCitation } from "@proxus/shared";
import type { PageText } from "./material.ts";

// Sin Effect: funciones puras, para que la eval del PR-08 las pruebe sin layers ni API key.

export const normalizeForMatch = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // diacriticos
    .replace(/\u00ad/g, "") // soft hyphen
    .replace(/-\s*\n\s*/g, "") // palabra partida al final de linea
    .replace(/\s+/g, " ") // colapsar espacio en blanco
    .trim()
    .toLowerCase();

export const MIN_QUOTE_LENGTH = 12;

export const verifyQuote = (
  quote: string,
  pages: readonly PageText[]
): { readonly verified: boolean; readonly page: number | null } => {
  const normalizedQuote = normalizeForMatch(quote);

  if (normalizedQuote.length < MIN_QUOTE_LENGTH) {
    return { verified: false, page: null };
  }

  const matchingPage = pages.find((page) => normalizeForMatch(page.text).includes(normalizedQuote));

  return matchingPage === undefined
    ? { verified: false, page: null }
    : { verified: true, page: matchingPage.page };
};

export const verifyCitations = (
  quotes: readonly string[],
  pages: readonly PageText[],
  materialId: string
): readonly PdfCitation[] =>
  quotes.map((quote) => {
    const { verified, page } = verifyQuote(quote, pages);
    return {
      materialId,
      page: page ?? 0,
      quote,
      verified
    };
  });
