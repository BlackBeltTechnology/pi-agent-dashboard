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
import type { SubagentState } from "../../subagent-types.js";
import { type PluginSubagentState, type SubagentSessionSlice, sessionEventReducer } from "../sessionEventReducer.js";
import { type AgentFinalizerState, toolRowFinalizers } from "../toolRowFinalizer.js";
import { subagentSlot, subagentsOf } from "../pluginState.js";

const ev = (eventType: string, data: Record<string, unknown>): DashboardEvent => ({ eventType, timestamp: 1000, data });
const empty = (): SubagentSessionSlice => ({ pluginState: subagentSlot(new Map())});

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
    expect(subagentsOf(after)).not.toBe(subagentsOf(before));
    expect(subagentsOf(before).size).toBe(0);
    expect(subagentsOf(after).get("a")).toMatchObject({ status: "running", type: "Explore", startedAt: 1000 });
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
  const bg = (s: SubagentSessionSlice, id = "a") => (subagentsOf(s).get(id) as { background?: true } | undefined)?.background;

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
    expect(Object.hasOwn(subagentsOf(s).get("a")!, "background")).toBe(false);
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
  const reduce = (state: SubagentSessionSlice, eventType: string, data: Record<string, unknown>, timestamp: number) =>
    sessionEventReducer.reduce(state, { eventType, timestamp, data }) as SubagentSessionSlice;
  const last = (s: SubagentSessionSlice, id: string) => (subagentsOf(s).get(id) as PluginSubagentState | undefined)?.lastFrameAt;

  it("stamps lastFrameAt from created/started/entry/delta, same object under agentSessionId (#E14)", () => {
    let s = { pluginState: subagentSlot(new Map<string, SubagentState>()) };
    s = reduce(s, "subagent_created", { id: "A", type: "t", description: "d", details: { agentSessionId: "S7" } }, 100);
    expect(last(s, "A")).toBe(100);
    s = reduce(s, "subagent_started", { id: "A" }, 200);
    expect(last(s, "A")).toBe(200);
    s = reduce(s, "subagent_entry", { agentId: "A", index: 0, entry: { kind: "text", text: "x", ts: 1 } }, 300);
    expect(last(s, "A")).toBe(300);
    s = reduce(s, "subagent_delta", { agentId: "A", blockId: 1, offset: 0, kind: "text", text: "y" }, 400);
    expect(last(s, "A")).toBe(400);
    expect(subagentsOf(s).get("S7")).toBe(subagentsOf(s).get("A"));
  });

  it("subagent_started revives an untracked background subagent, keeping the background mark (#F4)", () => {
    const ended: PluginSubagentState = {
      id: "A", type: "t", description: "d", status: "failed", healedBy: "untracked", error: "x", background: true,
    };
    const s = reduce({ pluginState: subagentSlot(new Map([["A", ended as SubagentState]]))}, "subagent_started", { id: "A" }, 500);
    const a = subagentsOf(s).get("A") as PluginSubagentState;
    expect(a.status).toBe("running");
    expect(a.healedBy).toBeUndefined();
    expect(a.background).toBe(true);
  });
});

// See change: move-subagents-to-plugin (tasks 4.10, 8.4–8.6, 9.4, 9.5, 9.9; test-plan #E29 #E30 #E33 #E34 #X5).
describe("subagents slice + finalizer — idempotency, reconcile, display, truncation", () => {
  const finalizer = toolRowFinalizers[0];
  type S = AgentFinalizerState;
  const fresh = (): S => ({ pluginState: subagentSlot(new Map()), messages: [], toolCalls: new Map() });
  const apply = (s: S, eventType: string, data: Record<string, unknown>, timestamp = 1000): S => {
    const e = ev(eventType, data);
    e.timestamp = timestamp;
    return (finalizer.onSessionEvent!(s, e) ?? sessionEventReducer.reduce(s, e)) as S;
  };
  const get = (s: S, id: string) => subagentsOf(s).get(id) as PluginSubagentState | undefined;
  const entry = { kind: "text", text: "x", ts: 1 };

  describe("applying the same event twice equals applying it once (#E34)", () => {
    const arms: Array<[string, string, Record<string, unknown>]> = [
      ["created", "subagent_created", { id: "a", type: "t", description: "d", details: { background: true } }],
      ["started", "subagent_started", { id: "a", type: "t", description: "d", details: { displayName: "n" } }],
      ["entry", "subagent_entry", { agentId: "a", index: 1, entry }],
      ["entry with blockId", "subagent_entry", { agentId: "a", index: 0, blockId: 2, entry }],
      ["delta", "subagent_delta", { agentId: "a", blockId: 3, offset: 0, kind: "text", text: "hello" }],
      ["completed", "subagent_completed", { id: "a", result: "r", details: { status: "completed" } }],
      ["failed", "subagent_failed", { id: "a", error: "e" }],
    ];
    it.each(arms)("%s", (_l, type, data) => {
      for (const base of [fresh(), apply(apply(fresh(), "subagent_started", { id: "a", type: "t", description: "d" }), "subagent_entry", { agentId: "a", index: 0, entry })]) {
        const once = apply(base, type, data);
        const twice = apply(once, type, data);
        expect(twice).toEqual(once);
      }
    });

    it("a later created never regresses a running or terminal row, nor replaces a read type/task", () => {
      let s = apply(fresh(), "subagent_started", { id: "a", details: { subagentType: "real", description: "task" } });
      s = apply(s, "subagent_created", { id: "a", type: "other", description: "other" });
      expect(get(s, "a")).toMatchObject({ status: "running", type: "real", description: "task" });
      s = apply(s, "subagent_completed", { id: "a", result: "r" });
      s = apply(s, "subagent_created", { id: "a", type: "t", description: "d" });
      s = apply(s, "subagent_started", { id: "a" });
      expect(get(s, "a")).toMatchObject({ status: "completed", result: "r" });
    });
  });

  describe("reconcile snapshot (#E29, #E30, #X5)", () => {
    const snapshot = (entries: Array<{ agentId: string; status: string }>, takenAt: number) =>
      ({ eventType: "subagent_registry_snapshot", timestamp: takenAt + 5, data: { scope: "registry", entries, takenAt, background: true } }) as DashboardEvent;
    const run = (s: S, e: DashboardEvent) => (finalizer.onSessionEvent!(s, e) ?? s) as S;

    it("ends only background rows missing from the snapshot (#E29)", () => {
      let s = apply(fresh(), "subagent_started", { id: "A", details: { background: true } }, 100);
      s = apply(s, "subagent_started", { id: "B" }, 100);
      const next = run(s, snapshot([], 1000));
      expect(get(next, "A")).toMatchObject({ status: "failed", healedBy: "untracked" });
      expect(get(next, "B")).toBe(get(s, "B"));
    });

    it("ends a running row listed idle with revivable marker `idle`; a live started revives it (#E30)", () => {
      let s = apply(fresh(), "subagent_started", { id: "A", details: { background: true } }, 100);
      s = run(s, snapshot([{ agentId: "A", status: "idle" }], 1000));
      expect(get(s, "A")).toMatchObject({ status: "completed", healedBy: "idle" });
      s = apply(s, "subagent_started", { id: "A" }, 2000);
      expect(get(s, "A")?.status).toBe("running");
      expect(get(s, "A")?.healedBy).toBeUndefined();
    });

    it("keeps a row with a live frame after takenAt when the list is partial (#X5)", () => {
      let s = apply(fresh(), "subagent_started", { id: "A", details: { background: true } }, 100);
      s = apply(s, "subagent_started", { id: "B", details: { background: true } }, 1500);
      const next = run(s, snapshot([{ agentId: "A", status: "running" }], 1000));
      expect(get(next, "A")?.status).toBe("running");
      expect(get(next, "B")?.status).toBe("running");
    });
  });

  describe("started arm identity (#9.4)", () => {
    it("reads details.subagentType / description / displayName", () => {
      const s = apply(fresh(), "subagent_started", {
        id: "a1",
        details: { subagentType: "batch-applier-b", description: "Apply nav-waits-in-rules", displayName: "batch-applier-b" },
      });
      expect(get(s, "a1")).toMatchObject({ type: "batch-applier-b", description: "Apply nav-waits-in-rules", displayName: "batch-applier-b" });
    });

    it("prefers details over top-level fields", () => {
      const s = apply(fresh(), "subagent_started", { id: "a1", type: "top", description: "topd", details: { subagentType: "det", description: "detd" } });
      expect(get(s, "a1")).toMatchObject({ type: "det", description: "detd" });
    });

    it("falls back to displayName, then the short id, never `unknown`", () => {
      expect(get(apply(fresh(), "subagent_started", { id: "a1", details: { displayName: "nm" } }), "a1")?.type).toBe("nm");
      const bare = get(apply(fresh(), "subagent_started", { id: "abcdef123456" }), "abcdef123456");
      expect(bare?.type).toBe("abcdef12");
      expect(bare?.type).not.toBe("unknown");
    });

    it("a real type replaces a placeholder written by an earlier entry frame", () => {
      let s = apply(fresh(), "subagent_entry", { agentId: "abcdef123456", index: 0, entry });
      expect(get(s, "abcdef123456")?.type).not.toBe("unknown");
      s = apply(s, "subagent_started", { id: "abcdef123456", details: { subagentType: "real" } });
      expect(get(s, "abcdef123456")?.type).toBe("real");
    });
  });

  it("a __truncated terminal frame with an id is terminal and flags the result-too-large note (#E33)", () => {
    let s = apply(fresh(), "subagent_started", { id: "a1", details: { background: true } });
    s = apply(s, "subagent_completed", { __truncated: true, id: "a1", details: { status: "completed" } });
    expect(get(s, "a1")).toMatchObject({ status: "completed", resultTruncated: true });
    const failed = apply(apply(fresh(), "subagent_started", { id: "a2" }), "subagent_failed", { __truncated: true, id: "a2", details: { status: "failed" } });
    expect(get(failed, "a2")).toMatchObject({ status: "failed", resultTruncated: true });
  });
});
