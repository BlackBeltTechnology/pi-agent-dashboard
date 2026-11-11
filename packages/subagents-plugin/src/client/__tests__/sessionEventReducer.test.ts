/**
 * The subagents plugin's session event reducer slice: pure, ownership of
 * exactly the four stream events, same-ref when a frame changes nothing.
 * Behavioural replay coverage lives in the shell's reducer suites (they
 * register this slice through the vitest setup file).
 *
 * See change: decouple-plugins-from-core (task 4.2).
 */
import { matchesEventTypePattern } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/event-type-owners.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import type { SubagentState } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/subagent-types.js";
import { type PluginSubagentState, type SubagentSessionSlice, sessionEventReducer } from "../sessionEventReducer.js";

const ev = (eventType: string, data: Record<string, unknown>): DashboardEvent => ({ eventType, timestamp: 1000, data });
const empty = (): SubagentSessionSlice => ({ subagents: new Map() });

describe("subagents sessionEventReducer", () => {
  it("owns the four stream events plus completed/failed (written by the finalizer, 4.6)", () => {
    const claims = (t: string) => sessionEventReducer.eventTypes.some((p) => matchesEventTypePattern(p, t));
    for (const t of [
      "subagent_created",
      "subagent_started",
      "subagent_entry",
      "subagent_delta",
      "subagent_completed",
      "subagent_failed",
      // Liveness reconcile frames: owned so the shell asks the Agent finalizer.
      // See change: fix-background-subagent-ghost-rows.
      "subagent_stop_result",
      "subagent_registry_snapshot",
    ]) {
      expect(claims(t)).toBe(true);
    }
    for (const t of ["tool_execution_end", "tool_execution_update", "agent_settled"]) expect(claims(t)).toBe(false);
  });

  it("subagent_completed|failed are left to the Agent finalizer: the slice returns the same state", () => {
    const before = empty();
    expect(sessionEventReducer.reduce(before, ev("subagent_completed", { id: "a", result: "r" }))).toBe(before);
    expect(sessionEventReducer.reduce(before, ev("subagent_failed", { id: "a", error: "e" }))).toBe(before);
  });

  it("subagent_started writes a running state into a NEW map; the input state is never mutated", () => {
    const before = empty();
    const after = sessionEventReducer.reduce(before, ev("subagent_started", { id: "a", type: "Explore", description: "d" }));
    expect(after).not.toBe(before);
    expect(after.subagents).not.toBe(before.subagents);
    expect(before.subagents.size).toBe(0);
    expect(after.subagents.get("a")).toMatchObject({ status: "running", type: "Explore", startedAt: 1000 });
  });

  it.each([
    ["entry without an agent id", ev("subagent_entry", { index: 0, entry: { kind: "text", text: "x", ts: 1 } })],
    ["entry with a negative index", ev("subagent_entry", { agentId: "a", index: -1, entry: { kind: "text", text: "x", ts: 1 } })],
    ["delta with a bad kind", ev("subagent_delta", { agentId: "a", blockId: 0, offset: 0, kind: "x", text: "t" })],
    ["delta without an agent id", ev("subagent_delta", { blockId: 0, offset: 0, kind: "text", text: "t" })],
    ["an unrelated event", ev("agent_start", {})],
  ])("%s → same state reference", (_label, event) => {
    const before = empty();
    expect(sessionEventReducer.reduce(before, event)).toBe(before);
  });

  it("a duplicate entry index returns the same state", () => {
    const entry = { kind: "text", text: "x", ts: 1 };
    const s1 = sessionEventReducer.reduce(empty(), ev("subagent_entry", { agentId: "a", index: 0, entry }));
    expect(sessionEventReducer.reduce(s1, ev("subagent_entry", { agentId: "a", index: 0, entry }))).toBe(s1);
  });
});

// See change: show-background-subagents-in-dock (task 1.1, test-plan #E1).
describe("background flag on the subagent state (D1)", () => {
  const reduceAll = (events: DashboardEvent[]) => events.reduce((s, e) => sessionEventReducer.reduce(s, e), empty());
  const bg = (s: SubagentSessionSlice, id = "a") => (s.subagents.get(id) as { background?: true } | undefined)?.background;

  it("(a) created{background:true} marks the subagent; later frames without the field keep it", () => {
    const s1 = reduceAll([ev("subagent_created", { id: "a", type: "t", description: "d", details: { background: true } })]);
    expect(bg(s1)).toBe(true);
    const s2 = sessionEventReducer.reduce(s1, ev("subagent_started", { id: "a", type: "t", description: "d", details: {} }));
    expect(bg(s2)).toBe(true);
    const s3 = sessionEventReducer.reduce(s2, ev("subagent_entry", { agentId: "a", index: 0, entry: { kind: "text", text: "x", ts: 1 } }));
    expect(bg(s3)).toBe(true);
    const s4 = sessionEventReducer.reduce(s3, ev("subagent_delta", { agentId: "a", blockId: 1, offset: 0, kind: "text", text: "y" }));
    expect(bg(s4)).toBe(true);
  });

  it("(b) started{background:true} alone marks the subagent", () => {
    expect(bg(reduceAll([ev("subagent_started", { id: "a", details: { background: true } })]))).toBe(true);
  });

  it("(c) no frame with the field → no background key", () => {
    const s = reduceAll([
      ev("subagent_created", { id: "a", details: { background: false } }),
      ev("subagent_started", { id: "a", details: {} }),
    ]);
    expect(Object.hasOwn(s.subagents.get("a")!, "background")).toBe(false);
  });

  it("a later frame with background:false never clears the mark", () => {
    const s = reduceAll([
      ev("subagent_created", { id: "a", details: { background: true } }),
      ev("subagent_started", { id: "a", details: { background: false } }),
    ]);
    expect(bg(s)).toBe(true);
  });
});

// See change: fix-background-subagent-ghost-rows (test-plan #E14 slice half, #F4).
describe("subagents sessionEventReducer — lastFrameAt + untracked revive", () => {
  const reduce = (state: { subagents: Map<string, SubagentState> }, eventType: string, data: Record<string, unknown>, timestamp: number) =>
    sessionEventReducer.reduce(state, { eventType, timestamp, data }) as { subagents: Map<string, SubagentState> };
  const last = (s: { subagents: Map<string, SubagentState> }, id: string) => (s.subagents.get(id) as PluginSubagentState | undefined)?.lastFrameAt;

  it("stamps lastFrameAt from created/started/entry/delta, same object under agentSessionId (#E14)", () => {
    let s = { subagents: new Map<string, SubagentState>() };
    s = reduce(s, "subagent_created", { id: "A", type: "t", description: "d", details: { agentSessionId: "S7" } }, 100);
    expect(last(s, "A")).toBe(100);
    s = reduce(s, "subagent_started", { id: "A" }, 200);
    expect(last(s, "A")).toBe(200);
    s = reduce(s, "subagent_entry", { agentId: "A", index: 0, entry: { kind: "text", text: "x", ts: 1 } }, 300);
    expect(last(s, "A")).toBe(300);
    s = reduce(s, "subagent_delta", { agentId: "A", blockId: 1, offset: 0, kind: "text", text: "y" }, 400);
    expect(last(s, "A")).toBe(400);
    expect(s.subagents.get("S7")).toBe(s.subagents.get("A"));
  });

  it("subagent_started revives an untracked background subagent, keeping the background mark (#F4)", () => {
    const ended: PluginSubagentState = {
      id: "A", type: "t", description: "d", status: "failed", healedBy: "untracked", error: "x", background: true,
    };
    const s = reduce({ subagents: new Map([["A", ended as SubagentState]]) }, "subagent_started", { id: "A" }, 500);
    const a = s.subagents.get("A") as PluginSubagentState;
    expect(a.status).toBe("running");
    expect(a.healedBy).toBeUndefined();
    expect(a.background).toBe(true);
  });
});
