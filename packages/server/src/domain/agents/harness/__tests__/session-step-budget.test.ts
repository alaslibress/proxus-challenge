import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { AiError, LanguageModel, Response } from "effect/unstable/ai";
import { AgentHarness } from "../harness.ts";
import { AgentSession } from "../session.ts";
import { AgentSkill } from "../skill.ts";
import * as AgentCli from "../cli.ts";

// A page dump exactly like `materials text <id> <pages>` produces (material-commands.ts).
// If this string ever reaches the student as an assistant message, the bug is back.
const PAGE_DUMP = `--- guiaMuestraDeDatos page 4 ---
Personalización esencial: • • • • • plt.style.use("ggplot")
No te olvides de seguirnos para más! 4`;

const WRAP_UP_ANSWER = "Aquí tienes el quiz que te preparé a partir de tus materiales.";

interface RecordedCall {
  readonly toolChoice: unknown;
}

// Fake LanguageModel: replays a fixed script of turns, so the step budget can be exhausted
// offline without touching the Gemini API. Mirrors the shape gemini.ts builds.
const makeFakeModel = (options: {
  readonly script: readonly Response.PartEncoded[][];
  readonly wrapUp: Response.PartEncoded[] | "fail";
  readonly calls: RecordedCall[];
}) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: (providerOptions): Effect.Effect<Response.PartEncoded[], AiError.AiError> => {
        const index = options.calls.length;
        options.calls.push({ toolChoice: providerOptions.toolChoice });

        // Anything past the script is the wrap-up turn the session makes with tools off.
        const parts = options.script[index];
        if (parts !== undefined) {
          return Effect.succeed(parts);
        }

        return options.wrapUp === "fail"
          ? Effect.fail(AiError.make({
              module: "FakeLanguageModel",
              method: "generateText",
              reason: new AiError.UnknownError({ description: "wrap-up unavailable" })
            }))
          : Effect.succeed(options.wrapUp);
      },
      streamText: () => {
        throw new Error("streamText is not used by AgentSession");
      }
    })
  );

const textPart = (text: string): Response.PartEncoded =>
  Response.makePart("text", { text }) as unknown as Response.PartEncoded;

const toolCallPart = (name: string, params: Record<string, unknown>, id: string): Response.PartEncoded =>
  Response.makePart("tool-call", {
    id,
    name,
    params,
    providerExecuted: false
  }) as unknown as Response.PartEncoded;

const makeTestHarness = () => {
  const dump = AgentCli.Command.withDescription("Extract literal PDF text")(
    AgentCli.Command.exec("text", {
      materialId: AgentCli.Argument.string("materialId"),
      pages: AgentCli.Argument.string("pages")
    }, () => Effect.succeed(PAGE_DUMP))
  );

  return AgentHarness.make({
    name: "Test tutor",
    skills: [
      AgentSkill.make({ name: "use-uploaded-materials", description: "Read materials", content: "Read the PDFs." })
    ],
    commands: [AgentCli.Command.group("materials", [dump] as const)]
  });
};

// Four turns that all call a tool and never answer: with maxSteps 4 the budget runs out
// with the page dump sitting in the last tool result.
const exhaustingScript = (): Response.PartEncoded[][] => [
  [toolCallPart("load_skill", { name: "use-uploaded-materials" }, "call_a")],
  [toolCallPart("load_skill", { name: "use-uploaded-materials" }, "call_b")],
  [toolCallPart("cli", { input: "materials text guiaMuestraDeDatos 1-3" }, "call_c")],
  [toolCallPart("cli", { input: "materials text guiaMuestraDeDatos 4" }, "call_d")]
];

const runSession = (options: {
  readonly script: Response.PartEncoded[][];
  readonly wrapUp: Response.PartEncoded[] | "fail";
  readonly maxSteps: number;
}) => {
  const calls: RecordedCall[] = [];
  const harness = makeTestHarness();

  return AgentSession.make(harness).run({
    input: "Créame un quiz corto con mis materiales",
    maxSteps: options.maxSteps
  }).pipe(
    Effect.provide(Layer.mergeAll(
      harness.layer,
      makeFakeModel({ script: options.script, wrapUp: options.wrapUp, calls })
    )),
    Effect.map((result) => ({ result, calls }))
  );
};

describe("AgentSession step budget exhaustion", () => {
  it("never answers with the last raw tool result", async () => {
    const { result } = await Effect.runPromise(runSession({
      script: exhaustingScript(),
      wrapUp: [textPart(WRAP_UP_ANSWER)],
      maxSteps: 4
    }));

    expect(result.output).not.toContain("--- guiaMuestraDeDatos page 4 ---");
    expect(result.output).not.toContain("No te olvides de seguirnos");
    expect(result.output).toBe(WRAP_UP_ANSWER);

    const assistantMessages = result.messages.filter((message) => message.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({ content: WRAP_UP_ANSWER });
  });

  it("spends one extra turn with the tools switched off", async () => {
    const { calls } = await Effect.runPromise(runSession({
      script: exhaustingScript(),
      wrapUp: [textPart(WRAP_UP_ANSWER)],
      maxSteps: 4
    }));

    expect(calls).toHaveLength(5);
    expect(calls.slice(0, 4).every((call) => call.toolChoice === "auto")).toBe(true);
    expect(calls[4]?.toolChoice).toBe("none");
  });

  it("falls back to an honest message when the wrap-up turn itself fails", async () => {
    const { result } = await Effect.runPromise(runSession({
      script: exhaustingScript(),
      wrapUp: "fail",
      maxSteps: 4
    }));

    expect(result.output).not.toContain("guiaMuestraDeDatos");
    expect(result.output).toContain("stopped this turn safely");
  });

  it("still answers normally when the model finishes inside the budget", async () => {
    const { result, calls } = await Effect.runPromise(runSession({
      script: [
        [toolCallPart("cli", { input: "materials text guiaMuestraDeDatos 4" }, "call_a")],
        [textPart("Te resumo la página 4 con mis palabras.")]
      ],
      wrapUp: [textPart(WRAP_UP_ANSWER)],
      maxSteps: 8
    }));

    expect(result.output).toBe("Te resumo la página 4 con mis palabras.");
    // No wrap-up turn: the budget was never exhausted.
    expect(calls).toHaveLength(2);
  });
});
