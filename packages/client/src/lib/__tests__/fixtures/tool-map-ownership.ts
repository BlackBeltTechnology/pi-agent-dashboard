import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { expect } from "vitest";
import { createInitialState, type SessionState } from "../../chat/event-reducer.js";

export const event = (eventType: string, data: Record<string, unknown> = {}, timestamp = 1000): DashboardEvent =>
  ({ eventType, data, timestamp });
export const start = (id: string, toolName = "read", timestamp = 1000) =>
  event("tool_execution_start", { toolCallId: id, toolName, args: { path: `${id}.ts` } }, timestamp);
export const end = (id: string, result = "done", toolName = "read", timestamp = 2000) =>
  event("tool_execution_end", { toolCallId: id, toolName, result, isError: false }, timestamp);
export const text = (value: string) => event("message_update", { message: { role: "assistant", content: [{ type: "text", text: value }] } });
export const tick = (id: string, agentId: string) => event("tool_execution_update", {
  toolCallId: id, toolName: "Agent", partialResult: { content: [{ type: "text", text: "working" }], details: { agentId, status: "running" } },
}, 1500);
export const row = (state: SessionState, id: string) => state.messages.find((m) => m.toolCallId === id);

export function historical(size: number): SessionState {
  const state = createInitialState();
  for (let i = 0; i < size; i++) state.toolCalls.set(`history-${i}`, {
    toolCallId: `history-${i}`, toolName: "read", status: "complete", startedAt: 1, emittedAtInferenceSeq: 0,
    args: { path: `history-${i}.ts` },
  });
  return state;
}

/** Retain references AND deep values, including undefined fields and nested arrays. */
export function retain(state: { toolCalls: Map<string, unknown>; messages: unknown[] }) {
  const map = state.toolCalls;
  const entries = [...map];
  const before = entries.map(([id, value]) => [id, structuredClone(value)]);
  const messages = structuredClone(state.messages);
  return () => {
    expect([...map]).toEqual(before);
    for (const [id, value] of entries) expect(map.get(id)).toBe(value);
    expect(state.messages).toEqual(messages);
  };
}

/** Observe ONLY this tool map, never global Map or unrelated maps. */
export function observe(map: SessionState["toolCalls"]) {
  let copies = 0;
  let enumerations = 0;
  const keys = [Symbol.iterator, "entries", "values", "keys", "forEach"] as const;
  const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(map, key));
  for (const key of keys) {
    const method = map[key];
    Object.defineProperty(map, key, { configurable: true, value: function (...args: unknown[]) {
      if (key === Symbol.iterator) copies++;
      enumerations++;
      return Reflect.apply(method, map, args);
    } });
  }
  return {
    counts: () => ({ copies, enumerations }),
    restore() {
      keys.forEach((key, i) => {
        const descriptor = descriptors[i];
        if (descriptor) Object.defineProperty(map, key, descriptor);
        else Reflect.deleteProperty(map, key);
      });
    },
  };
}

export function burst(): DashboardEvent[] {
  return [
    event("agent_start"),
    event("message_start", { message: { role: "assistant", content: [] } }, 1100),
    event("message_update", { assistantMessageEvent: { type: "thinking_start" } }, 1200),
    event("message_update", { assistantMessageEvent: { type: "thinking_delta", delta: "check" } }, 1300),
    event("message_update", { assistantMessageEvent: { type: "thinking_end" } }, 1400),
    text("Reading."), start("c1", "read", 1500), end("c1", "file body", "read", 1600),
    start("tc-agent", "Agent", 1700), tick("tc-agent", "ag-fold"),
    event("subagent_completed", { id: "ag-fold", result: "R" }, 1900),
    text("Done."), event("agent_end", {}, 2100), event("agent_settled", {}, 2200),
  ];
}

/** Mulberry32: dependency-free reproducible variation, seed printed by each assertion context. */
export function random(seed: number) {
  return (limit: number) => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % limit;
  };
}
