/**
 * D5 (client half) — a subagent frame WITHOUT `details.entries` must be a no-op
 * for the rendered timeline, not an eraser. The reducer's empty-array overwrite
 * guard already gives this by construction; these rows pin it, because the
 * whole change rests on "thin ticks change nothing downstream".
 *
 * Also pins X4 (a dropped thin tick leaves NO permanent hole) at the reducer
 * level: state converges from the next full snapshot.
 *
 * See change: reduce-subagent-details-payload.
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";

function applyEvents(events: DashboardEvent[]): SessionState {
  return events.reduce((s, e) => reduceEvent(s, e), createInitialState());
}

const entries = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ kind: "text", text: `step ${from + i}`, ts: 1000 + from + i }));

const started = (details: Record<string, unknown>): DashboardEvent => ({
  eventType: "subagent_started",
  timestamp: 2000,
  data: { id: "sub-1", details: { agentId: "sub-1", status: "running", ...details } },
});

describe("thin subagent frames in the reducer", () => {
  // 6.2 — a thin tick never erases an already-rendered timeline.
  it("6.2: a frame without entries preserves the timeline and still updates scalars", () => {
    const state = applyEvents([
      started({ entries: entries(3), activity: "reading a.ts", toolUses: 3 }),
      started({ activity: "reading b.ts", toolUses: 4 }), // thin tick
    ]);
    const sub = state.subagents.get("sub-1")!;
    expect(sub.entries).toHaveLength(3);
    expect(sub.activity).toBe("reading b.ts");
    expect(sub.toolUses).toBe(4);
  });

  it("6.2: an explicitly EMPTY entries array is equally inert", () => {
    const state = applyEvents([started({ entries: entries(2) }), started({ entries: [] })]);
    expect(state.subagents.get("sub-1")!.entries).toHaveLength(2);
  });

  it("6.2: a thin tick before any timeline leaves the subagent renderable", () => {
    const state = applyEvents([started({ activity: "starting" })]);
    const sub = state.subagents.get("sub-1")!;
    expect(sub.status).toBe("running");
    expect(sub.entries ?? []).toHaveLength(0);
  });

  // X4 — back-pressure drops a thin tick: the next FULL snapshot restores
  // everything, so a drop is never a permanent hole.
  it("X4: a dropped thin tick leaves no hole — the next snapshot converges", () => {
    const withDrop = applyEvents([
      started({ entries: entries(2), activity: "a" }),
      // (thin tick with activity "b" dropped by the gateway)
      started({ entries: entries(5), activity: "c" }),
    ]);
    const noDrop = applyEvents([
      started({ entries: entries(2), activity: "a" }),
      started({ activity: "b" }),
      started({ entries: entries(5), activity: "c" }),
    ]);
    const a = withDrop.subagents.get("sub-1")!;
    const b = noDrop.subagents.get("sub-1")!;
    expect(a.entries).toEqual(b.entries);
    expect(a.activity).toBe(b.activity);
  });

  // F6 — the documented degradation for an old client (open-time resync only):
  // opening an inspector on a NON-empty timeline never re-fires, so it freezes
  // at the open-time snapshot. Asserted as degradation, NOT as convergence.
  it("F6: without a cadence, a non-empty timeline freezes at the open-time snapshot", () => {
    // The old client received the open-time snapshot (5 entries) and then only
    // thin ticks: the rendered timeline stays at 5 while the run continues.
    const state = applyEvents([
      started({ entries: entries(5), activity: "a" }),
      started({ activity: "b" }),
      started({ activity: "c" }),
    ]);
    const sub = state.subagents.get("sub-1")!;
    expect(sub.entries).toHaveLength(5); // frozen — the documented degradation
    expect(sub.activity).toBe("c"); // scalars still live
  });
});

// See change: stream-subagent-reasoning-and-stable-card (#E6, #X3).
describe("liveTail normalization in the reducer", () => {
  const CLEARED = { kind: "none", text: "" };
  const tailOf = (s: SessionState) => s.subagents.get("sub-1")!.liveTail;

  it.each([
    ["valid thinking", { kind: "thinking", text: "abc" }, { kind: "thinking", text: "abc" }],
    ["valid text", { kind: "text", text: "hi" }, { kind: "text", text: "hi" }],
    ["sentinel", { kind: "none", text: "" }, CLEARED],
    ["invalid kind", { kind: "weird", text: "x" }, CLEARED],
    ["non-string text", { kind: "thinking", text: 42 }, CLEARED],
    ["400-char text", { kind: "text", text: "z".repeat(400) }, { kind: "text", text: "z".repeat(280) }],
  ])("E6: %s → normalized tail", (_label, tail, expected) => {
    let state!: SessionState;
    expect(() => {
      state = applyEvents([started({ liveTail: tail })]);
    }).not.toThrow();
    expect(tailOf(state)).toEqual(expected);
  });

  it("E6: an object tail overwrites a previous one (sentinel clears)", () => {
    const state = applyEvents([
      started({ liveTail: { kind: "thinking", text: "abc" } }),
      started({ liveTail: { kind: "none", text: "" } }),
    ]);
    expect(tailOf(state)).toEqual(CLEARED);
  });

  it.each([
    ["string", "abc"],
    ["null", null],
    ["array", [1, 2]],
    ["number", 5],
  ])("X3: non-object liveTail (%s) is ignored, previous state kept", (_label, bad) => {
    let state!: SessionState;
    expect(() => {
      state = applyEvents([
        started({ liveTail: { kind: "thinking", text: "keep" } }),
        started({ liveTail: bad }),
      ]);
    }).not.toThrow();
    expect(tailOf(state)).toEqual({ kind: "thinking", text: "keep" });
  });
});

// See change: stream-subagent-reasoning-and-stable-card (task 5.3).
describe("thinkingLevel in the reducer", () => {
  it("keeps a string level and ignores a non-string one", () => {
    const s = applyEvents([started({ thinkingLevel: "high" }), started({ thinkingLevel: 3 })]);
    expect(s.subagents.get("sub-1")!.thinkingLevel).toBe("high");
  });
});
