/**
 * Live subagent timeline from the entry/delta streams (L1).
 * Folded from test-plan.md E9–E13, X4. See change: add-plugin-bridge-contributions (D7).
 */
import {
  createSlotRegistry,
  registerSessionEventReducer,
  registerToolRowFinalizer,
  setSessionReducerEnabledSet,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { __resetSessionReducersForTests } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { PLUGIN_REGISTRY } from "../../generated/plugin-registry.js";
import { registerSubagentsReducerSlice } from "../../test-support/subagents-reducer-slice.js";
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";
import { setEventTypeOwners } from "../plugins/event-type-owners.js";

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

// Plugins register session event reducer slices (test-plan #E41, D5 item 6): the
// registry is built from the generated registry's ENTRY EXPORTS only — no plugin
// code calls a registration function — and filtered by the same enabled set as claims.
describe("plugin-registered session event reducer slice (E41)", () => {
  afterEach(() => {
    __resetSessionReducersForTests();
    setEventTypeOwners([]);
    // Restore the vitest-setup registration for later files in this worker.
    registerSubagentsReducerSlice();
  });

  /** Mirror of what `App.tsx` does with the generated registry. */
  function registerFromEntryExports(enabled: ReadonlySet<string> | null) {
    __resetSessionReducersForTests();
    const registry = createSlotRegistry();
    for (const entry of PLUGIN_REGISTRY) {
      registry.registerPlugin({ id: entry.manifest.id, displayName: entry.manifest.displayName, eventTypes: entry.manifest.eventTypes });
      if (entry.sessionEventReducer) registerSessionEventReducer(entry.manifest.id, entry.sessionEventReducer);
      for (const f of entry.toolRowFinalizers ?? []) registerToolRowFinalizer(entry.manifest.id, f);
    }
    setEventTypeOwners(registry.getEventTypeOwners());
    setSessionReducerEnabledSet(enabled);
  }

  it("the generated registry carries the subagents slice from the client entry's exports", () => {
    const entry = PLUGIN_REGISTRY.find((e) => e.manifest.id === "subagents");
    expect(entry?.sessionEventReducer?.eventTypes).toEqual([
      "subagent_created",
      "subagent_started",
      "subagent_entry",
      "subagent_delta",
    ]);
  });

  it("subagents enabled: subagent_started updates `subagents`, adds no raw/group row", () => {
    registerFromEntryExports(new Set(["subagents"]));
    const s = apply([started()]);
    expect(s.subagents.get("a")?.status).toBe("running");
    expect(s.messages).toHaveLength(0);
  });

  it("subagents disabled: the map ref is unchanged and the event folds into the owned group row", () => {
    registerFromEntryExports(new Set());
    const before = createInitialState();
    const s = reduceEvent(before, started());
    expect(s.subagents).toBe(before.subagents);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({ role: "rawEvent", toolName: "subagent_started", ownedGroup: { ownerId: "subagents", count: 1 } });
  });

  it("an enable-set change applies to LATER events; already-reduced state is not replayed", () => {
    registerFromEntryExports(new Set(["subagents"]));
    let s = apply([started()]);
    setSessionReducerEnabledSet(new Set());
    s = apply([entry(0)], s);
    expect(s.subagents.get("a")?.entries).toBeUndefined();
    expect(s.messages.filter((m) => (m as { ownedGroup?: unknown }).ownedGroup)).toHaveLength(1);
    setSessionReducerEnabledSet(new Set(["subagents"]));
    s = apply([entry(0)], s);
    expect(s.subagents.get("a")?.entries).toHaveLength(1);
  });
});
