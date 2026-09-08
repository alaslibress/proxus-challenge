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
        if (response.text.length === 0) {
          // The turn produced neither text nor an executed tool: either the adapter bailed
          // (MALFORMED_FUNCTION_CALL with no recovery) or the model returned an empty turn.
          // Continue the loop with a synthetic user message so the model can answer with
          // what it already knows. Not emitted to client — the push bypasses emit on purpose.
          newMessages.push(AgentMessage.user(
            "The tool call could not be completed. Answer the user now, in their language, using only what you already know from this conversation. Say plainly what you could not do."
          ));
          continue;
        }

        yield* appendMessage(AgentMessage.assistant(response.text));
        return {
          output: response.text,
          newMessages,
          messages: allMessages()
        };
      }
    }

    // Step budget exhausted mid-work. A tool result is internal plumbing — a page dump, a
    // JSON blob — never an answer, so it must not be echoed to the student. Spend one last
    // turn with the tools switched off to force the model to write a real answer from what
    // it already gathered.
    const output = yield* wrapUp(harness, toolkit, allMessages());
    yield* appendMessage(AgentMessage.assistant(output));

    return {
      output,
      newMessages,
      messages: allMessages()
    };
  });
}

const wrapUpInstruction =
  "You have run out of tool steps for this turn. Do not call any more tools. Answer the user now, in their language, using what you already gathered in this conversation. Never paste raw tool output back to the user: explain it in your own words. If you could not finish what they asked, say so plainly and tell them what to ask next.";

const wrapUpFallback =
  "I ran out of steps for this turn before I could finish. Ask me again and I will pick it up from here.";

// `yield* harness.toolkit` resolves the toolkit to its handler-bound form, which is what
// LanguageModel.generateText takes — not the AgentToolkit describing it.
type ResolvedToolkit = Effect.Success<AgentToolkit>;

const wrapUp = (
  harness: AgentHarness,
  toolkit: ResolvedToolkit,
  messages: readonly AgentMessageType[]
): Effect.Effect<string, never, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>> =>
  Effect.gen(function* () {
    yield* Effect.log("agent.wrap_up").pipe(
      Effect.annotateLogs({ messageCount: messages.length })
    );

    const prompt = renderPrompt(
      harness.systemPrompt,
      [...messages, AgentMessage.user(wrapUpInstruction)]
    );

    const response = yield* LanguageModel.generateText({
      prompt,
      toolkit,
      toolChoice: "none" as const
    }).pipe(
      Effect.matchEffect({
        onFailure: (error) => Effect.succeed(modelErrorResponse(error)),
        onSuccess: (response) => Effect.succeed(response)
      })
    );

    return response.text.length > 0 ? response.text : wrapUpFallback;
  });

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

export const formatToolResult = (result: unknown) => {
  if (typeof result === "string") {
    return result;
  }

  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
};
