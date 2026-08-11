/**
 * THE ACCEPTANCE GATE for collapse-superseded-tool-execution-updates
 * (test-plan F1, F2, E10).
 *
 * The collapse lives in `packages/server`, but its correctness is defined
 * entirely by the CLIENT reducer: dropping a `tool_execution_update` is legal
 * only when the folded `SessionState` converges. This test therefore crosses
 * the server/client boundary — the same deliberate crossing
 * `replay-compaction-equivalence.test.ts` makes for the replay compaction.
 *
 * The collapse SELECTION is mirrored locally (`selectRetained`) so F2 can
 * mutate it — you cannot delete the store's gate from a test. The mirror is
 * pinned to the real implementation by `cross-check`, which asserts the local
 * selection equals what `createMemoryEventStore` actually retains.
 *
 * If this file ever fails, the collapse policy is wrong — not the test.
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import {
  createInitialState,
  reduceEvent,
  type SessionState,
} from "../../../client/src/lib/chat/event-reducer.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";

const AGENT_ID = "agent-1";
const SESSION_ID = "as-v7";
const TOOL_CALL_ID = "tc1";

interface UpdateSpec {
  id: string;
  details?: Record<string, unknown>;
  /** `partialResult.content`; omit the key entirely to set no rendered result. */
  content?: unknown;
  /** Plain-string `partialResult` (the non-structured reducer branch). */
  plain?: string;
}

function mkDetails(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agentId: AGENT_ID,
    agentSessionId: SESSION_ID,
    subagentType: "Other",
    description: "d-late",
    activity: "working",
    entries: [{ kind: "text", text: "step", ts: 1 }],
    ...over,
  };
}

function mkUpdate(spec: UpdateSpec): DashboardEvent {
  const data: Record<string, unknown> = {
    toolCallId: TOOL_CALL_ID,
    toolName: "Agent",
    __fixtureId: spec.id,
  };
  if (spec.plain !== undefined) {
    data.partialResult = spec.plain;
  } else {
    const pr: Record<string, unknown> = {};
    if (spec.details) pr.details = spec.details;
    if ("content" in spec) pr.content = spec.content;
    data.partialResult = pr;
  }
  return { eventType: "tool_execution_update", timestamp: 1000, data };
}

/**
 * The F1 fixture. Update-only (NO terminal `tool_execution_end` carrying
 * `result`/`details` — one would overwrite both from the end event alone and
 * satisfy the equivalence vacuously), and deliberately NON-uniform:
 *
 *  - u1 is the creating tick and carries `subagentType`/`description` values
 *    that DIFFER from every later tick (first-wins probe for the pin);
 *  - u1 omits `agentSessionId` — the v7 id arrives on a later tick;
 *  - u3 omits `agentSessionId` (key-presence probe);
 *  - u4 carries an EMPTY `entries` (empty-array-overwrite probe);
 *  - u5 sets no rendered result (result-source probe);
 *  - u8 is a plain string followed by a structured u9 (mixed-shape pair);
 *  - u10, the newest, OMITS `agentSessionId` — so a gate-less collapse loses
 *    the dual-index key the full fold keeps.
 */
function f1Updates(): DashboardEvent[] {
  const creating = mkDetails({ subagentType: "Explore", description: "d-first" });
  delete creating.agentSessionId;
  const withoutSession = mkDetails();
  delete withoutSession.agentSessionId;
  const newest = mkDetails({ activity: "finishing" });
  delete newest.agentSessionId;

  return [
    mkUpdate({ id: "u1", details: creating, content: [{ text: "r1" }] }),
    mkUpdate({ id: "u2", details: mkDetails(), content: [{ text: "r2" }] }),
    mkUpdate({ id: "u3", details: withoutSession, content: [{ text: "r3" }] }),
    mkUpdate({ id: "u4", details: mkDetails({ entries: [] }), content: [{ text: "r4" }] }),
    mkUpdate({ id: "u5", details: mkDetails() }), // no `content` key at all
    mkUpdate({ id: "u6", details: mkDetails(), content: [{ text: "r6" }] }),
    mkUpdate({ id: "u7", details: mkDetails(), content: [{ text: "r7" }] }),
    mkUpdate({ id: "u8", plain: "tail text" }),
    mkUpdate({ id: "u9", details: mkDetails(), content: [{ text: "r9" }] }),
    mkUpdate({ id: "u10", details: newest, content: [{ text: "r10" }] }),
  ];
}

/** Preamble that gives the reducer a message row carrying `toolCallId`. */
function preamble(): DashboardEvent[] {
  return [
    {
      eventType: "message_start",
      timestamp: 900,
      data: { message: { role: "assistant", content: [] } },
    },
    {
      eventType: "tool_execution_start",
      timestamp: 950,
      data: { toolCallId: TOOL_CALL_ID, toolName: "Agent", args: { prompt: "go" } },
    },
  ];
}

// ---- Local mirror of the store's collapse SELECTION (mutable for F2) ----

interface CollapseMutations {
  /** false → drop the predecessor unconditionally (subsumption gate removed). */
  gate?: boolean;
  /** false → the creating tick is not pinned. */
  pin?: boolean;
}

function detailsOf(e: DashboardEvent): Record<string, unknown> | undefined {
  const pr = (e.data as Record<string, unknown>).partialResult as
    | Record<string, unknown>
    | undefined;
  if (!pr || typeof pr !== "object") return undefined;
  const d = pr.details;
  return d && typeof d === "object" ? (d as Record<string, unknown>) : undefined;
}

function setsResult(e: DashboardEvent): boolean {
  const pr = (e.data as Record<string, unknown>).partialResult;
  if (pr == null) return false;
  if (typeof pr !== "object") return true;
  return (pr as Record<string, unknown>).content != null;
}

function valueType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function subsumes(p: DashboardEvent, s: DashboardEvent): boolean {
  const dp = detailsOf(p);
  const ds = detailsOf(s);
  if (!dp && !ds) return true;
  const pd = dp ?? {};
  const sd = ds ?? {};
  for (const k of Object.keys(pd)) {
    if (!(k in sd)) return false;
    if (valueType(pd[k]) !== valueType(sd[k])) return false;
  }
  if (Array.isArray(pd.entries) && pd.entries.length > 0) {
    if (!Array.isArray(sd.entries) || sd.entries.length === 0) return false;
  }
  if (setsResult(p) && !setsResult(s)) return false;
  return true;
}

/** Retained subsequence under the collapse policy, with optional mutations. */
function selectRetained(
  updates: DashboardEvent[],
  mut: CollapseMutations = {},
): DashboardEvent[] {
  const gate = mut.gate !== false;
  const pin = mut.pin !== false;
  const retained: DashboardEvent[] = [];
  let creating: DashboardEvent | undefined;
  let newest: DashboardEvent | undefined;
  for (const u of updates) {
    if (newest && !(pin && newest === creating)) {
      if (!gate || subsumes(newest, u)) {
        const i = retained.indexOf(newest);
        if (i !== -1) retained.splice(i, 1);
      }
    }
    retained.push(u);
    newest = u;
    if (pin && !creating && typeof detailsOf(u)?.agentId === "string") creating = u;
  }
  return retained;
}

function fold(events: DashboardEvent[]): SessionState {
  return events.reduce((s, e) => reduceEvent(s, e), createInitialState());
}

function fixtureIds(events: DashboardEvent[]): string[] {
  return events.map((e) => (e.data as Record<string, unknown>).__fixtureId as string);
}

describe("collapse ↔ client-reducer replay equivalence", () => {
  it("cross-check: the local mirror matches what the real store retains", () => {
    const updates = f1Updates();
    const store = createMemoryEventStore(() => false);
    for (const e of [...preamble(), ...updates]) store.insertEvent("s", e);
    const storeRetained = store
      .getEvents("s", 1)
      .filter((e) => e.event.eventType === "tool_execution_update")
      .map((e) => (e.event.data as Record<string, unknown>).__fixtureId as string);

    expect(storeRetained).toEqual(fixtureIds(selectRetained(updates)));
    // Anti-vacuity of the cross-check itself: collapse must have DONE something.
    expect(storeRetained.length).toBeLessThan(updates.length);
    expect(store.getTrimStats().collapsedUpdates).toBeGreaterThan(0);
  });

  /** F1 as an assertion function so F2 can invoke it under mutation. */
  function assertEquivalent(mut: CollapseMutations = {}): void {
    const updates = f1Updates();
    const full = fold([...preamble(), ...updates]);
    const collapsed = fold([...preamble(), ...selectRetained(updates, mut)]);

    const fullMsg = full.messages.find((m) => m.toolCallId === TOOL_CALL_ID);
    const collapsedMsg = collapsed.messages.find((m) => m.toolCallId === TOOL_CALL_ID);
    expect(collapsedMsg?.result).toEqual(fullMsg?.result);
    expect(collapsedMsg?.toolDetails).toEqual(fullMsg?.toolDetails);

    const fullSub = full.subagents.get(AGENT_ID);
    const collapsedSub = collapsed.subagents.get(AGENT_ID);
    expect(collapsedSub).toEqual(fullSub);
    // `type`/`description` are FIRST-wins — assert them BY VALUE, not merely
    // present, or the pin's whole purpose goes unverified.
    expect(collapsedSub?.type).toBe(fullSub?.type);
    expect(collapsedSub?.description).toBe(fullSub?.description);
    // Dual-index: reachable under the v4 agentId AND the v7 agentSessionId.
    expect(full.subagents.get(SESSION_ID)).toBeDefined();
    expect(collapsed.subagents.get(SESSION_ID)).toBeDefined();
    expect(collapsed.subagents.get(SESSION_ID)).toEqual(full.subagents.get(SESSION_ID));
  }

  it("F1: the collapsed subsequence folds to the same state as the full one", () => {
    assertEquivalent();
    // The fixture must actually exercise first-wins, or F2's pin mutation is
    // the only thing proving it.
    const full = fold([...preamble(), ...f1Updates()]);
    expect(full.subagents.get(AGENT_ID)?.type).toBe("Explore");
    expect(full.subagents.get(AGENT_ID)?.description).toBe("d-first");
  });

  it("F2: F1 FAILS when the subsumption gate is removed", () => {
    expect(() => assertEquivalent({ gate: false })).toThrow();
    // …and FAILS for the RIGHT reason: the gate-less collapse keeps only the
    // pinned tick + the newest, neither of which carries `agentSessionId`, so
    // the dual-index key the full fold holds is lost.
    const updates = f1Updates();
    const full = fold([...preamble(), ...updates]);
    const mutated = fold([...preamble(), ...selectRetained(updates, { gate: false })]);
    expect(full.subagents.get(SESSION_ID)).toBeDefined();
    expect(mutated.subagents.get(SESSION_ID)).toBeUndefined();
  });

  it("F2: F1 FAILS when creating-tick pinning is removed", () => {
    expect(() => assertEquivalent({ pin: false })).toThrow();
    // …and FAILS for the RIGHT reason: without the pin the first-wins
    // `type`/`description` are supplied by a LATER tick with other values.
    const updates = f1Updates();
    const full = fold([...preamble(), ...updates]);
    const mutated = fold([...preamble(), ...selectRetained(updates, { pin: false })]);
    expect(full.subagents.get(AGENT_ID)?.type).toBe("Explore");
    expect(mutated.subagents.get(AGENT_ID)?.type).toBe("Other");
    expect(mutated.subagents.get(AGENT_ID)?.description).toBe("d-late");
  });

  it("E10: the creating tick's type/description survive many subsuming updates", () => {
    const creating = mkDetails({ subagentType: "Explore", description: "d-first" });
    const updates: DashboardEvent[] = [
      mkUpdate({ id: "c", details: creating, content: [{ text: "r" }] }),
    ];
    for (let i = 0; i < 25; i++) {
      updates.push(
        mkUpdate({ id: `s${i}`, details: mkDetails({ subagentType: "Other" }), content: [{ text: "r" }] }),
      );
    }
    const retained = selectRetained(updates);
    // Creating tick present…
    expect(fixtureIds(retained)).toContain("c");
    // …and the folded entry keeps its values, BY VALUE.
    const sub = fold([...preamble(), ...retained]).subagents.get(AGENT_ID);
    expect(sub?.type).toBe("Explore");
    expect(sub?.description).toBe("d-first");
  });
});
