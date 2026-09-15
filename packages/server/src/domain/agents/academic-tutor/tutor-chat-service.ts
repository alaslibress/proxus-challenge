import { Context, Effect, Layer, Stream } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import type { TutorChatRequest, TutorChatResponse, TutorChatStreamEvent } from "@proxus/shared";
import { ArtifactRepository } from "../../artifacts/artifact.ts";
import { MaterialRepository } from "../../materials/material.ts";
import { AgentSession } from "../harness/index.ts";
import { makeAcademicTutorHarness } from "../academic-tutor.ts";
import { buildOpenExerciseContext } from "./artifact-context.ts";

export interface TutorChatService {
  readonly sendMessage: (
    input: TutorChatRequest
  ) => Effect.Effect<TutorChatResponse, unknown, LanguageModel.LanguageModel>;
  readonly streamMessage: (
    input: TutorChatRequest
  ) => Stream.Stream<TutorChatStreamEvent, unknown, LanguageModel.LanguageModel>;
}

export const TutorChatService = Context.Service<TutorChatService>(
  "@proxus/server/agents/academic-tutor/TutorChatService"
);

export const buildMaterialsContext = (
  materials: ReadonlyArray<{ readonly id: string; readonly title: string; readonly pageCount: number }>
): string =>
  materials.length === 0
    ? "No PDF materials have been uploaded yet."
    : materials.map((m) => `- ${m.id}: "${m.title}" (${m.pageCount} pages)`).join("\n");

export const TutorChatServiceLive = Layer.effect(
  TutorChatService,
  Effect.gen(function* () {
    const materialRepository = yield* MaterialRepository;
    const artifactRepository = yield* ArtifactRepository;

    const makeSession = (input: TutorChatRequest) => Effect.gen(function* () {
      const materials = yield* materialRepository.list().pipe(
        Effect.orElseSucceed(() => [] as const)
      );

      const ref = input.openExercise;
      const artifact = ref === undefined
        ? undefined
        : yield* artifactRepository.getArtifact(ref.artifactId).pipe(
            Effect.orElseSucceed(() => undefined)
          );

      const attempt = ref?.attemptId === undefined || artifact === undefined
        ? undefined
        : yield* artifactRepository.getAttempt(ref.attemptId).pipe(
            Effect.orElseSucceed(() => undefined)
          ).pipe(
            // Discard the attempt if it does not belong to the artifact.
            Effect.map((a) => (a !== undefined && a.artifactId === artifact.id ? a : undefined))
          );

      const harness = makeAcademicTutorHarness(
        materialRepository,
        artifactRepository,
        buildMaterialsContext(materials),
        buildOpenExerciseContext(artifact, attempt)
      );
      return { harness, session: AgentSession.make(harness) };
    });

    const sessionInput = (input: TutorChatRequest) => ({
      input: input.input,
      messages: input.messages,
      // A materials-backed request costs two `load_skill` calls, one or two `materials text`
      // calls and one `artifacts create` before the tutor can even start writing. PR-11 set
      // this to 4 for latency, which made those flows structurally impossible to finish.
      maxSteps: input.maxSteps ?? 8
    });

    return {
      sendMessage: (input) => Effect.flatMap(makeSession(input), ({ harness, session }) =>
        session.run(sessionInput(input)).pipe(
          Effect.provide(harness.layer)
        )
      ),
      streamMessage: (input) => Stream.unwrap(
        Effect.map(makeSession(input), ({ harness, session }) =>
          session.stream(sessionInput(input)).pipe(
            Stream.map((message): TutorChatStreamEvent => ({ type: "message", message })),
            Stream.concat(Stream.succeed({ type: "done" as const })),
            Stream.provide(harness.layer)
          )
        )
      )
    };
  })
);
