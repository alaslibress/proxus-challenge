import type { AgentMessage } from "@proxus/shared";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { useTutorChat } from "../domain/tutor/use-tutor-chat.ts";

const starterPrompts = [
  "List my uploaded materials",
  "Create a short quiz from my materials",
  "Explain the hardest concept in my notes step by step"
] as const;

export function Chat() {
  const chat = useTutorChat();

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
          onClick={chat.clear}
          disabled={chat.messages.length === 0 || chat.status === "sending"}
        >
          Clear chat
        </button>
      </header>

      <section className="flex flex-col gap-4 overflow-y-auto p-6" aria-live="polite">
        {chat.messages.length === 0
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
                      className="rounded-2xl border border-line-strong bg-transparent text-ink-mute hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ padding: 16, fontSize: 13, transitionDuration: "120ms", transitionTimingFunction: "var(--ease-dc)" }}
                      key={prompt}
                      type="button"
                      disabled={chat.status === "sending"}
                      onClick={() => chat.submit(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )
          : chat.messages.map((message, index) => <MessageBubble key={index} message={message} />)}
        {chat.status === "sending" && (
          chat.messages.length === 0 || chat.messages[chat.messages.length - 1]?.role !== "assistant"
        ) && (
          <div className="flex justify-start px-6">
            <div className="rounded-2xl border border-line bg-surface shadow-card px-4 py-3">
              <span className="animate-pulse text-ink-faint">···</span>
            </div>
          </div>
        )}
      </section>

      {chat.error === undefined ? null : (
        <div className="mx-6 mb-3 flex items-center justify-between gap-4 rounded-xl border border-danger-line bg-danger-tint px-4 py-3">
          <p className="m-0 text-danger-ink" style={{ fontSize: 13 }}>{chat.error}</p>
          {chat.canRetry && (
            <button
              type="button"
              onClick={chat.retry}
              className="shrink-0 rounded-full border border-danger-line text-danger-ink hover:border-danger"
              style={{ padding: "4px 12px", fontSize: 13 }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      <form
        className="grid grid-cols-[1fr_auto] gap-3 border-t border-line bg-surface-raised px-6 pt-4 pb-6"
        onSubmit={(event) => {
          event.preventDefault();
          chat.submit(chat.input);
        }}
      >
        <textarea
          className="w-full resize-y bg-surface border border-line-strong text-ink outline-none disabled:cursor-not-allowed disabled:opacity-60"
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
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              chat.submit(chat.input);
            }
          }}
          value={chat.input}
          onChange={(event) => chat.setInput(event.currentTarget.value)}
          placeholder={chat.status === "sending" ? "Waiting for the tutor…" : "Ask your tutor something…"}
          rows={3}
          disabled={chat.status === "sending"}
          aria-busy={chat.status === "sending"}
        />
        {chat.status === "sending"
          ? (
              <button
                type="button"
                onClick={chat.stop}
                className="self-end rounded-full border border-line-strong bg-surface-raised text-ink hover:border-brand"
                style={{
                  padding: "12px 20px",
                  fontSize: 14,
                  fontWeight: 600,
                  transitionProperty: "border-color",
                  transitionDuration: "120ms",
                  transitionTimingFunction: "var(--ease-dc)",
                }}
              >
                Stop
              </button>
            )
          : (
              <button
                type="submit"
                disabled={chat.input.trim().length === 0}
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
              >
                Send
              </button>
            )}
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
