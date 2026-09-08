import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { ProxusApi } from "@proxus/shared";
import { TutorChatService } from "../../domain/agents/academic-tutor/tutor-chat-service.ts";
import { type Artifact } from "@proxus/shared";
import { ArtifactRepository } from "../../domain/artifacts/artifact.ts";
import { MaterialRepository } from "../../domain/materials/material.ts";
import { reviewGradedAttempt } from "../../domain/evaluation/review.ts";
import { withUploadedFile } from "./upload.ts";

export const TutorHttpHandlers = HttpApiBuilder.group(
  ProxusApi,
  "tutor",
  Effect.fn(function* (handlers) {
    const tutor = yield* TutorChatService;

    return handlers.handle("chat", ({ payload }) =>
      tutor.sendMessage(payload).pipe(Effect.orDie)
    );
  })
);

export const MaterialsHttpHandlers = HttpApiBuilder.group(
  ProxusApi,
  "materials",
  Effect.fn(function* (handlers) {
    const materials = yield* MaterialRepository;

    return handlers
      .handle("list", () => materials.list().pipe(
        Effect.map((items) => ({ materials: items })),
        Effect.orDie
      ))
      .handle("get", ({ params }) => materials.get(params.id).pipe(Effect.orDie))
      .handle("delete", ({ params }) =>
        materials.delete(params.id).pipe(
          Effect.catchTag("MaterialNotFound", (e) =>
            Effect.fail({ _tag: "MaterialNotFound" as const, materialId: e.materialId })
          ),
          Effect.catchTag("MaterialRepositoryError", (e) => Effect.die(e))
        )
      )
      .handle("upload", ({ payload }) =>
        withUploadedFile(payload, (file) => materials.save(file)).pipe(
          Effect.catchTag("InvalidPdf", (e) =>
            Effect.fail({ _tag: "InvalidPdf" as const, message: e.message })
          ),
          Effect.catchTag("MaterialRepositoryError", (e) => Effect.die(e))
        )
      );
  })
);

const artifactSummary = (artifact: Artifact) => ({
  id: artifact.id,
  kind: artifact.kind,
  title: artifact.title
});

export const ArtifactsHttpHandlers = HttpApiBuilder.group(
  ProxusApi,
  "artifacts",
  Effect.fn(function* (handlers) {
    const artifacts = yield* ArtifactRepository;

    return handlers
      .handle("list", ({ query }) => artifacts.listArtifacts({ kind: query.kind }).pipe(
        Effect.map((items) => ({ artifacts: items.map(artifactSummary) })),
        Effect.orDie
      ))
      .handle("get", ({ params }) => artifacts.getArtifact(params.id).pipe(Effect.orDie))
      .handle("submit", ({ params, payload }) => artifacts.submitAttempt({
        ...payload,
        artifactId: params.id
      }).pipe(
        Effect.flatMap((attempt) => artifacts.gradeAttempt(attempt.id)),
        Effect.flatMap((graded) => Effect.flatMap(
          artifacts.getArtifact(graded.artifactId),
          (artifact) => reviewGradedAttempt(artifact, graded)
        )),
        Effect.tap((reviewed) => artifacts.saveAttempt(reviewed)),
        Effect.orDie
      ));
  })
);

export const HttpHandlersLive = Layer.mergeAll(
  TutorHttpHandlers,
  MaterialsHttpHandlers,
  ArtifactsHttpHandlers
);
