import { Context, Effect, Layer, Stream } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import type { TutorChatRequest, TutorChatResponse, TutorChatStreamEvent } from "@proxus/shared";
import { ArtifactRepository } from "../../artifacts/artifact.ts";
import { MaterialRepository } from "../../materials/material.ts";
import { AgentSession } from "../harness/index.ts";
import { makeAcademicTutorHarness } from "../academic-tutor.ts";

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

export const TutorChatServiceLive = Layer.effect(
  TutorChatService,
  Effect.gen(function* () {
    const materialRepository = yield* MaterialRepository;
    const artifactRepository = yield* ArtifactRepository;

    const makeSession = Effect.gen(function* () {
      const materials = yield* materialRepository.list().pipe(
        Effect.orElseSucceed(() => [] as const)
      );
      const materialsContext = materials.length === 0
        ? "No PDF materials have been uploaded yet."
        : materials.map((m) => `- ${m.id}: "${m.title}" (${m.pageCount} pages)`).join("\n");
      const harness = makeAcademicTutorHarness(materialRepository, artifactRepository, materialsContext);
      return { harness, session: AgentSession.make(harness) };
    });

    const sessionInput = (input: TutorChatRequest) => ({
      input: input.input,
      messages: input.messages,
      maxSteps: input.maxSteps ?? 4
    });

    return {
      sendMessage: (input) => Effect.flatMap(makeSession, ({ harness, session }) =>
        session.run(sessionInput(input)).pipe(
          Effect.provide(harness.layer)
        )
      ),
      streamMessage: (input) => Stream.unwrap(
        Effect.map(makeSession, ({ harness, session }) =>
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
