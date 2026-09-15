import type { OpenExerciseRef } from "@proxus/shared";
import * as Atom from "effect/unstable/reactivity/Atom";

export const openExerciseAtom = Atom.make<OpenExerciseRef | null>(null);
