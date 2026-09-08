import { describe, it, expect } from "vitest";
import { AgentMessage } from "../message.ts";

describe("AgentMessage.user", () => {
  it("creates user message", () => {
    const m = AgentMessage.user("hola");
    expect(m.role).toBe("user");
    expect(m.content).toBe("hola");
  });
});

describe("AgentMessage.assistant", () => {
  it("creates assistant message", () => {
    const m = AgentMessage.assistant("respuesta");
    expect(m.role).toBe("assistant");
    expect(m.content).toBe("respuesta");
  });
});

describe("AgentMessage.toolCall", () => {
  it("creates tool-call message without id", () => {
    const m = AgentMessage.toolCall("load_skill", { name: "math" });
    expect(m.role).toBe("tool-call");
    expect(m.name).toBe("load_skill");
    expect(m.input).toEqual({ name: "math" });
    expect(m.id).toBeUndefined();
  });

  it("creates tool-call message with id", () => {
    const m = AgentMessage.toolCall("load_skill", { name: "math" }, "call_abc||sig123");
    expect(m.id).toBe("call_abc||sig123");
  });

  it("omits id key when undefined", () => {
    const m = AgentMessage.toolCall("cli", { input: "list" });
    expect(Object.prototype.hasOwnProperty.call(m, "id")).toBe(false);
  });
});

describe("AgentMessage.toolResult", () => {
  it("creates tool-result message", () => {
    const m = AgentMessage.toolResult("cli", "resultado", false);
    expect(m.role).toBe("tool-result");
    expect(m.name).toBe("cli");
    expect(m.result).toBe("resultado");
    expect(m.isFailure).toBe(false);
  });

  it("marks failures correctly", () => {
    const m = AgentMessage.toolResult("cli", "Error: not found", true);
    expect(m.isFailure).toBe(true);
  });
});
