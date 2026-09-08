import { Effect, Layer, Schema, Stream } from "effect";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { createServer } from "node:http";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";
import { LanguageModel } from "effect/unstable/ai";
import { AttemptStreamEvent, ProxusApi, SubmitAttemptInput, TutorChatRequest, TutorChatStreamEvent } from "@proxus/shared";
import { GeminiModel } from "../../domain/agents/gemini.ts";
import { TutorChatService, TutorChatServiceLive } from "../../domain/agents/academic-tutor/tutor-chat-service.ts";
import { EvaluationEngineService, EvaluationEngineServiceLive } from "../../domain/evaluation/engine.ts";
import { reviewGradedAttemptStreaming } from "../../domain/evaluation/review.ts";
import { EvaluationTrace } from "../../domain/evaluation/trace.ts";
import { ArtifactRepository } from "../../domain/artifacts/artifact.ts";
import { MaterialRepository } from "../../domain/materials/material.ts";
import { FileArtifactRepository } from "../../infra/artifacts/file-artifact-repository.ts";
import { FileMaterialRepository } from "../../infra/materials/file-material-repository.ts";
import { FileEvaluationTrace } from "../../infra/evaluation/file-evaluation-trace.ts";
import { PopplerPdfService } from "../../infra/materials/poppler-pdf-service.ts";
import { HttpHandlersLive } from "./handlers.ts";

const ApiRoutes = HttpApiBuilder.layer(ProxusApi, {
  openapiPath: "/openapi.json"
}).pipe(
  Layer.provide(HttpHandlersLive)
);

const DocsRoute = HttpApiScalar.layer(ProxusApi, {
  path: "/docs"
});

const encoder = new TextEncoder();

// A frame that fails to encode must not tumble the whole stream: emit an `error` frame
// in its place instead. This is the server half of the ADR-02 resilience contract; the
// client half lives in packages/web/src/lib/ndjson.ts.
const makeNdjsonEncoder = <A>(schema: Schema.Codec<A, unknown>) => (event: A) => {
  try {
    return encoder.encode(`${JSON.stringify(Schema.encodeSync(schema)(event))}\n`);
  } catch (cause) {
    console.error("ndjson encode failed", cause);
    return encoder.encode(`${JSON.stringify({ type: "error", message: "Failed to encode stream event" })}\n`);
  }
};

const encodeNdjson = makeNdjsonEncoder(TutorChatStreamEvent);
const encodeAttemptNdjson = makeNdjsonEncoder(AttemptStreamEvent);

const TutorStreamRoute = HttpRouter.add("POST", "/api/tutor/chat/stream", () =>
  Effect.gen(function* () {
    const input = yield* HttpServerRequest.schemaBodyJson(TutorChatRequest);
    const tutor = yield* TutorChatService;
    const languageModel = yield* LanguageModel.LanguageModel;
    const body = tutor.streamMessage(input).pipe(
      Stream.provideService(LanguageModel.LanguageModel, languageModel),
      Stream.map(encodeNdjson)
    );

    return HttpServerResponse.stream(body, {
      contentType: "application/x-ndjson",
      headers: {
        "cache-control": "no-cache",
        "x-accel-buffering": "no"
      }
    });
  })
);

const AttemptStreamRoute = HttpRouter.add("POST", "/api/artifacts/:id/submit/stream", () =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const artifactId = params.id;

    if (artifactId === undefined) {
      return yield* HttpServerResponse.json({ message: "Missing artifact id" }, { status: 400 });
    }

    const payload = yield* HttpServerRequest.schemaBodyJson(SubmitAttemptInput);
    const artifacts = yield* ArtifactRepository;
    const languageModel = yield* LanguageModel.LanguageModel;
    const evaluationEngine = yield* EvaluationEngineService;
    const materialRepository = yield* MaterialRepository;
    const evaluationTrace = yield* EvaluationTrace;

    const submitted = yield* artifacts.submitAttempt({ ...payload, artifactId }).pipe(Effect.orDie);
    const graded = yield* artifacts.gradeAttempt(submitted.id).pipe(Effect.orDie);
    const artifact = yield* artifacts.getArtifact(graded.artifactId).pipe(Effect.orDie);

    const body = reviewGradedAttemptStreaming(artifact, graded).pipe(
      Stream.tap((event) =>
        event.type === "done"
          ? artifacts.saveAttempt(event.payload).pipe(Effect.orDie)
          : Effect.void
      ),
      Stream.provideService(LanguageModel.LanguageModel, languageModel),
      Stream.provideService(EvaluationEngineService, evaluationEngine),
      Stream.provideService(MaterialRepository, materialRepository),
      Stream.provideService(EvaluationTrace, evaluationTrace),
      Stream.map(encodeAttemptNdjson)
    );

    return HttpServerResponse.stream(body, {
      contentType: "application/x-ndjson",
      headers: {
        "cache-control": "no-cache",
        "x-accel-buffering": "no"
      }
    });
  })
);

const Routes = Layer.mergeAll(ApiRoutes, DocsRoute, TutorStreamRoute, AttemptStreamRoute);

const DomainLive = Layer.mergeAll(
  TutorChatServiceLive,
  EvaluationEngineServiceLive,
  GeminiModel
);

const InfraLive = Layer.mergeAll(
  FileMaterialRepository.layer(".data/materials/pdfs").pipe(
    Layer.provide(PopplerPdfService.layer)
  ),
  FileArtifactRepository.layer(".data/artifacts"),
  FileEvaluationTrace.layer(".data/sessions")
);

export const HttpServerLive = HttpRouter.serve(Routes).pipe(
  Layer.provide(DomainLive),
  Layer.provide(InfraLive),
  Layer.provide(NodeHttpServer.layer(
    () => createServer(),
    { port: Number(process.env.PORT ?? "3000") }
  ))
);
