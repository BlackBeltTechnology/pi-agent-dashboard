/**
 * Phase 3 (change: reduce-chat-render-cpu-umbrella): live-event coalescing.
 *
 * `foldLiveEvents` folds an N-event burst into a single SessionState. The core
 * invariant: the folded result is identical to applying the same events
 * one-by-one via `reduceEvent` in seq order, and the reported `maxSeq` equals
 * the batch maximum — regardless of the order the events were queued in.
 */

import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { foldLiveEvents, type QueuedLiveEvent } from "../chat/coalesce-live-events.js";
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";

let ts = 1000;
const mkUpdate = (type: string, extra: Record<string, unknown> = {}): DashboardEvent => ({
  eventType: "message_update",
  timestamp: (ts += 100),
  data: { assistantMessageEvent: { type, ...extra } },
});

// A representative live burst: agent start, streamed text + reasoning, end.
function burst(): QueuedLiveEvent[] {
  const events: DashboardEvent[] = [
    { eventType: "agent_start", timestamp: (ts += 100), data: {} },
    mkUpdate("text_delta", { delta: "Hello" }),
    mkUpdate("text_delta", { delta: " world" }),
    mkUpdate("thinking_start"),
    mkUpdate("thinking_delta", { delta: "hmm" }),
    mkUpdate("thinking_end"),
    mkUpdate("text_delta", { delta: "!" }),
  ];
  return events.map((event, i) => ({ seq: i + 1, event }));
}

// Sequential reference: apply each event one-by-one in seq order (live path).
function sequential(current: SessionState, queued: QueuedLiveEvent[]): SessionState {
  let s = current;
  for (const { event } of [...queued].sort((a, b) => a.seq - b.seq)) {
    s = reduceEvent(s, event, { isLive: true });
  }
  return s;
}

describe("foldLiveEvents", () => {
  it("yields state identical to sequential per-event application", () => {
    const initial = createInitialState();
    const q = burst();
    const folded = foldLiveEvents(initial, q);
    const seq = sequential(initial, q);
    expect(folded.state).toEqual(seq);
  });

  it("reports maxSeq as the batch maximum", () => {
    const q = burst();
    const { maxSeq } = foldLiveEvents(createInitialState(), q);
    expect(maxSeq).toBe(Math.max(...q.map((e) => e.seq)));
  });

  it("applies events in ascending seq order even when queued out of order", () => {
    const initial = createInitialState();
    const ordered = burst();
    const shuffled = [...ordered].reverse();
    // Folding a shuffled queue must equal folding the seq-ordered queue.
    expect(foldLiveEvents(initial, shuffled).state).toEqual(
      foldLiveEvents(initial, ordered).state,
    );
    expect(foldLiveEvents(initial, shuffled).maxSeq).toBe(ordered.length);
  });

  it("does not mutate the caller's queue array", () => {
    const q = [...burst()].reverse();
    const before = q.map((e) => e.seq);
    foldLiveEvents(createInitialState(), q);
    expect(q.map((e) => e.seq)).toEqual(before);
  });

  it("folds onto a non-initial base state without loss", () => {
    // Prime a base state, then fold a follow-up burst; compare to sequential.
    const base = reduceEvent(createInitialState(), burst()[0].event, { isLive: true });
    const q = burst().map((e, i) => ({ ...e, seq: i + 10 }));
    expect(foldLiveEvents(base, q).state).toEqual(sequential(base, q));
  });
});
