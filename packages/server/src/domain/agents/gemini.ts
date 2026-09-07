import { Config, Data, Effect, Layer, Redacted, Schema, Stream } from "effect";
import {
  AiError,
  LanguageModel,
  Model as AiModel,
  Response
} from "effect/unstable/ai";

const defaultModel = "gemini-2.5-flash";

const FunctionCall = Schema.Struct({
  name: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
});

const GeminiPart = Schema.Struct({
  text: Schema.optional(Schema.String),
  thought: Schema.optional(Schema.Boolean),
  functionCall: Schema.optional(FunctionCall)
});

const GeminiResponse = Schema.Struct({
  candidates: Schema.optional(Schema.Array(Schema.Struct({
    finishReason: Schema.optional(Schema.String),
    content: Schema.optional(Schema.Struct({
      parts: Schema.optional(Schema.Array(GeminiPart))
    }))
  }))),
  usageMetadata: Schema.optional(Schema.Struct({
    promptTokenCount: Schema.optional(Schema.Number),
    candidatesTokenCount: Schema.optional(Schema.Number),
    thoughtsTokenCount: Schema.optional(Schema.Number),
    totalTokenCount: Schema.optional(Schema.Number)
  })),
  promptFeedback: Schema.optional(Schema.Struct({
    blockReason: Schema.optional(Schema.String)
  }))
});

type GeminiPart = typeof GeminiPart.Type;
type GeminiResponseType = typeof GeminiResponse.Type;

class GeminiConfigError extends Data.TaggedError("GeminiConfigError")<{
  readonly reason: string;
}> {}

const GeminiConfig = Effect.gen(function* () {
  const apiKey = yield* Config.redacted("GOOGLE_GENERATIVE_AI_API_KEY");
  const model = yield* Config.string("GEMINI_MODEL").pipe(
    Config.orElse(() => Config.succeed(defaultModel))
  );

  const apiKeyValue = Redacted.value(apiKey).trim();

  if (apiKeyValue.length === 0) {
    return yield* new GeminiConfigError({ reason: "Missing GOOGLE_GENERATIVE_AI_API_KEY" });
  }

  return {
    apiKey: apiKeyValue,
    model: model.trim().length === 0 ? defaultModel : model.trim()
  };
});

const toAiError = (description: string) =>
  AiError.make({
    module: "GeminiLanguageModel",
    method: "generateText",
    reason: new AiError.UnknownError({ description })
  });

type GeminiContentPart =
  | { readonly text: string }
  | { readonly inlineData: { readonly mimeType: string; readonly data: string } }
  | { readonly functionCall: { readonly name: string; readonly args: Record<string, unknown> } }
  | { readonly functionResponse: { readonly name: string; readonly response: { readonly result: unknown } } };

interface GeminiTextContent {
  readonly role: "user" | "model";
  readonly parts: readonly GeminiContentPart[];
}

const messageText = (message: LanguageModel.ProviderOptions["prompt"]["content"][number]) =>
  messageParts(message).flatMap((part) => "text" in part ? [part.text] : []).join("\n");

const messageParts = (message: LanguageModel.ProviderOptions["prompt"]["content"][number]): readonly GeminiContentPart[] => {
  if (typeof message.content === "string") {
    return [{ text: message.content }];
  }

  return message.content.flatMap((part): readonly GeminiContentPart[] => {
    if (part.type === "text") {
      return [{ text: part.text }];
    }

    if (part.type === "file") {
      const data = fileDataToBase64(part.data);
      return data === undefined
        ? []
        : [{ inlineData: { mimeType: part.mediaType, data } }];
    }

    return [];
  });
};

const fileDataToBase64 = (data: string | Uint8Array | URL) => {
  if (typeof data !== "string") {
    return undefined;
  }

  const dataUrlMatch = /^data:[^;]+;base64,(.*)$/.exec(data);
  return dataUrlMatch?.[1] ?? data;
};

const promptSystemInstruction = (prompt: LanguageModel.ProviderOptions["prompt"]) => {
  const text = prompt.content
    .filter((message) => message.role === "system")
    .map(messageText)
    .join("\n");

  return text.length === 0
    ? undefined
    : { parts: [{ text }] };
};

// Three patterns that describe the same format and MUST stay in sync with each other:
//   1. renderMessage  (harness/session.ts)  — produces "Tool call <name>: <json>"
//   2. TOOL_CALL_RE  (below)                — translates history back to native functionCall
//   3. buildLeakPattern (below)             — detects if the model reproduced the format
// If renderMessage changes, update all three.
const TOOL_CALL_RE = /^Tool call (\w+): (\{[\s\S]*\}|\[[\s\S]*\])$/;
const TOOL_RESULT_RE = /^Tool result (\w+)( failure)?: ([\s\S]*)$/;

const promptContents = (prompt: LanguageModel.ProviderOptions["prompt"]): readonly GeminiTextContent[] =>
  prompt.content
    .filter((message) => message.role !== "system")
    .map((message): GeminiTextContent => {
      // Translate prose tool-call → native functionCall part (model role).
      // Opción A (PR-12/12.1): regex parche hasta que PR-05 migre el contrato de frames.
      if (message.role === "assistant" && typeof message.content === "string") {
        const m = TOOL_CALL_RE.exec(message.content);
        if (m !== null) {
          const name = m[1]!;
          const argsJson = m[2]!;
          try {
            const args = JSON.parse(argsJson) as Record<string, unknown>;
            return { role: "model", parts: [{ functionCall: { name, args } }] };
          } catch {
            // malformed JSON — fall through to plain text
          }
        }
      }

      // Translate prose tool-result → native functionResponse part (user role)
      if (message.role === "user" && typeof message.content === "string") {
        const m = TOOL_RESULT_RE.exec(message.content);
        if (m !== null) {
          const name = m[1]!;
          const result = m[3] ?? "";
          return {
            role: "user",
            parts: [{ functionResponse: { name, response: { result } } }]
          };
        }
      }

      return {
        role: message.role === "assistant" ? "model" : "user",
        parts: messageParts(message)
      };
    });

const geminiUrl = (model: string, apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

const toolParameters = (toolName: string) => {
  switch (toolName) {
    case "load_skill":
      return {
        type: "object",
        properties: {
          name: { type: "string", description: "Skill name to load" }
        },
        required: ["name"]
      };
    case "use_tool":
    case "run_command":
    case "cli":
      return {
        type: "object",
        properties: {
          input: { type: "string", description: "Command input string described by a loaded skill" }
        },
        required: ["input"]
      };
    default:
      return {
        type: "object",
        properties: {
          a: { type: "number", description: "First number" },
          b: { type: "number", description: "Second number" }
        },
        required: ["a", "b"]
      };
  }
};

const toolDeclarations = (tools: LanguageModel.ProviderOptions["tools"]) =>
  tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: toolParameters(tool.name)
  }));

const geminiTools = (tools: LanguageModel.ProviderOptions["tools"]) =>
  tools.length === 0 ? [] : [{ functionDeclarations: toolDeclarations(tools) }];

const toolChoiceConfig = (options: LanguageModel.ProviderOptions) => {
  if (options.toolChoice === "none" || options.tools.length === 0) {
    return undefined;
  }

  if (options.toolChoice === "required") {
    return {
      mode: "ANY",
      allowedFunctionNames: options.tools.map((tool) => tool.name)
    };
  }

  if (typeof options.toolChoice === "object" && "tool" in options.toolChoice) {
    return {
      mode: "ANY",
      allowedFunctionNames: [options.toolChoice.tool]
    };
  }

  if (typeof options.toolChoice === "object" && "oneOf" in options.toolChoice) {
    return options.toolChoice.mode === "required"
      ? {
          mode: "ANY",
          allowedFunctionNames: options.toolChoice.oneOf
        }
      : { mode: "AUTO" };
  }

  return { mode: "AUTO" };
};

const toolConfig = (options: LanguageModel.ProviderOptions) => {
  const functionCallingConfig = toolChoiceConfig(options);

  return functionCallingConfig === undefined
    ? undefined
    : { functionCallingConfig };
};

const requestBody = (options: LanguageModel.ProviderOptions) => ({
  systemInstruction: promptSystemInstruction(options.prompt),
  contents: promptContents(options.prompt),
  tools: geminiTools(options.tools),
  toolConfig: toolConfig(options)
});

const firstFunctionCall = (parts: ReadonlyArray<GeminiPart>) =>
  parts.find((part) => part.functionCall?.name !== undefined)?.functionCall;

const decodeGeminiResponse = (json: unknown) =>
  Schema.decodeUnknownSync(GeminiResponse)(json);

// Detects when the model wrote a tool call as prose instead of emitting a real functionCall.
// Primary signal: finishReason === "MALFORMED_FUNCTION_CALL" (deterministic, from API).
// Secondary signal: text matching our own history format or the "default_api:" narration.
// Pattern a) our history format: "Tool call <name>: {...}" — see renderMessage / TOOL_CALL_RE
// Pattern b) narrated call: "default_api.load_skill({...})" / "cli({...})"
// Must stay in sync with renderMessage (harness/session.ts) and TOOL_CALL_RE (above).
const buildLeakPattern = (tools: LanguageModel.ProviderOptions["tools"]): RegExp | null => {
  if (tools.length === 0) return null;
  const escaped = tools.map((t) => t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(
    `(?:^|\\n)\\s*Tool call\\s+(?:${escaped})\\s*:` +
    `|(?:default_api[.:]\\s*)?\\b(?:${escaped})\\b\\s*[:(\\{]`,
    "i"
  );
};

interface ToResponsePartsResult {
  readonly responseParts: Array<Response.PartEncoded>;
  // Non-null signals a leak or MALFORMED_FUNCTION_CALL. The caller handles retry.
  // responseParts is empty when leakText is non-null.
  readonly leakText: string | null;
}

const toResponseParts = (
  parts: ReadonlyArray<GeminiPart>,
  finishReason: string,
  tools: LanguageModel.ProviderOptions["tools"]
): ToResponsePartsResult => {
  const functionCall = firstFunctionCall(parts);

  if (functionCall?.name !== undefined) {
    // Valid function call part — process regardless of finishReason
    const toolNames = new Set(tools.map((tool) => tool.name));

    const toolCall = toolNames.has(functionCall.name)
      ? {
          name: functionCall.name,
          params: functionCall.args ?? {}
        }
      : toolNames.has("load_skill")
        ? {
            name: "load_skill",
            params: { name: functionCall.name }
          }
        : {
            name: functionCall.name,
            params: functionCall.args ?? {}
          };

    if (!toolNames.has(toolCall.name)) {
      const availableTools = tools.map((tool) => tool.name).join(", ");
      throw new Error(`Invalid tool call "${functionCall.name}". Available tools: ${availableTools}.`);
    }

    return {
      responseParts: [
        Response.makePart("tool-call", {
          id: `call_${crypto.randomUUID()}`,
          name: toolCall.name,
          params: toolCall.params,
          providerExecuted: false
        }) as unknown as Response.PartEncoded
      ],
      leakText: null
    };
  }

  // No functionCall part — check primary signal then secondary
  const textParts = parts.flatMap((part) => part.text !== undefined && !part.thought ? [part.text] : []);
  const fullText = textParts.join("");

  const isMalformed = finishReason === "MALFORMED_FUNCTION_CALL";
  const leakPattern = buildLeakPattern(tools);
  const hasLeakText = leakPattern !== null && leakPattern.test(fullText);

  if (isMalformed || hasLeakText) {
    return {
      responseParts: [],
      leakText: fullText.length > 0 ? fullText : "MALFORMED_FUNCTION_CALL"
    };
  }

  return {
    responseParts: textParts.map((text) => Response.makePart("text", { text }) as unknown as Response.PartEncoded),
    leakText: null
  };
};

interface GeminiCallResult {
  readonly parts: ReadonlyArray<GeminiPart>;
  readonly finishReason: string;
  readonly usageMetadata: GeminiResponseType["usageMetadata"];
  readonly promptFeedback: GeminiResponseType["promptFeedback"];
}

const callGeminiOnce = (url: string, body: unknown): Effect.Effect<GeminiCallResult, AiError.AiError> =>
  Effect.gen(function* () {
    const rawJson = yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        return response.json();
      },
      catch: (cause) => toAiError(cause instanceof Error ? cause.message : String(cause))
    });

    const json = yield* Effect.try({
      try: () => decodeGeminiResponse(rawJson),
      catch: (cause) => toAiError(cause instanceof Error ? cause.message : String(cause))
    });

    const candidate = json.candidates?.[0];

    return {
      parts: candidate?.content?.parts ?? [],
      finishReason: candidate?.finishReason ?? "unknown",
      usageMetadata: json.usageMetadata,
      promptFeedback: json.promptFeedback
    };
  });

const logGeminiResponse = (call: GeminiCallResult, extra?: Record<string, unknown>) =>
  Effect.log("gemini.response").pipe(
    Effect.annotateLogs({
      finishReason: call.finishReason,
      totalTokens: call.usageMetadata?.totalTokenCount,
      partCount: call.parts.length,
      functionCallParts: call.parts.filter((p) => p.functionCall?.name !== undefined).length,
      thoughtParts: call.parts.filter((p) => p.thought === true).length,
      blockReason: call.promptFeedback?.blockReason,
      textPreview: call.parts.flatMap((p) => p.text !== undefined && !p.thought ? [p.text] : []).join("").slice(0, 200),
      ...extra
    })
  );

export const GeminiLanguageModelLive = Layer.effect(
  LanguageModel.LanguageModel,
  Effect.gen(function* () {
    const config = yield* GeminiConfig;

    return yield* LanguageModel.make({
      generateText: (options) =>
        Effect.gen(function* () {
          const url = geminiUrl(config.model, config.apiKey);
          const body = requestBody(options);

          // First call
          const call1 = yield* callGeminiOnce(url, body);
          yield* logGeminiResponse(call1);

          const result1 = yield* Effect.try({
            try: () => toResponseParts(call1.parts, call1.finishReason, options.tools),
            catch: (cause) => toAiError(cause instanceof Error ? cause.message : String(cause))
          });

          if (result1.leakText === null) {
            return result1.responseParts;
          }

          // Leak or MALFORMED_FUNCTION_CALL detected — log and retry once
          yield* Effect.log("agent.tool_call_leak").pipe(
            Effect.annotateLogs({ leakPreview: result1.leakText.slice(0, 200) })
          );

          const retryBody = {
            ...body,
            contents: [
              ...body.contents,
              {
                role: "user" as const,
                parts: [{ text: "Your last reply wrote a function call as text. Emit it as a real function call, or answer in plain language. Do not write the words \"Tool call\"." }]
              }
            ]
          };

          const call2 = yield* callGeminiOnce(url, retryBody);
          yield* logGeminiResponse(call2, { retry: true });

          const result2 = yield* Effect.try({
            try: () => toResponseParts(call2.parts, call2.finishReason, options.tools),
            catch: (cause) => toAiError(cause instanceof Error ? cause.message : String(cause))
          });

          if (result2.leakText === null) {
            yield* Effect.log("agent.tool_call_retry").pipe(
              Effect.annotateLogs({ outcome: "recovered" })
            );
            return result2.responseParts;
          }

          yield* Effect.log("agent.tool_call_retry").pipe(
            Effect.annotateLogs({ outcome: "bailed" })
          );

          return [
            Response.makePart("text", {
              text: "No he podido completar esa acción. Vuelve a pedírmelo con otras palabras, por favor."
            }) as unknown as Response.PartEncoded
          ];
        }),
      streamText: () => Stream.empty
    });
  })
).pipe(Layer.orDie);

export const GeminiModel = AiModel.make(
  "google",
  defaultModel,
  GeminiLanguageModelLive
);
