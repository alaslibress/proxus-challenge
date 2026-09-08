import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { Artifact, ArtifactAttempt, ArtifactListResponse, SubmitAttemptInput } from "../schemas/artifact.ts";

const ArtifactKindQuery = Schema.Struct({
  kind: Schema.optional(Schema.Union([
    Schema.Literal("note"),
    Schema.Literal("quiz"),
    Schema.Literal("test")
  ]))
});

export const AttemptEvaluationStage = Schema.Union([
  Schema.Literal("evaluating_good"),
  Schema.Literal("evaluating_bad"),
  Schema.Literal("deliberating")
]);
export type AttemptEvaluationStage = typeof AttemptEvaluationStage.Type;

export const AttemptStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("status"),
    value: AttemptEvaluationStage,
    questionId: Schema.String,
    questionIndex: Schema.Number,
    questionTotal: Schema.Number
  }),
  Schema.Struct({ type: Schema.Literal("done"), payload: ArtifactAttempt }),
  Schema.Struct({ type: Schema.Literal("error"), message: Schema.String })
]);
export type AttemptStreamEvent = typeof AttemptStreamEvent.Type;

export class ArtifactsApi extends HttpApiGroup.make("artifacts")
  .add(
    HttpApiEndpoint.get("list", "/", {
      query: ArtifactKindQuery,
      success: ArtifactListResponse
    }),
    HttpApiEndpoint.get("get", "/:id", {
      params: {
        id: Schema.String
      },
      success: Artifact
    }),
    HttpApiEndpoint.post("submit", "/:id/submit", {
      params: {
        id: Schema.String
      },
      payload: SubmitAttemptInput,
      success: ArtifactAttempt
    })
  )
  .prefix("/artifacts")
{}
