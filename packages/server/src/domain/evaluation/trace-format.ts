import type { EvaluationTraceEntry } from "./trace.ts";

const MAX_EVIDENCE_LENGTH = 1500;

const truncate = (text: string): string =>
  text.length > MAX_EVIDENCE_LENGTH ? `${text.slice(0, MAX_EVIDENCE_LENGTH)}…[truncado]` : text;

const blockquote = (text: string): string =>
  text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

const formatEvidence = (entry: EvaluationTraceEntry): string => {
  if (entry.evidence.length === 0) {
    return "_Sin evidencia inyectada._";
  }

  const materialLabel = entry.materialId !== undefined
    ? `material \`${entry.materialId}\`, página${entry.pages.length > 1 ? "s" : ""} ${entry.pages.join(", ")}`
    : `página${entry.pages.length > 1 ? "s" : ""} ${entry.pages.join(", ")}`;

  const body = entry.evidence
    .map((page) => blockquote(truncate(page.text)))
    .join("\n\n");

  return `**Evidencia inyectada:** ${materialLabel}\n\n${body}`;
};

/** El pensamiento va **debajo** del veredicto y solo si existe con contenido: sin él la
 * salida debe ser byte a byte la de siempre. Blockquote, como la evidencia: es prosa
 * cruda del modelo, no texto del proyecto. */
const formatThought = (teacher: EvaluationTraceEntry["goodTeacher"]): string =>
  teacher.thought !== undefined && teacher.thought.trim().length > 0
    ? `\n\n**Reasoning:**\n\n${blockquote(teacher.thought)}`
    : "";

const formatTeacher = (title: string, teacher: EvaluationTraceEntry["goodTeacher"]): string =>
  teacher.status === "ok"
    ? `### ${title}\n${teacher.text}${formatThought(teacher)}`
    : `### ${title}\n_No disponible: ${teacher.reason}_${formatThought(teacher)}`;

const formatJudge = (judge: EvaluationTraceEntry["judge"]): string => {
  if ("failed" in judge) {
    return `### Juez\n_No disponible: ${judge.failed}_`;
  }

  return `### Juez
- \`is_correct\`: **${judge.is_correct}**
- \`feedback\`: ${judge.feedback}`;
};

const formatCitationsTable = (entry: EvaluationTraceEntry): string => {
  if (entry.citations.length === 0) {
    return "_Sin citas._";
  }

  const rows = entry.citations
    .map((citation) => `| "${citation.quote}" | ${citation.verified ? "✅" : "❌"} | ${citation.verified ? citation.page : "—"} |`)
    .join("\n");

  return `| Cita | Verificada | Página |\n|------|-----------|--------|\n${rows}`;
};

/**
 * Formatea la entrada de una pregunta como una sección Markdown. Función pura, sin
 * Effect: la eval del PR-08 debe poder comprobar el formato sin tocar disco.
 */
export const formatTraceEntry = (entry: EvaluationTraceEntry, timestamp: string): string => {
  const durationSeconds = (entry.durationMs / 1000).toFixed(1);

  const evidenceLine = entry.mode === "grounded"
    ? "- **Evidence: PDF page text**"
    : `- **Evidence: none (conceptual grading)${entry.ungroundedWhy !== undefined ? ` — why: ${entry.ungroundedWhy}` : ""}**`;

  return `## Pregunta \`${entry.questionId}\` — ${timestamp} — ${durationSeconds}s

**Enunciado:** ${entry.questionPrompt}
**Respuesta esperada:** ${entry.expectedAnswer}
**Respuesta del alumno:** ${entry.studentAnswer}

${formatEvidence(entry)}

${formatTeacher("Good Teacher", entry.goodTeacher)}

${formatTeacher("Bad Teacher", entry.badTeacher)}

${formatJudge(entry.judge)}

${formatCitationsTable(entry)}

### Resultado
- Nota determinista: ${entry.deterministicScore}
- Nota final: ${entry.finalScore}
- **Nota modificada por el panel: ${entry.scoreOverridden ? "sí" : "no"}**${
    entry.scoreOverridden
      ? ` (${entry.citations.filter((citation) => citation.verified).length} cita${entry.citations.filter((citation) => citation.verified).length === 1 ? "" : "s"} verificada${entry.citations.filter((citation) => citation.verified).length === 1 ? "" : "s"})`
      : ""
  }
${evidenceLine}
`;
};

export const formatTraceHeader = (attemptId: string, artifactId: string, timestamp: string): string =>
  `# Traza de evaluación — intento \`${attemptId}\`

- **attemptId:** ${attemptId}
- **artifactId:** ${artifactId}
- **Fecha:** ${timestamp}
`;
