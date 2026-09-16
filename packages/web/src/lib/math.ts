/** Gemini escribe \( … \) y \[ … \]; remark-math solo entiende $ … $ y $$ … $$ */
export const normalizeMath = (text: string): string => {
  // Split on code fences and inline code to avoid rewriting math inside code blocks.
  // Odd-indexed chunks are code sections (fenced ``` or inline `); even-indexed are prose.
  const parts = text.split(/(```[\s\S]*?```|`[^`]*`)/);
  return parts
    .map((chunk, i) => {
      if (i % 2 === 1) return chunk; // inside code — leave untouched
      // In JS replacement strings, $$ → literal $. Use $$$$ to emit $$.
      return chunk
        .replace(/\\\[/g, "$$$$").replace(/\\\]/g, "$$$$")
        .replace(/\\\(/g, "$").replace(/\\\)/g, "$");
    })
    .join("");
};
