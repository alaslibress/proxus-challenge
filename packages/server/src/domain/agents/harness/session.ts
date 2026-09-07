import { Effect, Queue, Stream } from "effect";
import { LanguageModel, Prompt, Response, Tool } from "effect/unstable/ai";
import type { AgentHarness, AgentToolkit } from "./harness.ts";
import { isMaterialPageImages } from "../../materials/material.ts";
import { AgentMessage, type AgentMessage as AgentMessageType } from "./message.ts";

export interface AgentSessionRunOptions {
  readonly maxSteps?: number;
}

export interface AgentSessionRunInput extends AgentSessionRunOptions {
  readonly input: string;
  readonly messages?: readonly AgentMessageType[];
}

export interface AgentSessionRunResult {
  readonly output: string;
  readonly newMessages: readonly AgentMessageType[];
  readonly messages: readonly AgentMessageType[];
}

export interface AgentSession {
  readonly run: (
    input: AgentSessionRunInput
  ) => Effect.Effect<AgentSessionRunResult, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>>;
  readonly stream: (
    input: AgentSessionRunInput
  ) => Stream.Stream<AgentMessageType, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>>;
}

export const AgentSession = {
  make: (harness: AgentHarness): AgentSession => ({
    run: (input) => run(harness, input),
    stream: (input) => stream(harness, input)
  }),
  run,
  stream
};

function run(
  harness: AgentHarness,
  input: AgentSessionRunInput
): Effect.Effect<AgentSessionRunResult, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>> {
  return execute(harness, input, () => Effect.void);
}

function stream(
  harness: AgentHarness,
  input: AgentSessionRunInput
): Stream.Stream<AgentMessageType, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>> {
  return Stream.callback<AgentMessageType, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>>((queue) =>
    execute(harness, input, (message) => Queue.offer(queue, message).pipe(Effect.asVoid)).pipe(
      Effect.andThen(Queue.end(queue)),
      Effect.matchCauseEffect({
        onFailure: (cause) => Queue.failCause(queue, cause),
        onSuccess: () => Effect.void
      })
    )
  );
}

function execute(
  harness: AgentHarness,
  input: AgentSessionRunInput,
  emit: (message: AgentMessageType) => Effect.Effect<void>
): Effect.Effect<AgentSessionRunResult, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>> {
  return Effect.gen(function* () {
    const toolkit = yield* harness.toolkit;
    const previousMessages = input.messages ?? [];
    const newMessages: AgentMessageType[] = [];
    const allMessages = () => [...previousMessages, ...newMessages] as const;
    const appendMessage = (message: AgentMessageType): Effect.Effect<void> => Effect.gen(function* () {
      newMessages.push(message);
      yield* emit(message);
    });

    yield* appendMessage(AgentMessage.user(input.input));

    let lastToolResult = "";
    const maxSteps = input.maxSteps ?? 8;

    for (let step = 0; step < maxSteps; step++) {
      const prompt = renderPrompt(harness.systemPrompt, allMessages());
      const response: LanguageModel.GenerateTextResponse<AgentToolkit["tools"]> = yield* LanguageModel.generateText({
        prompt,
        toolkit,
        toolChoice: "auto" as const
      }).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.succeed(modelErrorResponse(error)),
          onSuccess: (response) => Effect.succeed(response)
        })
      );

      yield* Effect.log("agent.step").pipe(
        Effect.annotateLogs({
          step,
          maxSteps,
          toolCalls: response.toolCalls.map((c) => c.name),
          toolResults: response.toolResults.length,
          textPreview: response.text.slice(0, 200)
        })
      );

      for (const toolCall of response.toolCalls) {
        yield* appendMessage(AgentMessage.toolCall(toolCall.name, toolCall.params, toolCall.id));
      }

      for (const toolResult of response.toolResults) {
        yield* appendMessage(AgentMessage.toolResult(toolResult.name, toolResult.result, toolResult.isFailure));
      }

        if (response.toolResults.length === 0) {
        if (response.text.length === 0 && response.toolCalls.length === 0) {
          // Adapter bailed (MALFORMED_FUNCTION_CALL, no recovery). Continue loop with
          // synthetic user message so the model can answer with what it already knows.
          // Not emitted to client — newMessages.push bypasses emit intentionally.
          newMessages.push(AgentMessage.user(
            "The tool call could not be completed. Answer the user now, in their language, using only what you already know from this conversation. Say plainly what you could not do."
          ));
          continue;
        }
        const output = response.text.length > 0 ? response.text : lastToolResult;
        yield* appendMessage(AgentMessage.assistant(output));
        return {
          output,
          newMessages,
          messages: allMessages()
        };
      }

      lastToolResult = String(response.toolResults.at(-1)?.result ?? lastToolResult);
    }

    const output = lastToolResult.length > 0
      ? lastToolResult
      : "Agent stopped after reaching the maximum number of steps.";
    yield* appendMessage(AgentMessage.assistant(output));

    return {
      output,
      newMessages,
      messages: allMessages()
    };
  });
}

const modelErrorResponse = (error: unknown): LanguageModel.GenerateTextResponse<AgentToolkit["tools"]> =>
  new LanguageModel.GenerateTextResponse([
    Response.makePart("text", {
      text: `I hit an internal model/tool-routing error, so I stopped this turn safely instead of crashing the app.\n\n${formatAgentError(error)}`
    })
  ]);

const formatAgentError = (error: unknown) => {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
};

// Tool-call and tool-result IDs are synthesised by position: the n-th tool-call and the
// n-th tool-result share `call_${n}`. Valid while tool calls are strictly sequential (one
// per turn). If parallel tool calls are ever added, this pairing is the first thing to break.
const renderPrompt = (
  systemPrompt: string,
  messages: readonly AgentMessageType[]
): readonly Prompt.MessageEncoded[] => {
  const result: Prompt.MessageEncoded[] = [{ role: "system", content: systemPrompt }];
  let callIndex = 0;
  let resultIndex = 0;

  for (const message of messages) {
    switch (message.role) {
      case "user":
        result.push({ role: "user", content: message.content });
        break;
      case "assistant":
        result.push({ role: "assistant", content: message.content });
        break;
      case "tool-call": {
        const id = message.id ?? `call_${callIndex}`;
        callIndex++;
        result.push({
          role: "assistant",
          content: [{ type: "tool-call", id, name: message.name, params: message.input as Record<string, unknown> }]
        } as unknown as Prompt.MessageEncoded);
        break;
      }
      case "tool-result": {
        const id = `call_${resultIndex++}`;
        if (!message.isFailure && isMaterialPageImages(message.result)) {
          const res = message.result;
          // ToolMessageEncoded only admits tool-result parts, not file parts.
          // Emit text summary as tool message and images as a separate user message.
          result.push({
            role: "tool",
            content: [{
              type: "tool-result",
              id,
              name: message.name,
              isFailure: false,
              result: `rendered pages ${res.pages.map((p) => p.page).join(", ")} from ${res.material.title}.`
            }]
          } as unknown as Prompt.MessageEncoded);
          result.push({
            role: "user",
            content: [
              { type: "text", text: `Rendered pages from ${res.material.title}:` },
              ...res.pages.map((page) => ({
                type: "file" as const,
                mediaType: page.mediaType,
                data: page.data,
                fileName: `${res.material.id}-page-${page.page}.png`
              }))
            ]
          });
        } else {
          result.push({
            role: "tool",
            content: [{
              type: "tool-result",
              id,
              name: message.name,
              isFailure: message.isFailure,
              result: formatToolResult(message.result)
            }]
          } as unknown as Prompt.MessageEncoded);
        }
        break;
      }
    }
  }

  return result;
};

const formatToolResult = (result: unknown) => {
  if (typeof result === "string") {
    return result;
  }

  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
};
