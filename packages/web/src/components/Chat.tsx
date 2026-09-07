import { useAtomRefresh } from "@effect/atom-react";
import type { AgentMessage } from "@proxus/shared";
import { useRef, useState } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { artifactsQuery } from "../domain/artifacts/atoms.ts";
import { materialsQuery } from "../domain/materials/atoms.ts";
import { applyInvalidations, invalidationsForToolCall } from "../domain/tutor/invalidation.ts";
import { streamTutorMessage } from "../domain/tutor/stream.ts";

const starterPrompts = [
  "List my uploaded materials",
  "Create a short quiz from my materials",
  "Explain the hardest concept in my notes step by step"
] as const;

export function Chat() {
  const [messages, setMessages] = useState<readonly AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const refreshArtifacts = useAtomRefresh(artifactsQuery);
  const refreshMaterials = useAtomRefresh(materialsQuery);
  const pendingInvalidations = useRef<Array<ReturnType<typeof invalidationsForToolCall>>>([]);

  const submit = async (nextInput: string) => {
    const trimmed = nextInput.trim();
    if (trimmed.length === 0 || isSending) {
      return;
    }

    setIsSending(true);
    setError(undefined);
    pendingInvalidations.current = [];

    try {
      for await (const event of streamTutorMessage({
        input: trimmed,
        messages,
        maxSteps: 8
      })) {
        if (event.type === "done") {
          continue;
        }

        const message = event.message;
        setMessages((current) => [...current, message]);

        if (message.role === "tool-call") {
          pendingInvalidations.current.push(invalidationsForToolCall(message));
        }

        if (message.role === "tool-result") {
          const keys = pendingInvalidations.current.shift() ?? [];
          if (!message.isFailure) {
            applyInvalidations(keys, {
              refreshArtifacts,
              refreshMaterials
            });
          }
        }
      }

      setInput("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main className="grid h-screen max-h-screen min-w-0 grid-rows-[auto_1fr_auto_auto] bg-canvas max-md:h-auto max-md:max-h-none">
      <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-5">
        <div>
          <p
            className="mb-1 text-brand"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              fontWeight: 500,
              letterSpacing: ".14em",
              textTransform: "uppercase",
            }}
          >
            Ephemeral session
          </p>
          <h1
            className="m-0 text-ink"
            style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em" }}
          >
            Academic tutor
          </h1>
        </div>
        <button
          className="rounded-full border border-line-strong bg-transparent text-ink-mute hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
          style={{ padding: "8px 16px", fontSize: 13, transitionDuration: "120ms", transitionTimingFunction: "var(--ease-dc)" }}
          type="button"
          onClick={() => setMessages([])}
          disabled={messages.length === 0}
        >
          Clear chat
        </button>
      </header>

      <section className="flex flex-col gap-4 overflow-y-auto p-6" aria-live="polite">
        {messages.length === 0
          ? (
              <div className="m-auto w-full max-w-3xl text-center">
                <h2
                  className="m-0 text-balance text-ink"
                  style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.025em", lineHeight: 1.15 }}
                >
                  Ask about your materials, notes, quizzes, or tests.
                </h2>
                <p className="mt-4 text-ink-mute" style={{ fontSize: 14.5, lineHeight: 1.7 }}>
                  The chat history lives only in browser memory. Refreshing starts over.
                </p>
                <div className="mt-6 grid grid-cols-3 gap-3 max-lg:grid-cols-1">
                  {starterPrompts.map((prompt) => (
                    <button
                      className="rounded-2xl border border-line-strong bg-transparent text-ink-mute hover:bg-surface-muted"
                      style={{ padding: 16, fontSize: 13, transitionDuration: "120ms", transitionTimingFunction: "var(--ease-dc)" }}
                      key={prompt}
                      type="button"
                      onClick={() => void submit(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )
          : messages.map((message, index) => <MessageBubble key={index} message={message} />)}
      </section>

      {error === undefined ? null : (
        <p className="m-0 px-6 pb-3 text-danger" style={{ fontSize: 13 }}>{error}</p>
      )}

      <form
        className="grid grid-cols-[1fr_auto] gap-3 border-t border-line bg-surface-raised px-6 pt-4 pb-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(input);
        }}
      >
        <textarea
          className="w-full resize-y bg-surface border border-line-strong text-ink outline-none"
          style={{
            borderRadius: 14,
            padding: "14px 16px",
            fontSize: 14.5,
            lineHeight: 1.7,
            transitionProperty: "border-color, box-shadow",
            transitionDuration: "120ms",
            transitionTimingFunction: "var(--ease-dc)",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--color-focus-line)";
            e.currentTarget.style.boxShadow = "0 0 0 3px var(--color-focus-ring)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "";
            e.currentTarget.style.boxShadow = "";
          }}
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          placeholder="Ask your tutor something…"
          rows={3}
        />
        <button
          className="self-end text-white bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
          style={{
            borderRadius: 8,
            padding: "12px 20px",
            fontSize: 14,
            fontWeight: 600,
            boxShadow: "var(--shadow-brand)",
            transitionProperty: "background-color, box-shadow",
            transitionDuration: "120ms",
            transitionTimingFunction: "var(--ease-dc)",
          }}
          type="submit"
          disabled={isSending || input.trim().length === 0}
        >
          {isSending ? "Thinking…" : "Send"}
        </button>
      </form>
    </main>
  );
}

function MessageBubble({ message }: { readonly message: AgentMessage }) {
  if (message.role === "tool-call" || message.role === "tool-result") {
    return (
      <details className="w-full rounded-2xl border border-line bg-surface p-4 text-ink-faint">
        <summary className="cursor-pointer" style={{ fontSize: 13 }}>
          {message.role === "tool-call" ? `Tool call: ${message.name}` : `Tool result: ${message.name}`}
        </summary>
        <pre
          className="mt-3 overflow-x-auto whitespace-pre-wrap"
          style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
        >
          {JSON.stringify(message.role === "tool-call" ? message.input : message.result, null, 2)}
        </pre>
      </details>
    );
  }

  return (
    <article
      className={
        message.role === "user"
          ? "max-w-3xl self-end rounded-2xl border border-brand-tint bg-brand-tint p-4"
          : "max-w-3xl self-start rounded-2xl border border-line bg-surface shadow-card p-4"
      }
    >
      <span
        className={`mb-2 block ${message.role === "user" ? "text-brand" : "text-ink-faint"}`}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: ".14em",
          textTransform: "uppercase",
        }}
      >
        {message.role === "user" ? "You" : "Tutor"}
      </span>
      <div className="text-ink-soft" style={{ fontSize: 14.5, lineHeight: 1.7 }}>
        <Streamdown>{message.content}</Streamdown>
      </div>
    </article>
  );
}
