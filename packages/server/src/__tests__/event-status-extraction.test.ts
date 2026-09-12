import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { extractSessionUpdates, reconcileAgentLiveness } from "../session/event-status-extraction.js";

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

  // pi 0.84.3 added `session_compact_failed`. Without it a failed or aborted
  // compaction leaves `compacting: true` forever, and the reload dispatcher
  // refuses every subsequent reload for that session.
  it("clears the flag on session_compact_failed (pi >= 0.84.3)", () => {
    expect(
      extractSessionUpdates(
        makeEvent("session_compact_failed", { reason: "threshold", aborted: false }),
      ),
    ).toEqual({ compacting: false });
  });

  it("clears the flag on an ABORTED session_compact_failed too", () => {
    expect(
      extractSessionUpdates(makeEvent("session_compact_failed", { reason: "manual", aborted: true })),
    ).toEqual({ compacting: false });
  });

  // X1 (change: update-pi-core-0-85-adopt-apis, design §8): pi 0.85.1 abort
  // genuinely CANCELS an in-progress manual compaction (pi#8920). The audit's
  // answer is that the abort path STILL emits `session_compact_failed` — pi's
  // `AgentSession.compact()` catch calls
  // `_emitSessionCompactFailed({reason:"manual", aborted:true})` — so the
  // latch does not strand and no defensive timeout is added. This pins the
  // full set→clear sequence.
  it("X1: an aborted manual compaction clears the latch (no strand)", () => {
    expect(extractSessionUpdates(makeEvent("session_before_compact"))).toEqual({
      compacting: true,
    });
    expect(
      extractSessionUpdates(makeEvent("session_compact_failed", { reason: "manual", aborted: true })),
    ).toEqual({ compacting: false });
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

// ── Blocking extension UI prompts (pi >= 0.84.4) ──
// `ui_prompt_start` / `ui_prompt_end` let a host tell "the agent is working"
// apart from "pi is parked waiting on a ctx.ui prompt". The dashboard already
// renders `currentTool: "ask_user"` as input-requested, so a blocking UI prompt
// reuses that surface instead of leaving the last tool name on screen.
describe("extractSessionUpdates — blocking UI prompts", () => {
  it("marks the session input-requested on ui_prompt_start", () => {
    expect(
      extractSessionUpdates(makeEvent("ui_prompt_start", { reason: "ui_prompt", kind: "select" })),
    ).toEqual({ currentTool: "ask_user" });
  });

  it("clears the marker on ui_prompt_end", () => {
    expect(
      extractSessionUpdates(makeEvent("ui_prompt_end", { reason: "ui_prompt", kind: "select" })),
    ).toEqual({ currentTool: null });
  });

  it("leaves status alone — a UI prompt is not a run boundary", () => {
    const start = extractSessionUpdates(makeEvent("ui_prompt_start", { kind: "confirm" }));
    const end = extractSessionUpdates(makeEvent("ui_prompt_end", { kind: "confirm" }));
    expect(start).not.toHaveProperty("status");
    expect(end).not.toHaveProperty("status");
  });

  it("ui_prompt_end still folds to ask_user while a PromptBus prompt is unanswered", () => {
    // The fold rewrites an update that CLEARS currentTool, so a ctx.ui prompt
    // ending must not erase a still-pending `ask_user` tool prompt.
    expect(extractSessionUpdates(makeEvent("ui_prompt_end", { kind: "input" }), true)).toEqual({
      currentTool: "ask_user",
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

/**
 * Decision table over the full `status` × `agentRunning` domain.
 * See change: fix-stuck-streaming-status-latch (design D9, test-plan #E1–#E8).
 */
describe("reconcileAgentLiveness", () => {
  it("settles a latched streaming session when the agent is not running (#E1)", () => {
    expect(reconcileAgentLiveness("streaming", false)).toEqual({
      status: "idle",
      currentTool: null,
    });
  });

  it("corrects idle → streaming without touching currentTool (#E2)", () => {
    const updates = reconcileAgentLiveness("idle", true);
    expect(updates).toEqual({ status: "streaming" });
    expect(updates && "currentTool" in updates).toBe(false);
  });

  it("corrects active → streaming (#E3)", () => {
    expect(reconcileAgentLiveness("active", true)).toEqual({ status: "streaming" });
  });

  it("is inert for active + not running — the routine resting state (#E4)", () => {
    expect(reconcileAgentLiveness("active", false)).toBeNull();
  });

  it("never resurrects an ended session (#E5)", () => {
    expect(reconcileAgentLiveness("ended", true)).toBeNull();
  });

  it("is inert for ended + not running (#E6)", () => {
    expect(reconcileAgentLiveness("ended", false)).toBeNull();
  });

  it("is inert when streaming agrees with a running agent (#E7)", () => {
    expect(reconcileAgentLiveness("streaming", true)).toBeNull();
  });

  it("is inert when idle agrees with a stopped agent (#E8)", () => {
    expect(reconcileAgentLiveness("idle", false)).toBeNull();
  });
});
