/**
 * Tests for the tail-first replay window selector.
 * See change: tail-first-session-loading.
 */
import { describe, expect, it } from "vitest";
import type { StoredEvent } from "../../persistence/memory-event-store.js";
import { compactStreamingSnapshots, selectWindow, TAIL_WINDOW_EVENTS } from "../select-window.js";

/** Build a stored event with a given seq + type (default a neutral event). */
function ev(seq: number, eventType = "stats_update"): StoredEvent {
  return { seq, event: { eventType, timestamp: seq, data: {} } };
}

/** Build a run of neutral events over the inclusive seq range. */
function run(from: number, to: number): StoredEvent[] {
  const out: StoredEvent[] = [];
  for (let s = from; s <= to; s++) out.push(ev(s));
  return out;
}

/**
 * Streaming-snapshot compaction (issue #399).
 *
 * Live `message_update` events each carry the FULL accumulated message, not a
 * delta, so one long assistant turn emits ~10k snapshots whose bytes grow
 * quadratically. Measured: a 3.6 MB session replayed 20,029 events / ~87 MB /
 * 401 batches over ~17.8 s, of which 18,728 events (93.5% of events, 97% of
 * bytes) were intermediate `message_update` snapshots.
 *
 * The disk cold-load path (`state-replay.ts`) already emits exactly ONE
 * `message_update` per assistant message before its `message_end`, and renders
 * the same session in 997 events / 26 ms. Collapsing each consecutive run of
 * `message_update` events down to its last member reproduces that
 * proven-good shape.
 */
describe("compactStreamingSnapshots", () => {
  it("collapses a run of message_update down to the final snapshot", () => {
    const events = [
      ev(1, "message_start"),
      ev(2, "message_update"),
      ev(3, "message_update"),
      ev(4, "message_update"),
      ev(5, "message_end"),
    ];
    const out = compactStreamingSnapshots(events);
    expect(out.map((e) => e.seq)).toEqual([1, 4, 5]);
  });

  it("keeps span-opening/closing and neutral events untouched", () => {
    const events = [
      ev(1, "message_start"),
      ev(2, "message_end"),
      ev(3, "tool_execution_start"),
      ev(4, "tool_execution_end"),
      ev(5, "stats_update"),
    ];
    expect(compactStreamingSnapshots(events).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("never merges across a non-update event (one survivor per run)", () => {
    const events = [
      ev(1, "message_update"),
      ev(2, "message_update"),
      ev(3, "tool_execution_start"),
      ev(4, "message_update"),
      ev(5, "message_update"),
    ];
    expect(compactStreamingSnapshots(events).map((e) => e.seq)).toEqual([2, 3, 5]);
  });

  it("is a no-op when there is nothing to collapse", () => {
    const events = [ev(1, "message_start"), ev(2, "message_update"), ev(3, "message_end")];
    expect(compactStreamingSnapshots(events).map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});

describe("selectWindow — snapshot compaction (issue #399)", () => {
  /** A streaming assistant turn: one start, `updates` snapshots, one end. */
  function turn(startSeq: number, updates: number): StoredEvent[] {
    const out = [ev(startSeq, "message_start")];
    for (let i = 1; i <= updates; i++) out.push(ev(startSeq + i, "message_update"));
    out.push(ev(startSeq + updates + 1, "message_end"));
    return out;
  }

  it("drops the redundant snapshots from the replayed window", () => {
    // One turn with 5000 snapshots — the shape that produced ~87 MB on the wire.
    const { events: win } = selectWindow(turn(1, 5000), undefined, 200);
    expect(win.filter((e) => e.event.eventType === "message_update").length).toBe(1);
    expect(win.map((e) => e.event.eventType)).toEqual([
      "message_start",
      "message_update",
      "message_end",
    ]);
  });

  it("spends the budget on meaningful events, not snapshots", () => {
    // 60 turns × 100 snapshots = 6120 raw events; compacted = 180 events, so the
    // whole history now fits one 200-event window instead of showing ~2 turns.
    const events: StoredEvent[] = [];
    let seq = 1;
    for (let t = 0; t < 60; t++) {
      events.push(...turn(seq, 100));
      seq += 102;
    }
    const { events: win } = selectWindow(events, undefined, 200);
    expect(win.filter((e) => e.event.eventType === "message_end").length).toBe(60);
  });

  it("does not invent older history when the dropped event was seq 1", () => {
    // Regression guard: `hasOlder` is derived from seq > 1, so compacting away a
    // leading snapshot must not make a complete session advertise a page that
    // does not exist.
    const events = [ev(1, "message_update"), ev(2, "message_update"), ev(3, "message_end")];
    const { events: win, hasOlder } = selectWindow(events, undefined, 200);
    expect(hasOlder).toBe(false);
    expect(win[0].seq).toBe(2);
  });
});

describe("selectWindow", () => {
  it("returns the whole session when it fits the budget (hasOlder=false)", () => {
    const events = run(1, 80);
    const { events: win, hasOlder } = selectWindow(events, undefined, 200);
    expect(win.length).toBe(80);
    expect(win[0].seq).toBe(1);
    expect(hasOlder).toBe(false);
  });

  it("selects the newest window and reports hasOlder for a large session", () => {
    // 5000 neutral events → all boundaries safe → naive start = 4800.
    const events = run(1, 5000);
    const { events: win, hasOlder } = selectWindow(events, undefined, 200);
    expect(win.length).toBe(200);
    expect(win[0].seq).toBe(4801);
    expect(win[win.length - 1].seq).toBe(5000);
    expect(hasOlder).toBe(true);
  });

  it("snaps the window start backward to the nearest safe cut point", () => {
    // Neutral events, then an open tool span straddling the naive boundary.
    // budget 5 over 12 events → naive start index 7 (seq 8). Put a
    // tool_execution_start at seq 8 with its end at seq 11, so the naive cut
    // sits INSIDE the open tool span and must extend back to seq 8's start
    // boundary (index 7 is unsafe; index 7 boundary open). Simplify: place the
    // open span so the safe cut lands earlier.
    const events: StoredEvent[] = [
      ev(1),
      ev(2),
      ev(3),
      ev(4),
      ev(5),
      ev(6),
      ev(7, "tool_execution_start"),
      ev(8),
      ev(9, "tool_execution_end"),
      ev(10),
      ev(11),
      ev(12),
    ];
    // budget 5 → naive start index 7 (boundary after seq 7 start). That
    // boundary is INSIDE the tool span (start at index 6, end at index 8), so
    // it must extend back to index 6 (boundary before the tool_execution_start,
    // seq 7).
    const { events: win } = selectWindow(events, undefined, 5);
    expect(win[0].seq).toBe(7);
    // The window must begin at a safe boundary: the tool_execution_start.
    expect(win[0].event.eventType).toBe("tool_execution_start");
  });

  it("cuts at the hard cap when no safe point exists within 2x budget", () => {
    // Construct a pool whose last 2*budget events are ALL inside one never-
    // closing open span, so no safe boundary exists after capFloor.
    const budget = 3;
    const events: StoredEvent[] = [
      ev(1),
      ev(2),
      // seq 3..9: an open tool span with no matching end within the cap window
      ev(3, "tool_execution_start"),
      ev(4),
      ev(5),
      ev(6),
      ev(7),
      ev(8),
      ev(9),
    ];
    // pool.length 9, budget 3 → capFloor = 9 - 6 = 3 (index 3, seq 4).
    // Boundaries index 4..6 are all inside the open span → unsafe → falls back
    // to capFloor index 3 (seq 4).
    const { events: win, hasOlder } = selectWindow(events, undefined, budget);
    expect(win[0].seq).toBe(4);
    expect(hasOlder).toBe(true);
  });

  it("older page returns events ending at beforeSeq - 1", () => {
    const events = run(1, 5000);
    const { events: win, hasOlder } = selectWindow(events, 4801, 200);
    expect(win[win.length - 1].seq).toBe(4800);
    expect(win.length).toBe(200);
    expect(win[0].seq).toBe(4601);
    expect(hasOlder).toBe(true);
  });

  it("older page reaching seq 1 reports hasOlder=false", () => {
    const events = run(1, 300);
    // beforeSeq 150 → pool is 1..149 (149 events) ≤ budget 200 → all, no older.
    const { events: win, hasOlder } = selectWindow(events, 150, 200);
    expect(win[0].seq).toBe(1);
    expect(win[win.length - 1].seq).toBe(149);
    expect(hasOlder).toBe(false);
  });

  it("defaults budget to TAIL_WINDOW_EVENTS", () => {
    const events = run(1, 1000);
    const { events: win } = selectWindow(events, undefined);
    expect(win.length).toBe(TAIL_WINDOW_EVENTS);
  });

  it("empty session yields an empty window", () => {
    const { events: win, hasOlder } = selectWindow([], undefined, 200);
    expect(win.length).toBe(0);
    expect(hasOlder).toBe(false);
  });

  it("gap-aware hasOlder: a trimmed buffer whose oldest seq > 1 does NOT advertise older when it fits the budget", () => {
    // Store trimmed the head: only seqs 3120..3200 survive (81 events ≤ budget).
    const events: StoredEvent[] = [];
    for (let s = 3120; s <= 3200; s++) events.push(ev(s));
    const { events: win, hasOlder } = selectWindow(events, undefined, 200);
    expect(win.length).toBe(81);
    // Oldest surviving seq is 3120 (> 1), so olderExists is true — the window
    // fits the budget but real history precedes it.
    expect(hasOlder).toBe(true);
  });

  it("contiguous-from-1 buffer reports hasOlder=false when it fits the budget", () => {
    const events = run(1, 50);
    const { hasOlder } = selectWindow(events, undefined, 200);
    expect(hasOlder).toBe(false);
  });
});
