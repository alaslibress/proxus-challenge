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
    "",
    "The page selection format supports:",
    "- one page: `10`",
    "- a range: `13-20`",
    "- a mixed selection: `10,13-20`",
    "",
    "Workflow:",
    "1. Take the material id from the inventory in your system prompt.",
    "2. When the user asks about a PDF or page range, render the smallest useful page range with `materials view`.",
    "3. Treat rendered pages as the source of truth.",
    "4. If the rendered pages do not contain enough evidence, say so clearly.",
    "5. When explaining, cite page numbers from the rendered result."
  ].join("\n")
});
