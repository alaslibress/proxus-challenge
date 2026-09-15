import type { PanelStatus } from "@proxus/shared";

export interface PanelStatusDisplay {
  readonly icon: string;
  readonly label: string;
  readonly detail: string;
}

export function describePanelStatus(panel: PanelStatus | undefined): PanelStatusDisplay | undefined {
  if (panel === undefined) return undefined;

  if (!panel.ran) {
    return {
      icon: "⚠️",
      label: "Advanced reasoning unavailable · automatic mark stands",
      detail: "The panel did not run. The score shown is the deterministic result."
    };
  }

  if (panel.grounded) {
    return {
      icon: "📄",
      label: "Advanced reasoning · grounded in the PDF",
      detail: "The panel read the source PDF pages to assess this answer."
    };
  }

  const why = panel.why;
  let detail: string;
  switch (why) {
    case "no-source":
      detail = "the artifact does not record which material it came from";
      break;
    case "no-pages":
      detail = "no pages were linked to this question";
      break;
    case "extract-failed":
      detail = "the PDF text could not be read";
      break;
    case "empty-pages":
      detail = "the linked pages contain no extractable text";
      break;
  }

  return {
    icon: "📋",
    label: "Advanced reasoning · no PDF evidence",
    detail
  };
}
