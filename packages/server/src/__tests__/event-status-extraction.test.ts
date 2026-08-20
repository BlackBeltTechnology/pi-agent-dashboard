import { describe, it, expect } from "vitest";
import { extractSessionUpdates } from "../session/event-status-extraction.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeEvent(eventType: string, data: Record<string, unknown> = {}): DashboardEvent {
  return { eventType, timestamp: Date.now(), data: { type: eventType, ...data } };
}

describe("extractSessionUpdates", () => {
  it("should return streaming status on agent_start", () => {
    const updates = extractSessionUpdates(makeEvent("agent_start"));
    expect(updates).toEqual({ status: "streaming", currentTool: null });
  });

  it("should return idle status on agent_end", () => {
    const updates = extractSessionUpdates(makeEvent("agent_end"));
    expect(updates).toEqual({ status: "idle", currentTool: null });
  });

  it("should return currentTool on tool_execution_start", () => {
    const updates = extractSessionUpdates(makeEvent("tool_execution_start", { toolName: "Read" }));
    expect(updates).toEqual({ currentTool: "Read" });
  });

  it("should clear currentTool on tool_execution_end", () => {
    const updates = extractSessionUpdates(makeEvent("tool_execution_end", { toolName: "Read" }));
    expect(updates).toEqual({ currentTool: null });
  });

  it("should extract model from model_select event", () => {
    const updates = extractSessionUpdates(
      makeEvent("model_select", {
        model: { provider: "anthropic", id: "claude-opus-4-6" },
      })
    );
    expect(updates).toEqual({ model: "anthropic/claude-opus-4-6" });
  });

  it("should extract model and thinkingLevel from model_select event", () => {
    const updates = extractSessionUpdates(
      makeEvent("model_select", {
        model: { provider: "anthropic", id: "claude-opus-4-6" },
        thinkingLevel: "high",
      })
    );
    expect(updates).toEqual({ model: "anthropic/claude-opus-4-6", thinkingLevel: "high" });
  });

  it("should return null for model_select without model data", () => {
    expect(extractSessionUpdates(makeEvent("model_select"))).toBeNull();
  });

  it("should return null for unrelated events", () => {
    expect(extractSessionUpdates(makeEvent("message_update"))).toBeNull();
    expect(extractSessionUpdates(makeEvent("turn_start"))).toBeNull();
  });
});

// ── Compaction signal (test-plan #E9) ──
// `SessionStatus` has no compacting member, so the reload dispatcher's
// busy-session refusal reads a dedicated boolean derived from the two
// compaction events the bridge already forwards.
// See change: fix-out-of-band-reload.
describe("extractSessionUpdates — compaction signal", () => {
  it("flags the session as compacting on session_before_compact", () => {
    expect(extractSessionUpdates(makeEvent("session_before_compact"))).toEqual({
      compacting: true,
    });
  });

  it("clears the flag on session_compact", () => {
    expect(extractSessionUpdates(makeEvent("session_compact"))).toEqual({
      compacting: false,
    });
  });

  it("does not disturb currentTool (no fold when hasPendingPrompt)", () => {
    // The `hasPendingPrompt` fold only rewrites an update that CLEARS
    // currentTool. A compaction update carries no currentTool at all, so it
    // must pass through untouched rather than inventing an "ask_user" tool.
    expect(extractSessionUpdates(makeEvent("session_before_compact"), true)).toEqual({
      compacting: true,
    });
  });
});

// ── The `hasPendingPrompt` fold (M1) ──
// See change: restore-ask-user-tool-state-on-reconnect, test-plan #E4–#E8.
describe("extractSessionUpdates — hasPendingPrompt fold", () => {
  it("#E4 lets a live tool win: tool_execution_start is not folded", () => {
    const updates = extractSessionUpdates(
      makeEvent("tool_execution_start", { toolName: "bash" }),
      true,
    );
    expect(updates).toEqual({ currentTool: "bash" });
  });

  it("#E5 folds agent_start's empty currentTool to ask_user", () => {
    const updates = extractSessionUpdates(makeEvent("agent_start"), true);
    expect(updates).toEqual({ status: "streaming", currentTool: "ask_user" });
  });

  it("#E6 folds agent_end's empty currentTool to ask_user (idle + ask_user is legal)", () => {
    const updates = extractSessionUpdates(makeEvent("agent_end"), true);
    expect(updates).toEqual({ status: "idle", currentTool: "ask_user" });
  });

  it("#E7 folds tool_execution_end's empty currentTool to ask_user", () => {
    const updates = extractSessionUpdates(
      makeEvent("tool_execution_end", { toolName: "Read" }),
      true,
    );
    expect(updates).toEqual({ currentTool: "ask_user" });
  });

  it("#E4 folds a tool_execution_start with a missing toolName (empty ⇒ ask_user)", () => {
    const updates = extractSessionUpdates(makeEvent("tool_execution_start"), true);
    expect(updates).toEqual({ currentTool: "ask_user" });
  });

  it("#E5 leaves model_select untouched — absent currentTool means unchanged, not empty", () => {
    const updates = extractSessionUpdates(
      makeEvent("model_select", { model: { provider: "anthropic", id: "claude-opus-4-6" } }),
      true,
    );
    expect(updates).toEqual({ model: "anthropic/claude-opus-4-6" });
    expect(updates).not.toHaveProperty("currentTool");
  });

  it("#E8 is byte-identical to the pre-change output for every handled event type when no prompt is pending", () => {
    const events = [
      makeEvent("agent_start"),
      makeEvent("agent_end"),
      makeEvent("tool_execution_start", { toolName: "Read" }),
      makeEvent("tool_execution_end", { toolName: "Read" }),
      makeEvent("model_select", {
        model: { provider: "anthropic", id: "claude-opus-4-6" },
        thinkingLevel: "high",
      }),
    ];
    // The pre-change call shape is the single-argument one; the default must
    // agree with an explicit `false` and with the values asserted above.
    const expected = [
      { status: "streaming", currentTool: null },
      { status: "idle", currentTool: null },
      { currentTool: "Read" },
      { currentTool: null },
      { model: "anthropic/claude-opus-4-6", thinkingLevel: "high" },
    ];
    for (const [i, event] of events.entries()) {
      expect(extractSessionUpdates(event, false)).toEqual(expected[i]);
      expect(extractSessionUpdates(event)).toEqual(expected[i]);
    }
  });
});
