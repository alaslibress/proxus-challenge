import { useAtomRefresh } from "@effect/atom-react";
import type { AgentMessage } from "@proxus/shared";
import { useEffect, useRef, useState } from "react";
import { artifactsQuery } from "../artifacts/atoms.ts";
import { materialsQuery } from "../materials/atoms.ts";
import { applyInvalidations, invalidationsForToolCall } from "./invalidation.ts";
import { resolveStreamFailure, streamTutorMessage } from "./stream.ts";

export type TutorChatStatus = "idle" | "sending";

export interface TutorChatState {
  readonly messages: readonly AgentMessage[];
  readonly input: string;
  readonly status: TutorChatStatus;
  readonly error: string | undefined;
  readonly canRetry: boolean;
  // True when the last turn ended because the user pressed Stop. Cleared on the next send.
  readonly stopped: boolean;
  readonly setInput: (value: string) => void;
  readonly submit: (value: string) => void;
  readonly stop: () => void;
  readonly retry: () => void;
  readonly clear: () => void;
}

export const useTutorChat = (): TutorChatState => {
  const [messages, setMessages] = useState<readonly AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<TutorChatStatus>("idle");
  const [error, setError] = useState<string | undefined>();
  const [stopped, setStopped] = useState(false);

  const refreshArtifacts = useAtomRefresh(artifactsQuery);
  const refreshMaterials = useAtomRefresh(materialsQuery);

  const pendingInvalidations = useRef<Array<ReturnType<typeof invalidationsForToolCall>>>([]);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const lastAttempt = useRef<{ prompt: string; messages: readonly AgentMessage[] } | undefined>(undefined);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const run = async (prompt: string, history: readonly AgentMessage[]) => {
    const controller = new AbortController();
    abortRef.current = controller;
    lastAttempt.current = { prompt, messages: history };

    setStatus("sending");
    setError(undefined);
    setStopped(false);
    setInput("");
    pendingInvalidations.current = [];

    try {
      for await (const event of streamTutorMessage(
        { input: prompt, messages: history },
        { signal: controller.signal }
      )) {
        if (event.type === "done") continue;

        const message = event.message;
        setMessages((current) => [...current, message]);

        if (message.role === "tool-call") {
          pendingInvalidations.current.push(invalidationsForToolCall(message));
        }

        if (message.role === "tool-result") {
          const keys = pendingInvalidations.current.shift() ?? [];
          if (!message.isFailure) {
            applyInvalidations(keys, { refreshArtifacts, refreshMaterials });
          }
        }
      }

      lastAttempt.current = undefined;
    } catch (cause) {
      const outcome = resolveStreamFailure(cause);
      if (outcome.keepMessages) {
        // Stop is a clean halt, not an undo: what already arrived stays on screen and
        // there is nothing to retry.
        setStopped(true);
        lastAttempt.current = undefined;
      } else {
        setMessages(history);
      }
      if (outcome.restoreInput) {
        setInput(prompt);
      }
      if (outcome.showError) {
        setError(cause instanceof Error ? cause.message : "Something went wrong. Try again.");
      }
    } finally {
      abortRef.current = undefined;
      setStatus("idle");
    }
  };

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || status === "sending") return;
    void run(trimmed, messages);
  };

  const retry = () => {
    const attempt = lastAttempt.current;
    if (attempt === undefined || status === "sending") return;
    void run(attempt.prompt, attempt.messages);
  };

  const stop = () => abortRef.current?.abort();

  const clear = () => {
    setMessages([]);
    setError(undefined);
    setStopped(false);
    lastAttempt.current = undefined;
  };

  return {
    messages,
    input,
    status,
    error,
    canRetry: lastAttempt.current !== undefined,
    stopped,
    setInput,
    submit,
    stop,
    retry,
    clear
  };
};
