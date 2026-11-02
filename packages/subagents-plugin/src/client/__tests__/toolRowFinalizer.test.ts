/**
 * The subagents plugin's `Agent` tool-row finalizer: pure hooks over the shell's
 * session state, the sole writer of `SessionState.subagents` besides the slice.
 * Shell-level replay coverage (live vs `/resume` commute, heal guards end to end)
 * lives in the client reducer suites, which register this finalizer through the
 * vitest setup file; these tests pin the hook contract in isolation, with a fake
 * `reduce` standing in for the shell's reducer.
 *
 * See change: decouple-plugins-from-core (task 4.6/4.7, test-plan #E46-#E48).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import { type AgentFinalizerState, SUBAGENT_DONE_NO_RESULT, toolRowFinalizers } from "../toolRowFinalizer.js";

const finalizer = toolRowFinalizers[0];
const ev = (eventType: string, data: Record<string, unknown>, timestamp = 1000): DashboardEvent => ({ eventType, timestamp, data });

const state = (over: Partial<AgentFinalizerState> = {}): AgentFinalizerState => ({
  subagents: new Map(),
  messages: [],
  toolCalls: new Map(),
  ...over,
});
const runningRow = (toolCallId: string, agentId: string) => ({
  role: "toolResult",
  toolName: "Agent",
  toolStatus: "running",
  toolCallId,
  toolDetails: { agentId, status: "running" },
});

describe("Agent tool-row finalizer", () => {
  it("is the Agent finalizer", () => {
    expect(toolRowFinalizers.map((f) => f.toolName)).toEqual(["Agent"]);
  });

  it("subagent_completed writes completed under both index keys with ONE object and never mutates its input", () => {
    const before = state();
    const after = finalizer.onSessionEvent?.(
      before,
      ev("subagent_completed", { id: "ag-1", result: "R", details: { agentId: "ag-1", agentSessionId: "s-9" } }),
    );
    expect(after).toBeDefined();
    const sub = after!.subagents.get("ag-1");
    expect(sub).toMatchObject({ status: "completed", result: "R" });
    expect(after!.subagents.get("s-9")).toBe(sub);
    expect(before.subagents.size).toBe(0);
  });

  it("subagent_completed stops the subagent's running row through the shell's reduce (trigger timestamp, trigger heal marker)", () => {
    const reduce = vi.fn((s: AgentFinalizerState, _e: DashboardEvent) => s);
    const base = state({ messages: [runningRow("A", "ag-1")], toolCalls: new Map([["A", { status: "running" }]]) });
    finalizer.onSessionEvent?.(base, ev("subagent_failed", { id: "ag-1", error: "boom", healedBy: "session_ended" }, 4242), { reduce });
    expect(reduce).toHaveBeenCalledTimes(1);
    expect(reduce.mock.calls[0][1]).toMatchObject({
      eventType: "tool_execution_end",
      timestamp: 4242,
      data: { toolCallId: "A", toolName: "Agent", result: "boom", isError: true, healedBy: "session_ended" },
    });
  });

  it("an empty completion result falls back to the never-empty body", () => {
    const reduce = vi.fn((s: AgentFinalizerState, _e: DashboardEvent) => s);
    const base = state({ messages: [runningRow("A", "ag-1")], toolCalls: new Map([["A", { status: "running" }]]) });
    finalizer.onSessionEvent?.(base, ev("subagent_completed", { id: "ag-1" }), { reduce });
    expect(reduce.mock.calls[0][1].data.result).toBe(SUBAGENT_DONE_NO_RESULT);
  });

  it("a healedBy terminal never changes a subagent that is already completed/failed", () => {
    const done = finalizer.onSessionEvent!(state(), ev("subagent_completed", { id: "ag-1", result: "R" }))!;
    const healed = finalizer.onSessionEvent!(done, ev("subagent_failed", { id: "ag-1", error: "x", healedBy: "session_ended" }))!;
    expect(healed.subagents.get("ag-1")).toMatchObject({ status: "completed", result: "R" });
    expect(healed.subagents.get("ag-1")?.healedBy).toBeUndefined();
  });

  it("a heal records provenance on a running subagent; a real terminal clears it", () => {
    const running = state({ subagents: new Map([["ag-1", { id: "ag-1", type: "t", description: "d", status: "running" }]]) });
    const healed = finalizer.onSessionEvent!(running, ev("subagent_failed", { id: "ag-1", error: "x", healedBy: "session_ended" }))!;
    expect(healed.subagents.get("ag-1")?.healedBy).toBe("session_ended");
    const real = finalizer.onSessionEvent!(healed, ev("subagent_completed", { id: "ag-1", result: "R" }))!;
    expect(real.subagents.get("ag-1")?.healedBy).toBeUndefined();
  });

  it("declines events it does not settle", () => {
    expect(finalizer.onSessionEvent?.(state(), ev("subagent_started", { id: "ag-1" }))).toBeUndefined();
    expect(finalizer.onToolExecution?.(state(), ev("tool_execution_start", { toolCallId: "A", toolName: "Agent" }))).toBeUndefined();
  });

  it("agent_settled finalizes only rows whose subagent is already terminal; the rest are declined to the neutral heal", () => {
    const reduce = vi.fn((s: AgentFinalizerState, _e: DashboardEvent) => ({ ...s }));
    const s0 = state({
      messages: [runningRow("A", "ag-A"), runningRow("B", "ag-B")],
      toolCalls: new Map([["A", { status: "running" }], ["B", { status: "running" }]]),
      subagents: new Map([["ag-A", { id: "ag-A", type: "t", description: "d", status: "completed", result: "done A" }]]),
    });
    const out = finalizer.onSessionEvent?.(s0, ev("agent_settled", {}), { reduce });
    expect(out).toBeDefined();
    expect(reduce).toHaveBeenCalledTimes(1);
    expect(reduce.mock.calls[0][1].data).toMatchObject({ toolCallId: "A", healedBy: "turn_settled", result: "done A" });
    // No terminal subagent at all → decline.
    expect(finalizer.onSessionEvent?.(state({ messages: [runningRow("B", "ag-B")], toolCalls: new Map([["B", { status: "running" }]]) }), ev("agent_settled", {}), { reduce })).toBeUndefined();
  });

  it("tool_execution_update hydrates running under both keys; a late tick never regresses a terminal subagent", () => {
    const row = runningRow("A", "ag-1");
    const tick = ev("tool_execution_update", {
      toolCallId: "A",
      partialResult: { content: [], details: { agentId: "ag-1", agentSessionId: "s-9", status: "running", subagentType: "Explore", description: "d" } },
    });
    const out = finalizer.onToolExecution!(state({ messages: [row], toolCalls: new Map([["A", { status: "running" }]]) }), tick)!;
    expect(out.subagents.get("ag-1")).toMatchObject({ status: "running", type: "Explore" });
    expect(out.subagents.get("s-9")).toBe(out.subagents.get("ag-1"));

    const terminal = state({
      messages: [row],
      toolCalls: new Map([["A", { status: "running" }]]),
      subagents: new Map([["ag-1", { id: "ag-1", type: "t", description: "d", status: "completed", result: "R" }]]),
    });
    const late = finalizer.onToolExecution!(terminal, tick, { reduce: (s) => s });
    expect(late!.subagents.get("ag-1")?.status).toBe("completed");
  });

  it("revives a subagent only when its terminal state came from the session_ended heal AND the row was reopened", () => {
    const healedSub = { id: "ag-1", type: "t", description: "d", status: "failed" as const, error: "parent session ended", healedBy: "session_ended" };
    const tick = ev("tool_execution_update", { toolCallId: "A", partialResult: { content: [], details: { agentId: "ag-1", status: "running" } } });
    const priorHealedRow = { ...runningRow("A", "ag-1"), toolStatus: "error", toolDetails: { agentId: "ag-1", healedBy: "session_ended" } };
    // After the shell's row-half reopen the row is running; `prior` still shows the healed row.
    const post = state({ messages: [runningRow("A", "ag-1")], toolCalls: new Map([["A", { status: "running" }]]), subagents: new Map([["ag-1", healedSub]]) });
    const prior = { ...post, messages: [priorHealedRow] };
    const out = finalizer.onToolExecution!(post, tick, { prior })!;
    expect(out.subagents.get("ag-1")).toMatchObject({ status: "running" });
    expect(out.subagents.get("ag-1")?.healedBy).toBeUndefined();
    expect(out.subagents.get("ag-1")?.error).toBeUndefined();

    // A REAL failure (no heal marker) is not revived.
    const realFail = state({ ...post, subagents: new Map([["ag-1", { ...healedSub, healedBy: undefined, error: "model refused" }]]) });
    const out2 = finalizer.onToolExecution!(realFail, tick, { prior: { ...realFail, messages: [priorHealedRow] }, reduce: (s) => s });
    expect(out2!.subagents.get("ag-1")?.status).toBe("failed");
    expect(out2!.subagents.get("ag-1")?.error).toBe("model refused");
  });

  it("tool_execution_end backfill merges non-undefined fields; a healedBy end never changes a terminal subagent", () => {
    const base = state({
      subagents: new Map([["ag-1", { id: "ag-1", type: "Explore", description: "d", status: "running", toolUses: 5 }]]),
    });
    const end = ev("tool_execution_end", {
      toolCallId: "A",
      toolName: "Agent",
      result: "done",
      isError: false,
      details: { agentId: "ag-1", agentSessionId: "s-9" },
    });
    const out = finalizer.onToolExecution!(base, end)!;
    const sub = out.subagents.get("ag-1")!;
    expect(sub).toMatchObject({ status: "completed", result: "done", toolUses: 5, type: "Explore" });
    expect(out.subagents.get("s-9")).toBe(sub);

    const healEnd = ev("tool_execution_end", { toolCallId: "A", toolName: "Agent", result: "ended", isError: true, healedBy: "session_ended", details: { agentId: "ag-1" } });
    expect(finalizer.onToolExecution!(out, healEnd)).toBeUndefined();
    // A heal on a running subagent records provenance.
    const healed = finalizer.onToolExecution!(base, healEnd)!;
    expect(healed.subagents.get("ag-1")).toMatchObject({ status: "failed", healedBy: "session_ended" });
  });

  it("declines a non-Agent end and an end without an agent id", () => {
    expect(finalizer.onToolExecution!(state(), ev("tool_execution_end", { toolCallId: "r", toolName: "read", result: "x", isError: false, details: { agentId: "ag-1" } }))).toBeUndefined();
    expect(finalizer.onToolExecution!(state(), ev("tool_execution_end", { toolCallId: "A", toolName: "Agent", result: "x", isError: false }))).toBeUndefined();
  });
});

// The shell revives an `elided` row on any top-level tick (fix-backfill-elides-live-tools
// D3); for a subagent already terminal this finalizer undoes it: `toolStatus` and the
// seeded `toolCalls` entry return to their prior state.
describe("Agent finalizer vs an elided-row revive (test-plan #F8, #F9)", () => {
  const elidedRow = { role: "toolResult", toolName: "Agent", toolStatus: "elided", toolCallId: "R" };
  const revivedRow = { ...elidedRow, toolStatus: "running", toolDetails: { agentId: "ag-1", status: "running" } };
  const tick = (agentId: string) =>
    ev("tool_execution_update", {
      toolCallId: "R",
      toolName: "Agent",
      partialResult: { content: [{ type: "text", text: "late" }], details: { agentId, status: "running" } },
    });

  it("#F8: a terminal subagent's late tick restores the elided status and drops the seeded entry", () => {
    const subagents = new Map([["ag-1", { id: "ag-1", status: "completed" } as never]]);
    const prior = state({ subagents, messages: [elidedRow], toolCalls: new Map() });
    const post = state({ subagents, messages: [revivedRow], toolCalls: new Map([["R", { status: "running" }]]) });
    const out = finalizer.onToolExecution!(post, tick("ag-1"), { prior, reduce: (s) => s })!;
    expect(out.messages[0].toolStatus).toBe("elided");
    expect(out.toolCalls.has("R")).toBe(false);
  });

  it("#F9: an unknown subagent's tick keeps the revived row running and hydrates the subagent", () => {
    const prior = state({ messages: [elidedRow], toolCalls: new Map() });
    const post = state({
      messages: [{ ...revivedRow, toolDetails: { agentId: "ag-2", status: "running" } }],
      toolCalls: new Map([["R", { status: "running" }]]),
    });
    const out = finalizer.onToolExecution!(post, tick("ag-2"), { prior, reduce: (s) => s })!;
    expect(out.messages[0].toolStatus).toBe("running");
    expect(out.toolCalls.get("R")?.status).toBe("running");
    expect(out.subagents.get("ag-2")?.status).toBe("running");
  });
});
