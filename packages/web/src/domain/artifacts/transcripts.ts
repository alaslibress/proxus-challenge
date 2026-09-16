import type { PanelAgent } from "@proxus/shared";
import {
  emptyTranscript,
  type PanelTranscript,
  type PanelTranscripts
} from "./evaluation-atoms.ts";

/** Acumula un delta de razonamiento en la pregunta a la que pertenece.
 * Crea la entrada de la pregunta si es la primera vez que se la ve. */
export const appendDelta = (
  transcripts: PanelTranscripts,
  event: {
    readonly questionId: string;
    readonly agent: PanelAgent;
    readonly channel: "thought" | "text";
    readonly delta: string;
  }
): PanelTranscripts => {
  const current = transcripts[event.questionId] ?? emptyTranscript;
  const agentTranscript = current[event.agent];
  return {
    ...transcripts,
    [event.questionId]: {
      ...current,
      [event.agent]: {
        ...agentTranscript,
        [event.channel]: agentTranscript[event.channel] + event.delta
      }
    }
  };
};

/** El transcript de una pregunta, o `emptyTranscript` si aún no hay nada. */
export const transcriptFor = (
  transcripts: PanelTranscripts,
  questionId: string
): PanelTranscript => transcripts[questionId] ?? emptyTranscript;
