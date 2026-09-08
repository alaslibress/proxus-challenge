import { describe, it, expect } from "vitest";
import type { PdfCitation } from "@proxus/shared";
import { formatTraceEntry, formatTraceHeader } from "../trace-format.ts";
import type { EvaluationTraceEntry } from "../trace.ts";

const TIMESTAMP = "2026-09-08T10:00:00.000Z";

const baseEntry: EvaluationTraceEntry = {
  attemptId: "attempt-1",
  artifactId: "artifact-1",
  questionId: "q1",
  questionPrompt: "¿Qué es la fotosíntesis?",
  expectedAnswer: "El proceso por el que las plantas producen energía a partir de la luz.",
  studentAnswer: "Las plantas usan la luz para producir energía.",
  materialId: "mat-1",
  pages: [1],
  evidence: [{ page: 1, text: "La fotosíntesis convierte luz solar en energía química." }],
  goodTeacher: { ok: true, text: "Buen enfoque." },
  badTeacher: { ok: true, text: "Falta precisión." },
  judge: { is_correct: true, feedback: "Correcta con matices.", citas_pdf: ["convierte luz solar"] },
  citations: [
    { materialId: "mat-1", page: 1, quote: "convierte luz solar", verified: true }
  ],
  deterministicScore: 3,
  finalScore: 10,
  scoreOverridden: true,
  durationMs: 1234
};

const entry = (overrides: Partial<EvaluationTraceEntry>): EvaluationTraceEntry => ({
  ...baseEntry,
  ...overrides
});

const citation = (overrides: Partial<PdfCitation>): PdfCitation => ({
  materialId: "mat-1",
  page: 1,
  quote: "convierte luz solar",
  verified: true,
  ...overrides
});

describe("formatTraceEntry — cabecera y datos de la pregunta", () => {
  it("includes the question id, timestamp and duration in seconds", () => {
    const output = formatTraceEntry(baseEntry, TIMESTAMP);

    expect(output).toContain(`## Pregunta \`q1\` — ${TIMESTAMP} — 1.2s`);
    expect(output).toContain("**Enunciado:** ¿Qué es la fotosíntesis?");
    expect(output).toContain("**Respuesta del alumno:** Las plantas usan la luz para producir energía.");
  });
});

describe("formatTraceEntry — profes y juez caídos", () => {
  it("renders a fallen teacher as _No disponible: <razón>_", () => {
    const output = formatTraceEntry(
      entry({ goodTeacher: { ok: false, reason: "timeout del modelo" } }),
      TIMESTAMP
    );

    expect(output).toContain("### Profe Bueno\n_No disponible: timeout del modelo_");
    expect(output).toContain("### Profe Malo\nFalta precisión.");
  });

  it("renders a fallen judge without the is_correct / feedback lines", () => {
    const output = formatTraceEntry(
      entry({ judge: { failed: "panel no disponible" } }),
      TIMESTAMP
    );

    expect(output).toContain("### Juez\n_No disponible: panel no disponible_");
    expect(output).not.toContain("`is_correct`");
    expect(output).not.toContain("`feedback`");
  });

  it("renders a healthy judge with is_correct and feedback", () => {
    const output = formatTraceEntry(baseEntry, TIMESTAMP);

    expect(output).toContain("- `is_correct`: **true**");
    expect(output).toContain("- `feedback`: Correcta con matices.");
  });
});

describe("formatTraceEntry — evidencia", () => {
  it("says _Sin evidencia inyectada._ when there is no evidence", () => {
    const output = formatTraceEntry(entry({ evidence: [] }), TIMESTAMP);

    expect(output).toContain("_Sin evidencia inyectada._");
    expect(output).not.toContain("**Evidencia inyectada:**");
  });

  it("labels the material and page in singular for one page", () => {
    const output = formatTraceEntry(baseEntry, TIMESTAMP);

    expect(output).toContain("**Evidencia inyectada:** material `mat-1`, página 1");
  });

  it("labels pages in plural for more than one page", () => {
    const output = formatTraceEntry(entry({ pages: [1, 2] }), TIMESTAMP);

    expect(output).toContain("**Evidencia inyectada:** material `mat-1`, páginas 1, 2");
  });

  it("omits the material label when there is no materialId", () => {
    const output = formatTraceEntry(entry({ materialId: undefined }), TIMESTAMP);

    expect(output).toContain("**Evidencia inyectada:** página 1");
    expect(output).not.toContain("material `");
  });

  it("renders the evidence as a blockquote, one '> ' per line", () => {
    const output = formatTraceEntry(
      entry({ evidence: [{ page: 1, text: "primera línea\nsegunda línea" }] }),
      TIMESTAMP
    );

    expect(output).toContain("> primera línea\n> segunda línea");
  });

  it("truncates evidence longer than 1500 characters", () => {
    const text = "a".repeat(1501);
    const output = formatTraceEntry(entry({ evidence: [{ page: 1, text }] }), TIMESTAMP);

    expect(output).toContain(`> ${"a".repeat(1500)}…[truncado]`);
    expect(output).not.toContain("a".repeat(1501));
  });

  it("does NOT truncate evidence of exactly 1500 characters", () => {
    const text = "b".repeat(1500);
    const output = formatTraceEntry(entry({ evidence: [{ page: 1, text }] }), TIMESTAMP);

    expect(output).toContain(`> ${text}`);
    expect(output).not.toContain("…[truncado]");
  });
});

describe("formatTraceEntry — tabla de citas", () => {
  it("says _Sin citas._ when the judge cited nothing", () => {
    const output = formatTraceEntry(entry({ citations: [] }), TIMESTAMP);

    expect(output).toContain("_Sin citas._");
    expect(output).not.toContain("| Cita | Verificada | Página |");
  });

  it("quotes the citation and shows ✅ plus the page when verified", () => {
    const output = formatTraceEntry(
      entry({ citations: [citation({ page: 7, quote: "luz solar", verified: true })] }),
      TIMESTAMP
    );

    expect(output).toContain("| Cita | Verificada | Página |");
    expect(output).toContain('| "luz solar" | ✅ | 7 |');
  });

  it("shows ❌ and an em dash in the page column when the citation is not verified", () => {
    const output = formatTraceEntry(
      entry({
        citations: [citation({ page: 0, quote: "cita inventada", verified: false })],
        scoreOverridden: false
      }),
      TIMESTAMP
    );

    expect(output).toContain('| "cita inventada" | ❌ | — |');
  });
});

describe("formatTraceEntry — resultado y plural del recuento de citas", () => {
  it("reports the scores and that the panel did not override them", () => {
    const output = formatTraceEntry(
      entry({ deterministicScore: 3, finalScore: 3, scoreOverridden: false }),
      TIMESTAMP
    );

    expect(output).toContain("- Nota determinista: 3");
    expect(output).toContain("- Nota final: 3");
    expect(output).toContain("**Nota modificada por el panel: no**");
    expect(output).not.toContain("verificada");
  });

  it("uses the singular form for exactly one verified citation", () => {
    const output = formatTraceEntry(
      entry({
        scoreOverridden: true,
        citations: [
          citation({ verified: true }),
          citation({ quote: "otra", verified: false })
        ]
      }),
      TIMESTAMP
    );

    expect(output).toContain("**Nota modificada por el panel: sí** (1 cita verificada)");
  });

  it("uses the plural form for two verified citations", () => {
    const output = formatTraceEntry(
      entry({
        scoreOverridden: true,
        citations: [
          citation({ verified: true }),
          citation({ quote: "otra", page: 2, verified: true })
        ]
      }),
      TIMESTAMP
    );

    expect(output).toContain("**Nota modificada por el panel: sí** (2 citas verificadas)");
  });

  it("counts only the verified citations, not every citation", () => {
    const output = formatTraceEntry(
      entry({
        scoreOverridden: true,
        citations: [
          citation({ verified: true }),
          citation({ quote: "b", verified: false }),
          citation({ quote: "c", verified: false })
        ]
      }),
      TIMESTAMP
    );

    expect(output).toContain("(1 cita verificada)");
  });
});

describe("formatTraceHeader", () => {
  it("includes the attemptId, artifactId and date", () => {
    const output = formatTraceHeader("attempt-1", "artifact-1", TIMESTAMP);

    expect(output).toContain("# Traza de evaluación — intento `attempt-1`");
    expect(output).toContain("- **attemptId:** attempt-1");
    expect(output).toContain("- **artifactId:** artifact-1");
    expect(output).toContain(`- **Fecha:** ${TIMESTAMP}`);
  });
});
