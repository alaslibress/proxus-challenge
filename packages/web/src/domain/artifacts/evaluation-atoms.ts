import type { ArtifactAttempt, AttemptEvaluationStage } from "@proxus/shared";
import * as Atom from "effect/unstable/reactivity/Atom";

export type EvaluationRunState =
  | { readonly phase: "idle" }
  | {
      readonly phase: "running";
      readonly activeStages: readonly AttemptEvaluationStage[];
      readonly questionId: string;
      readonly questionIndex: number;
      readonly questionTotal: number;
    }
  | { readonly phase: "done"; readonly attempt: ArtifactAttempt }
  | { readonly phase: "error"; readonly message: string };

export const evaluationRunAtom = Atom.family((artifactId: string) =>
  Atom.make<EvaluationRunState>({ phase: "idle" })
);
