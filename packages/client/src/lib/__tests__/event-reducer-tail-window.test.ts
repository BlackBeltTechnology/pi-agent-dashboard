import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { foldReplayBuffer } from "../event-reducer.js";

function event(eventType: string, data: Record<string, unknown> = {}): DashboardEvent {
  return { eventType, timestamp: 1, data };
}

describe("foldReplayBuffer tail-window orphan tolerance", () => {
  it("drops leading message/tool continuations from an unsafe capped cut", () => {
    const state = foldReplayBuffer([
      event("message_update", { content: "orphan" }),
      event("message_end", { content: "orphan" }),
      event("tool_execution_end", { toolCallId: "tool-orphan" }),
      event("agent_start"),
    ]);

    expect(state.messages.some((message) => message.content.includes("orphan"))).toBe(false);
    expect(state.isStreaming).toBe(true);
    expect(state.toolCalls.has("tool-orphan")).toBe(false);
  });
});
