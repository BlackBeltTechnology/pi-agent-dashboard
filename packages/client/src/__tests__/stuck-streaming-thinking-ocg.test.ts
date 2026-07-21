import { describe, it, expect } from "vitest";
import { reduceEvent, createInitialState } from "../lib/event-reducer.js";

function ev(eventType: string, data: any = {}, ts = Date.now()) {
  return { eventType, timestamp: ts, data } as any;
}

describe("stuck streaming thinking (ocg/9router)", () => {
  it("commits thinking at tool_execution_start even when thinking_end is missing", () => {
    let s = createInitialState();
    let t = 1000;
    s = reduceEvent(s, ev("agent_start", {}, t++));
    s = reduceEvent(s, ev("message_start", { message: { role: "assistant", content: [] } }, t++));
    s = reduceEvent(s, ev("message_update", { assistantMessageEvent: { type: "thinking_start" }, message: { role: "assistant" } }, t++));
    s = reduceEvent(s, ev("message_update", { assistantMessageEvent: { type: "thinking_delta", delta: "Analyze the request..." }, message: { role: "assistant" } }, t++));
    s = reduceEvent(s, ev("message_update", { assistantMessageEvent: { type: "toolcall_start" }, message: { role: "assistant" } }, t++));
    s = reduceEvent(s, ev("message_update", { assistantMessageEvent: { type: "toolcall_end" }, message: { role: "assistant" } }, t++));
    s = reduceEvent(s, ev("message_end", { message: { role: "assistant", content: [{ type: "toolCall", id: "call_1", name: "get_weather", arguments: { city: "Paris" } }] } }, t++));
    s = reduceEvent(s, ev("tool_execution_start", { toolCallId: "call_1", toolName: "get_weather", args: { city: "Paris" } }, t++));
    s = reduceEvent(s, ev("agent_end", {}, t++));

    expect(s.streamingThinking).toBe("");
    expect(s.messages.filter((m) => m.role === "thinking").length).toBe(1);
    const thinking = s.messages.find((m) => m.role === "thinking");
    expect(thinking?.content).toBe("Analyze the request...");
  });

  it("does not double-commit when thinking_end DOES arrive", () => {
    let s = createInitialState();
    let t = 1000;
    s = reduceEvent(s, ev("agent_start", {}, t++));
    s = reduceEvent(s, ev("message_start", { message: { role: "assistant", content: [] } }, t++));
    s = reduceEvent(s, ev("message_update", { assistantMessageEvent: { type: "thinking_start" }, message: { role: "assistant" } }, t++));
    s = reduceEvent(s, ev("message_update", { assistantMessageEvent: { type: "thinking_delta", delta: "thinking..." }, message: { role: "assistant" } }, t++));
    s = reduceEvent(s, ev("message_update", { assistantMessageEvent: { type: "thinking_end" }, message: { role: "assistant" } }, t++));
    s = reduceEvent(s, ev("message_end", { message: { role: "assistant", content: [{ type: "text", text: "done" }] } }, t++));
    s = reduceEvent(s, ev("agent_end", {}, t++));

    expect(s.streamingThinking).toBe("");
    expect(s.messages.filter((m) => m.role === "thinking").length).toBe(1);
  });

  it("no thinking row when there was no thinking", () => {
    let s = createInitialState();
    let t = 1000;
    s = reduceEvent(s, ev("agent_start", {}, t++));
    s = reduceEvent(s, ev("message_start", { message: { role: "assistant", content: [] } }, t++));
    s = reduceEvent(s, ev("message_end", { message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }, t++));
    s = reduceEvent(s, ev("agent_end", {}, t++));

    expect(s.streamingThinking).toBe("");
    expect(s.messages.filter((m) => m.role === "thinking").length).toBe(0);
  });
});
