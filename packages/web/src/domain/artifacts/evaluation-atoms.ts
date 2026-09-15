import type { ArtifactAttempt, AttemptEvaluationStage, PanelAgent } from "@proxus/shared";
import * as Atom from "effect/unstable/reactivity/Atom";

export type PanelTranscript = Readonly<Record<PanelAgent, {
  readonly thought: string;
  readonly text: string;
}>>;

export const emptyTranscript: PanelTranscript = {
  good_teacher: { thought: "", text: "" },
  bad_teacher: { thought: "", text: "" }
};

export type EvaluationRunState =
  | { readonly phase: "idle" }
  | {
      readonly phase: "running";
      readonly activeStages: readonly AttemptEvaluationStage[];
      readonly questionId: string;
      readonly questionIndex: number;
      readonly questionTotal: number;
      readonly transcript: PanelTranscript;
    }
  | { readonly phase: "done"; readonly attempt: ArtifactAttempt }
  | { readonly phase: "error"; readonly message: string };

export const evaluationRunAtom = Atom.family((artifactId: string) =>
  Atom.make<EvaluationRunState>({ phase: "idle" })
);
