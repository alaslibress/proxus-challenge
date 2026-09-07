export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolCallMessage
  | ToolResultMessage;

export interface UserMessage {
  readonly role: "user";
  readonly content: string;
}

export interface AssistantMessage {
  readonly role: "assistant";
  readonly content: string;
}

export interface ToolCallMessage {
  readonly role: "tool-call";
  readonly name: string;
  readonly input: unknown;
  readonly id?: string;
}

export interface ToolResultMessage {
  readonly role: "tool-result";
  readonly name: string;
  readonly result: unknown;
  readonly isFailure: boolean;
}

export const AgentMessage = {
  user: (content: string): UserMessage => ({
    role: "user",
    content
  }),
  assistant: (content: string): AssistantMessage => ({
    role: "assistant",
    content
  }),
  toolCall: (name: string, input: unknown, id?: string): ToolCallMessage => ({
    role: "tool-call",
    name,
    input,
    ...(id !== undefined ? { id } : {})
  }),
  toolResult: (name: string, result: unknown, isFailure: boolean): ToolResultMessage => ({
    role: "tool-result",
    name,
    result,
    isFailure
  })
};
