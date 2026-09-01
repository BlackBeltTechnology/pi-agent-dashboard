/**
 * Chronological history of persisted display custom messages (generic — no
 * product vocabulary). Complements the display-exclusion contract in
 * `event-reducer.custom-entries.test.ts` with the ORDERING guarantee the
 * cold-load path depends on: a replay whose first seq overlaps what the client
 * already saw RESETS and REBUILDS from empty, in seq order, so a stale tail can
 * never leave the rows out of order and re-replay never duplicates them.
 * See change: merge-dashboard-develop.
 */
import { describe, expect, it } from "vitest";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { createInitialState, reduceEvent } from "../event-reducer.js";

function customEnd(content: string, entryId: string, ts: number): DashboardEvent {
  return {
    eventType: "message_end",
    timestamp: ts,
    data: { message: { role: "custom", customType: "x-note", content, display: true }, entryId },
  };
}

function rebuild(events: DashboardEvent[]) {
  let s = createInitialState();
  for (const e of events) s = reduceEvent(s, e);
  return s;
}

const A = customEnd("A", "e1", 1000);
const B = customEnd("B", "e2", 2000);
const C = customEnd("C", "e3", 3000);

describe("custom display-message chronological history", () => {
  it("replays several display messages as one row each, in emission order", () => {
    const s = rebuild([A, B, C]);
    expect(s.messages.map((m) => m.role)).toEqual(["custom", "custom", "custom"]);
    expect(s.messages.map((m) => m.content)).toEqual(["A", "B", "C"]);
    expect(s.messages.map((m) => m.customType)).toEqual(["x-note", "x-note", "x-note"]);
  });

  it("a reset-rebuild replay after a live tail message yields A,B,C — never C,A,B", () => {
    // Live: only the newest message has arrived.
    let s = rebuild([C]);
    expect(s.messages.map((m) => m.content)).toEqual(["C"]);

    // A full replay whose firstSeq <= maxSeq makes useMessageHandler reset and
    // rebuild from createInitialState in seq order. The stale tail cannot
    // survive into the rebuilt state, so the tail-append ordering C,A,B is
    // unreachable.
    s = rebuild([A, B, C]);
    expect(s.messages.map((m) => m.content)).toEqual(["A", "B", "C"]);
    expect(s.messages).toHaveLength(3);
  });

  it("a hidden (display:false) message contributes no row to the rebuild", () => {
    const hidden: DashboardEvent = {
      eventType: "message_end",
      timestamp: 1500,
      data: { message: { role: "custom", customType: "x-note", content: "secret", display: false }, entryId: "e9" },
    };
    const s = rebuild([A, hidden, B]);
    expect(s.messages.map((m) => m.content)).toEqual(["A", "B"]);
  });

  it("message_start for a custom message adds no row (the row is built at message_end)", () => {
    const start: DashboardEvent = {
      eventType: "message_start",
      timestamp: 1000,
      data: { message: { role: "custom", customType: "x-note", content: "A", display: true }, entryId: "e1" },
    };
    expect(rebuild([start]).messages).toHaveLength(0);
    expect(rebuild([start, A]).messages).toHaveLength(1);
  });
});
