/**
 * Liveness reconcile in the Agent finalizer: `subagent_stop_result` and
 * `subagent_registry_snapshot` end a subagent the session does not run
 * (`untracked`) or apply its known final status (`session_reconcile`), guarded by
 * the per-subagent `lastFrameAt` freshness stamp.
 *
 * See change: fix-background-subagent-ghost-rows (test-plan #E9–#E14, #F3, #F4, #F12, #X4).
 */
import type { SubagentState } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/subagent-types.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import { type PluginSubagentState, sessionEventReducer } from "../sessionEventReducer.js";
import { type AgentFinalizerState, toolRowFinalizers } from "../toolRowFinalizer.js";

const finalizer = toolRowFinalizers[0];
const ev = (eventType: string, data: Record<string, unknown>, timestamp = 1000): DashboardEvent => ({ eventType, timestamp, data });
const sub = (id: string, status: SubagentState["status"], extra: Partial<PluginSubagentState> = {}): PluginSubagentState => ({
  id,
  type: "t",
  description: "d",
  status,
  ...extra,
});
const stateOf = (subs: PluginSubagentState[], over: Partial<AgentFinalizerState> = {}): AgentFinalizerState => {
  const subagents = new Map<string, SubagentState>();
  for (const s of subs) {
    subagents.set(s.id, s);
    if (s.agentSessionId) subagents.set(s.agentSessionId, s);
  }
  return { subagents, messages: [], toolCalls: new Map(), ...over };
};
const snapshot = (entries: Array<{ agentId: string; status: string }>, takenAt: number) =>
  ev("subagent_registry_snapshot", { scope: "registry", entries, takenAt }, takenAt + 5);
const stopResult = (agentId: string, phase: string, answeredAt: number, status?: string) =>
  ev("subagent_stop_result", { agentId, outcome: "ignored", phase, answeredAt, ...(status ? { status } : {}) }, answeredAt + 5);
const reduceSession = (s: AgentFinalizerState, e: DashboardEvent) =>
  finalizer.onSessionEvent!(s, e) ?? (sessionEventReducer.reduce(s, e) as AgentFinalizerState);

describe("lastFrameAt freshness stamp (#E14)", () => {
  it("is set by created, started, entry, delta and the Agent progress tick", () => {
    let s: AgentFinalizerState = stateOf([]);
    const stamps: number[] = [];
    const read = () => (s.subagents.get("A") as PluginSubagentState | undefined)?.lastFrameAt;
    s = reduceSession(s, ev("subagent_created", { id: "A", type: "t", description: "d", details: { agentSessionId: "S7" } }, 100));
    stamps.push(read()!);
    s = reduceSession(s, ev("subagent_started", { id: "A" }, 200));
    stamps.push(read()!);
    s = reduceSession(s, ev("subagent_entry", { agentId: "A", index: 0, entry: { type: "text", text: "x" } }, 300));
    stamps.push(read()!);
    s = reduceSession(s, ev("subagent_delta", { agentId: "A", blockId: 1, offset: 0, kind: "text", text: "y" }, 400));
    stamps.push(read()!);
    s = {
      ...s,
      messages: [{ role: "toolResult", toolName: "Agent", toolStatus: "running", toolCallId: "tc", toolDetails: { agentId: "A" } }],
      toolCalls: new Map([["tc", { status: "running" }]]),
    };
    s = finalizer.onToolExecution!(s, ev("tool_execution_update", { toolCallId: "tc", partialResult: { details: { agentId: "A" } } }, 500), {
      prior: s,
    }) ?? s;
    stamps.push(read()!);
    expect(stamps).toEqual([100, 200, 300, 400, 500]);
    // Same object under the runner session id.
    expect(s.subagents.get("S7")).toBe(s.subagents.get("A"));
  });
});

describe("registry snapshot reconcile (#E9, #E10, #E11, #E13, #X4)", () => {
  it("ends live subagents absent from the snapshot as untracked; terminal ones untouched (#E9)", () => {
    const s = stateOf([
      sub("A", "running"),
      sub("B", "created"),
      sub("C", "completed", { result: "done" }),
      sub("D", "failed", { error: "x" }),
      sub("E", "stopped"),
    ]);
    const next = finalizer.onSessionEvent!(s, snapshot([], 1000))!;
    expect(next.subagents.get("A")).toMatchObject({ status: "failed", healedBy: "untracked" });
    expect(next.subagents.get("B")).toMatchObject({ status: "failed", healedBy: "untracked" });
    expect(next.subagents.get("C")).toBe(s.subagents.get("C"));
    expect(next.subagents.get("D")).toBe(s.subagents.get("D"));
    expect(next.subagents.get("E")).toBe(s.subagents.get("E"));
  });

  it.each([
    [999, "untracked"],
    [1000, "untracked"],
    [1001, "running"],
    [undefined, "untracked"],
  ])("lastFrameAt %s vs takenAt/answeredAt 1000 → %s, for both frames (#E10)", (lastFrameAt, want) => {
    const s = stateOf([sub("A", "running", lastFrameAt === undefined ? {} : { lastFrameAt })]);
    for (const frame of [snapshot([], 1000), stopResult("A", "unknown", 1000)]) {
      const a = finalizer.onSessionEvent!(s, frame)!.subagents.get("A")!;
      if (want === "running") expect(a.status, frame.eventType).toBe("running");
      else expect(a, frame.eventType).toMatchObject({ status: "failed", healedBy: "untracked" });
    }
  });

  it("applies a snapshot's terminal status; a later real end wins (#E11)", () => {
    const s = stateOf([sub("A", "running")]);
    const healed = finalizer.onSessionEvent!(s, snapshot([{ agentId: "A", status: "completed" }], 1000))!;
    expect(healed.subagents.get("A")).toMatchObject({ status: "completed", healedBy: "session_reconcile" });
    expect(healed.subagents.get("A")?.result).toBeUndefined();
    const real = finalizer.onSessionEvent!(healed, ev("subagent_completed", { id: "A", result: "R" }, 2000))!;
    expect(real.subagents.get("A")).toMatchObject({ status: "completed", result: "R" });
    expect(real.subagents.get("A")?.healedBy).toBeUndefined();
  });

  it("keeps a subagent listed as running", () => {
    const s = stateOf([sub("A", "running"), sub("B", "running")]);
    const next = finalizer.onSessionEvent!(s, snapshot([{ agentId: "B", status: "running" }], 1000))!;
    expect(next.subagents.get("A")).toMatchObject({ status: "failed", healedBy: "untracked" });
    expect(next.subagents.get("B")?.status).toBe("running");
  });

  it("touches only the session it is reduced into (#E13)", () => {
    const s1 = stateOf([sub("A", "running")]);
    const s2 = stateOf([sub("A", "running")]);
    const next1 = finalizer.onSessionEvent!(s1, snapshot([], 1000))!;
    expect(next1.subagents.get("A")).toMatchObject({ healedBy: "untracked" });
    expect(s2.subagents.get("A")?.status).toBe("running");
  });

  it("keeps a subagent created after the snapshot was taken (#X4)", () => {
    const s = stateOf([sub("A", "created", { lastFrameAt: 200 })]);
    const next = finalizer.onSessionEvent!(s, snapshot([], 150))!;
    expect(next.subagents.get("A")?.status).toBe("created");
  });
});

describe("stop answer reconcile (#E12, #F3)", () => {
  it.each([
    ["completed", { status: "completed", healedBy: "session_reconcile" }],
    ["failed", { status: "failed", healedBy: "session_reconcile" }],
    ["stopped", { status: "stopped", healedBy: "session_reconcile" }],
    [undefined, { status: "failed", healedBy: "untracked" }],
  ])("terminal answer with status %s → %j (#E12)", (status, want) => {
    const s = stateOf([sub("A", "running")]);
    const next = finalizer.onSessionEvent!(s, stopResult("A", "terminal", 1000, status))!;
    expect(next.subagents.get("A")).toMatchObject(want);
  });

  it("a queued/running answer changes nothing (the real end follows)", () => {
    const s = stateOf([sub("A", "running")]);
    for (const phase of ["queued", "running"]) {
      expect(finalizer.onSessionEvent!(s, stopResult("A", phase, 1000))).toBe(s);
    }
  });

  it("an unknown answer finalizes a foreground Agent row with the untracked marker (#F3)", () => {
    const reduce = vi.fn((st: AgentFinalizerState, _e: DashboardEvent) => st);
    const s = stateOf([sub("A", "running")], {
      messages: [{ role: "toolResult", toolName: "Agent", toolStatus: "running", toolCallId: "tc", toolDetails: { agentId: "A" } }],
      toolCalls: new Map([["tc", { status: "running" }]]),
    });
    const next = finalizer.onSessionEvent!(s, stopResult("A", "unknown", 1000), { reduce })!;
    expect(next.subagents.get("A")).toMatchObject({ status: "failed", healedBy: "untracked" });
    expect(reduce).toHaveBeenCalledTimes(1);
    expect(reduce.mock.calls[0][1]).toMatchObject({
      eventType: "tool_execution_end",
      data: { toolCallId: "tc", toolName: "Agent", isError: true, healedBy: "untracked" },
    });
  });
});

describe("revive and projected ends (#F4, #F12)", () => {
  it("a live subagent_started revives an untracked background subagent (#F4)", () => {
    const s = stateOf([sub("A", "running", { background: true })]);
    const ended = finalizer.onSessionEvent!(s, snapshot([], 1000))!;
    expect(ended.subagents.get("A")).toMatchObject({ healedBy: "untracked" });
    const revived = reduceSession(ended, ev("subagent_started", { id: "A" }, 2000));
    const a = revived.subagents.get("A") as PluginSubagentState;
    expect(a.status).toBe("running");
    expect(a.healedBy).toBeUndefined();
    expect(a.background).toBe(true);
  });

  it("an Agent progress tick reopens a subagent ended untracked", () => {
    const s = stateOf([sub("A", "failed", { healedBy: "untracked", error: "x" })], {
      messages: [
        { role: "toolResult", toolName: "Agent", toolStatus: "error", toolCallId: "tc", toolDetails: { agentId: "A", healedBy: "session_ended" } },
      ],
      toolCalls: new Map([["tc", { status: "running" }]]),
    });
    const next = finalizer.onToolExecution!(s, ev("tool_execution_update", { toolCallId: "tc", partialResult: { details: { agentId: "A" } } }, 3000), {
      prior: s,
    })!;
    expect(next.subagents.get("A")?.status).toBe("running");
    expect(next.subagents.get("A")?.healedBy).toBeUndefined();
  });

  it("a deferred projected end keeps the 40-step timeline (#F12)", () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({ kind: "text" as const, text: `s${i}`, ts: i }));
    const s = stateOf([sub("A", "running", { entries })]);
    const next = finalizer.onSessionEvent!(
      s,
      ev("subagent_completed", { id: "A", result: "cut", details: { status: "completed" }, deferredProjection: true }),
    )!;
    expect(next.subagents.get("A")?.status).toBe("completed");
    expect(next.subagents.get("A")?.entries).toHaveLength(40);
  });
});
