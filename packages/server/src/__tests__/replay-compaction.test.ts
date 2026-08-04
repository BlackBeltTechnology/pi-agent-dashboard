/**
 * Unit tests for `compactEventsForReplay` — test-plan scenarios E1–E9, P2, P3.
 * See change: compact-warm-replay-stream.
 */
import { describe, expect, it } from "vitest";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { StoredEvent } from "../persistence/memory-event-store.js";
import { compactEventsForReplay } from "../session/replay-compaction.js";
import { largeSyntheticWindow, subagentInterleavedWindow } from "./fixtures/replay-streams.js";

/** Terse window builder: `ev("message_update", 3)` → StoredEvent at seq 3. */
function ev(eventType: string, seq: number, data: Record<string, unknown> = {}): StoredEvent {
  const event: DashboardEvent = { eventType, timestamp: 1_700_000_000_000 + seq, data };
  return { seq, event };
}
const types = (w: StoredEvent[]) => w.map((e) => e.event.eventType);
const seqs = (w: StoredEvent[]) => w.map((e) => e.seq);

const assistantUpdate = (seq: number, text: string) =>
  ev("message_update", seq, { message: { role: "assistant", content: [{ type: "text", text }] } });

describe("compactEventsForReplay — supersession + boundaries", () => {
  it("E1: a 500-update window collapses to [message_start, message_end]", () => {
    const w: StoredEvent[] = [ev("message_start", 1)];
    for (let s = 2; s <= 501; s++) w.push(assistantUpdate(s, `t${s}`));
    w.push(ev("message_end", 502));
    const out = compactEventsForReplay(w);
    expect(seqs(out)).toEqual([1, 502]);
    expect(types(out)).not.toContain("message_update");
  });

  it("E2: single-update minimum case", () => {
    const out = compactEventsForReplay([ev("message_start", 1), assistantUpdate(2, "x"), ev("message_end", 3)]);
    expect(seqs(out)).toEqual([1, 3]);
  });

  it("E3: empty window returns empty, no throw", () => {
    expect(compactEventsForReplay([])).toEqual([]);
  });

  it("E4: window with no message_end at all is returned unchanged", () => {
    const w: StoredEvent[] = [ev("message_start", 1)];
    for (let s = 2; s <= 20; s++) w.push(assistantUpdate(s, `t${s}`));
    const out = compactEventsForReplay(w);
    expect(out).toEqual(w);
    expect(out).toHaveLength(20);
  });
});

describe("compactEventsForReplay — passthrough + shape", () => {
  it("E5: every non-message_update event survives in original relative order", () => {
    // NOTE: seq 3 is the last text update BEFORE the tool_execution_start, so
    // the flush exemption retains it — required by F2 equivalence. seq 5 (the
    // superseded snapshot after the tool start) is dropped.
    const w = [
      ev("turn_start", 1),
      ev("message_start", 2),
      assistantUpdate(3, "a"),
      ev("tool_execution_start", 4, { toolCallId: "c1" }),
      assistantUpdate(5, "ab"),
      ev("subagent_created", 6, { agentId: "s1" }),
      ev("tool_execution_end", 7, { toolCallId: "c1" }),
      ev("stats_update", 8),
      ev("session_compact", 9),
      ev("message_end", 10),
      ev("turn_end", 11),
    ];
    const out = compactEventsForReplay(w);
    expect(types(out)).toEqual([
      "turn_start",
      "message_start",
      "message_update",
      "tool_execution_start",
      "subagent_created",
      "tool_execution_end",
      "stats_update",
      "session_compact",
      "message_end",
      "turn_end",
    ]);
    expect(seqs(out)).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11]);
  });

  it("E6: idempotent — compact(compact(w)) deep-equals compact(w)", () => {
    for (const w of [
      subagentInterleavedWindow(),
      [ev("message_start", 1), assistantUpdate(2, "a"), ev("message_end", 3), assistantUpdate(4, "b")],
    ]) {
      const once = compactEventsForReplay(w);
      expect(compactEventsForReplay(once)).toEqual(once);
    }
  });

  it("E8: a window opening with a bare message_end does not throw and keeps everything before it", () => {
    const w = [ev("tool_execution_end", 1, { toolCallId: "c0" }), ev("message_end", 2), ev("turn_end", 3)];
    expect(compactEventsForReplay(w)).toEqual(w);
  });
});

describe("compactEventsForReplay — seq contract", () => {
  it("E7: output seqs are exactly [1,2,99,100] and no surviving seq is mutated", () => {
    const w: StoredEvent[] = [ev("turn_start", 1), ev("message_start", 2)];
    for (let s = 3; s <= 98; s++) w.push(assistantUpdate(s, `t${s}`));
    w.push(ev("message_end", 99), ev("turn_end", 100));
    const out = compactEventsForReplay(w);
    expect(seqs(out)).toEqual([1, 2, 99, 100]);
    // Surviving entries are the SAME objects/values as the input, seq untouched.
    for (const e of out) {
      expect(w.find((x) => x.seq === e.seq)!.event).toBe(e.event);
    }
  });
});

describe("compactEventsForReplay — streaming tail", () => {
  it("E9: finalized M1's updates drop while the still-streaming M2 keeps all 12", () => {
    const w: StoredEvent[] = [ev("message_start", 1)];
    for (let s = 2; s <= 9; s++) w.push(assistantUpdate(s, `m1-${s}`));
    w.push(ev("message_end", 10));
    w.push(ev("message_start", 11));
    for (let s = 12; s <= 23; s++) w.push(assistantUpdate(s, `m2-${s}`));
    const out = compactEventsForReplay(w);
    expect(seqs(out)).toEqual([1, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    expect(out.filter((e) => e.event.eventType === "message_update")).toHaveLength(12);
  });
});

describe("compactEventsForReplay — budget", () => {
  it("P2: compacted count ≤ 2× the cold-load (state-replay) count for the same messages", () => {
    const messages = 140;
    const w = largeSyntheticWindow(messages, 150);
    const out = compactEventsForReplay(w);
    // state-replay.ts emits per turn: user message_start + assistant
    // message_update + assistant message_end = 3 events.
    const coldLoadCount = messages * 3;
    expect(w.length).toBeGreaterThan(19_000);
    expect(out.length).toBeLessThanOrEqual(coldLoadCount * 2);
  });

  it("P3: p95 under 50 ms on a 20k-event window, single output array", () => {
    const w = largeSyntheticWindow(140, 150);
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      compactEventsForReplay(w);
      samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * 0.95) - 1]).toBeLessThan(50);
  });

  it("returns a NEW array and never mutates the input window", () => {
    const w = [ev("message_start", 1), assistantUpdate(2, "a"), ev("message_end", 3)];
    const snapshot = [...w];
    const out = compactEventsForReplay(w);
    expect(out).not.toBe(w);
    expect(w).toEqual(snapshot);
  });
});
