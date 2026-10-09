/**
 * Live subagent timeline from the entry/delta streams (L1).
 * Folded from test-plan.md E9–E13, X4. See change: add-plugin-bridge-contributions (D7).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";

const ev = (eventType: string, data: Record<string, unknown>): DashboardEvent => ({
  eventType,
  timestamp: 1000,
  data,
});
const apply = (events: DashboardEvent[], from: SessionState = createInitialState()) =>
  events.reduce((s, e) => reduceEvent(s, e), from);

const step = (i: number) => ({ kind: "tool", toolName: "Read", input: { i }, output: `o${i}`, ts: i });
const entry = (index: number, blockId?: number, agentId = "a") =>
  ev("subagent_entry", { v: 1, agentId, toolCallId: "tc", index, entry: step(index), ...(blockId !== undefined ? { blockId } : {}) });
const delta = (blockId: number, offset: number, text: string, agentId = "a") =>
  ev("subagent_delta", { v: 1, agentId, toolCallId: "tc", blockId, kind: "thinking", offset, text, final: false });
const started = (details: Record<string, unknown> = {}) =>
  ev("subagent_started", { id: "a", type: "Explore", description: "d", details: { agentId: "a", ...details } });

describe("subagent entry stream", () => {
  it("places steps by index, ignores duplicates, emits no raw rows (E9)", () => {
    const s = apply([started(), entry(0), entry(2), entry(1), entry(1)]);
    const entries = s.subagents.get("a")!.entries!;
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => (e as { input: { i: number } }).input.i)).toEqual([0, 1, 2]);
    expect(s.messages.some((m) => JSON.stringify(m).includes("subagent_entry"))).toBe(false);
    expect(s.messages).toHaveLength(0);
  });

  it("a terminal frame never shrinks the streamed list; a longer legacy list replaces it (E10)", () => {
    const ten = Array.from({ length: 10 }, (_, i) => entry(i));
    let s = apply([started(), ...ten]);
    s = apply([ev("subagent_completed", { id: "a", result: "ok", details: { agentId: "a", entries: [], entryCount: 10 } })], s);
    expect(s.subagents.get("a")!.entries).toHaveLength(10);
    let t = apply([started(), ...ten]);
    t = apply([started({ entries: [step(0), step(1), step(2)] })], t);
    expect(t.subagents.get("a")!.entries).toHaveLength(10);
    const legacy = Array.from({ length: 12 }, (_, i) => step(i));
    t = apply([ev("subagent_completed", { id: "a", result: "ok", details: { agentId: "a", entries: legacy } })], t);
    expect(t.subagents.get("a")!.entries).toHaveLength(12);
  });
});

describe("subagent delta stream", () => {
  it("assembles contiguous pieces, ignores covered duplicates, marks gaps (E11)", () => {
    let s = apply([started(), delta(0, 0, "Let me "), delta(0, 7, "check"), delta(0, 3, "me")]);
    expect(s.subagents.get("a")!.liveBlock).toMatchObject({ blockId: 0, text: "Let me check", end: 12, gap: false });
    s = apply([delta(0, 10, "ck it")], s); // partial overlap → only the uncovered tail
    expect(s.subagents.get("a")!.liveBlock!.text).toBe("Let me check it");
    s = apply([delta(0, 30, "x")], s);
    const lb = s.subagents.get("a")!.liveBlock!;
    expect(lb.gap).toBe(true);
    expect(lb.text).toMatch(/^Let me check it .+x$/);
    expect(lb.end).toBe(31);
  });

  it("ignores a late piece of a closed block and pieces after terminal (E12)", () => {
    let s = apply([started(), delta(4, 0, "abc"), entry(0, 4), delta(4, 3, "def")]);
    expect(s.subagents.get("a")!.liveBlock).toBeUndefined();
    s = apply([ev("subagent_completed", { id: "a", result: "ok", details: { agentId: "a" } }), delta(5, 0, "late")], s);
    expect(s.subagents.get("a")!.liveBlock).toBeUndefined();
  });

  it("an entry before its final piece shows the entry and no block (E13)", () => {
    const s = apply([started(), delta(2, 0, "thinking…"), entry(0, 2), delta(2, 9, " more")]);
    const sub = s.subagents.get("a")!;
    expect(sub.entries).toHaveLength(1);
    expect(sub.liveBlock).toBeUndefined();
  });

  it("a new blockId replaces the previous block; an omitted piece leaves a gap", () => {
    let s = apply([started(), delta(0, 0, "one"), delta(1, 0, "two")]);
    expect(s.subagents.get("a")!.liveBlock).toMatchObject({ blockId: 1, text: "two" });
    s = apply([ev("subagent_delta", { agentId: "a", blockId: 1, kind: "thinking", offset: 3, text: "", omittedLength: 500, final: false }), delta(1, 503, "tail")], s);
    expect(s.subagents.get("a")!.liveBlock).toMatchObject({ gap: true, end: 507 });
  });
});

describe("legacy producer without step events (X4)", () => {
  it("keeps the tick timeline and liveTail path unchanged", () => {
    const s = apply([
      started({ entries: [step(0)], liveTail: { kind: "thinking", text: "tail" } }),
      ev("subagent_started", { id: "a", details: { agentId: "a", entries: [step(0), step(1)] } }),
    ]);
    const sub = s.subagents.get("a")!;
    expect(sub.entries).toHaveLength(2);
    expect(sub.liveTail).toEqual({ kind: "thinking", text: "tail" });
    expect(sub.liveBlock).toBeUndefined();
  });
});
