import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../event-reducer.js";

function ev(eventType: string, data: Record<string, unknown>, timestamp = 1): DashboardEvent {
  return { eventType, timestamp, data: { type: eventType, ...data } } as unknown as DashboardEvent;
}

function reduceAll(events: DashboardEvent[]): SessionState {
  let s = createInitialState();
  for (const e of events) s = reduceEvent(s, e);
  return s;
}

// Reproduces the cold full-replay order of the `tool-bash-large` faux scenario:
// user prompt → assistant emits a bash toolCall → tool result replays as a STUB
// (no body, preview only) → assistant emits closing text. Verifies the stub does
// NOT drop the tool card and carries the preview + stub metadata.
describe("event-reducer — stubbed tool_execution_end on cold replay", () => {
  const COMMAND = "printf 'HEADMARKER'; printf 'X%.0s' $(seq 1 6000); printf 'TAILMARKER'";
  const PREVIEW = `HEADMARKER${"X".repeat(190)}`; // first 200 chars, no TAILMARKER

  it("keeps the tool card and carries preview + stub metadata", () => {
    // Faithful to packages/shared/src/state-replay.ts emission order for an
    // assistant message that CONTAINS a toolCall, then the toolResult, then a
    // closing assistant text — the exact cold full-replay sequence page2 hits.
    const assistantWithToolCall = {
      role: "assistant",
      content: [{ type: "toolCall", id: "tc1", name: "bash", arguments: { command: COMMAND } }],
    };
    const state = reduceAll([
      ev("message_start", { message: { role: "user", content: "[[faux:tool-bash-large]] go" }, entryId: "u1" }),
      ev("tool_execution_start", { toolCallId: "tc1", toolName: "bash", args: { command: COMMAND } }),
      ev("message_update", { message: assistantWithToolCall }),
      ev("message_end", { message: assistantWithToolCall, entryId: "a1" }),
      ev("tool_execution_end", {
        toolCallId: "tc1",
        toolName: "bash",
        isError: false,
        stub: true,
        byteSize: 6020,
        preview: PREVIEW,
        entryId: "tc1",
      }),
      ev("message_update", { message: { role: "assistant", content: "large output done" } }),
      ev("message_end", { message: { role: "assistant", content: "large output done" }, entryId: "a2" }),
    ]);

    const card = state.messages.find((m) => m.role === "toolResult" && m.toolCallId === "tc1");
    expect(card, "tool card must survive cold replay").toBeTruthy();
    expect(card?.toolName).toBe("bash");
    expect(card?.stub).toBe(true);
    expect(card?.stubByteSize).toBe(6020);
    expect(card?.stubEntryId).toBe("tc1");
    // Body holds only the preview — the full tail is fetched on expand.
    expect(card?.result).toBe(PREVIEW);
    expect(card?.result).not.toContain("TAILMARKER");
  });
});
