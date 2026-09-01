/**
 * D5 — the design's main claim: every downstream mechanism keeps working
 * UNCHANGED once intermediate subagent ticks arrive WITHOUT `details.entries`.
 * Each limb is checkable, so each limb gets a test. The only server-side change
 * this change makes is the D5a type gate; if any row here forces a second one,
 * stop and re-review.
 *
 * See change: reduce-subagent-details-payload.
 */
import { describe, expect, it } from "vitest";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";

const neverPinned = () => false;

/** A `tool_execution_update` whose details carry NO timeline (post-strip). */
function thinUpdate(toolCallId: string, activity: string): DashboardEvent {
  return {
    eventType: "tool_execution_update",
    timestamp: Date.now(),
    data: {
      toolCallId,
      toolName: "Agent",
      partialResult: {
        content: [{ type: "text", text: "running…" }],
        details: {
          agentId: "ag1",
          agentSessionId: "as1",
          subagentType: "Explore",
          description: "d1",
          status: "running",
          activity,
          toolUses: 1,
        },
      },
    },
  };
}

describe("thin subagent ticks downstream", () => {
  // 6.1 — collapse: `entriesSurvive` is vacuously true when `entries` is
  // absent, so a thin predecessor is cleanly subsumed and the counter moves.
  it("6.1: thin ticks subsume under the collapse predicate and count as collapsed", () => {
    const store = createMemoryEventStore(neverPinned);
    store.insertEvent("s1", thinUpdate("tc1", "step 1")); // creating tick (pinned)
    store.insertEvent("s1", thinUpdate("tc1", "step 2"));
    store.insertEvent("s1", thinUpdate("tc1", "step 3"));
    store.insertEvent("s1", thinUpdate("tc1", "step 4"));

    // Unchanged policy: the creating tick stays pinned, every other superseded
    // update collapses — thin ticks are not a special case.
    expect(store.getTrimStats().collapsedUpdates).toBe(2);
    const events = store.getEvents("s1", 1);
    expect(events).toHaveLength(2);
    const details = (events[1].event.data as any).partialResult.details;
    expect(details.activity).toBe("step 4");
    expect(details.entries).toBeUndefined();
  });

  it("6.1: a FAT tick is never subsumed by a thin successor", () => {
    const store = createMemoryEventStore(neverPinned);
    const fat = thinUpdate("tc1", "step 1");
    (fat.data as any).partialResult.details.entries = [{ kind: "text", text: "s", ts: 1 }];
    store.insertEvent("s1", fat);
    store.insertEvent("s1", thinUpdate("tc1", "step 2"));

    // The thin successor drops a non-empty `entries` key, so `entriesSurvive`
    // fails and BOTH events are retained — no timeline is ever shed by collapse.
    expect(store.getTrimStats().collapsedUpdates).toBe(0);
    expect(store.getEvents("s1", 1)).toHaveLength(2);
  });

  // 6.5 — a thin tick needs no new truncation behaviour: nothing to reduce.
  it("6.5: a thin tick is stored byte-identical (no reduction path engaged)", () => {
    const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, 20_000);
    const event = thinUpdate("tc1", "step 1");
    const before = JSON.stringify(event.data);
    store.insertEvent("s1", event);
    expect(JSON.stringify(store.getEvent("s1", 1)!.data)).toBe(before);
  });
});
