import { AgentSkill } from "../../harness/index.ts";

export const UseUploadedMaterialsSkill = AgentSkill.make({
  name: "use-uploaded-materials",
  description: "Render exact page ranges of an already-identified uploaded PDF as images. Only for questions that depend on what a specific PDF says.",
  content: [
    "# Use uploaded materials",
    "",
    "Use this skill when the answer depends on what a specific PDF actually says.",
    "",
    "Available CLI commands:",
    "- `materials view <materialId> <pages>`: render selected pages as images.",
    "- `materials text <materialId> <pages>`: extract the literal text of selected pages.",
    "",
    "The page selection format supports:",
    "- one page: `10`",
    "- a range: `13-20`",
    "- a mixed selection: `10,13-20`",
    "",
    "When to use which:",
    "- Use `materials text` as the source for literal quoting: any time you need to copy an",
    "  exact sentence or phrase from the PDF (for example a `sourcePage` citation), pull it",
    "  from `materials text`, not from what you think you saw in an image.",
    "- Use `materials view` for diagrams, formulas, tables, and scanned pages: anything the",
    "  text layer cannot represent.",
    "- If `materials text` comes back empty for a page, that page has no extractable text",
    "  (often a scan). Fall back to `materials view` to read it, and tell the user that page",
    "  cannot be quoted literally.",
    "",
    "Workflow:",
    "1. Take the material id from the inventory in your system prompt.",
    "2. When the user asks about a PDF or page range, extract text with `materials text` first;",
    "   use `materials view` when you need to see the page visually or the text is empty.",
    "3. Treat the extracted text or rendered pages as the source of truth.",
    "4. If neither contains enough evidence, say so clearly.",
    "5. When explaining, cite page numbers from the result you used."
  ].join("\n")
});
