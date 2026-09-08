import { Effect } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { ApiClient } from "../../api-client/client.ts";
import { apiRuntime } from "../../lib/runtime.ts";

export const materialsQuery = apiRuntime
  .atom(
    ApiClient.use((client) =>
      client.materials.list()
    ).pipe(Effect.withSpan("materials.list", { kind: "client" }))
  )
  .pipe(Atom.keepAlive, Atom.withReactivity(["materials"]));

export const deleteMaterialAction = apiRuntime.fn(
  (id: string) =>
    ApiClient.use((client) =>
      client.materials.delete({ params: { id } })
    ).pipe(Effect.withSpan("materials.delete", { kind: "client" })),
  { reactivityKeys: ["materials"] }
);
