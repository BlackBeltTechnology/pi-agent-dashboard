/**
 * Design-validation (characterization) suite for change:
 * reduce-chat-render-cpu-umbrella — Phase 3 (coalesce live WS event application).
 *
 * Phase 3 batches `event` messages arriving in the same frame into ONE
 * `setSessionStates` fold instead of one `setState` per event. That is safe
 * ONLY IF moving the render boundaries never changes the resulting
 * `SessionState`. This suite pins the two reducer properties the design leans
 * on, against the REAL `reduceEvent` (live path):
 *
 *   1. FOLD SPLIT-INVARIANCE — folding a burst as one pass equals folding it
 *      as any two sub-passes. (batch boundary is irrelevant to output)
 *   2. ORDER-SENSITIVITY — applying the burst out of seq order produces a
 *      DIFFERENT state, so the coalesced fold MUST preserve seq order
 *      (design invariant: sort queued events by seq before folding).
 *
 * These are NOT tests of Phase 3 code (it does not exist yet) — they validate
 * that the existing reducer admits the batching design. If (1) ever fails,
 * frame-coalescing would silently corrupt the transcript.
 */

import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";

const LIVE = { isLive: true } as const;

/** A realistic mixed live burst: thinking, streamed text, and a tool call. */
function burst(): DashboardEvent[] {
  let ts = 1000;
  const t = () => (ts += 100);
  const am = (type: string, extra: Record<string, unknown> = {}): DashboardEvent => ({
    eventType: "message_update",
    timestamp: t(),
    data: { assistantMessageEvent: { type, ...extra } },
  });
  const text = (s: string): DashboardEvent => ({
    eventType: "message_update",
    timestamp: t(),
    data: { message: { role: "assistant", content: [{ type: "text", text: s }] } },
  });
  const tool = (eventType: string, extra: Record<string, unknown>): DashboardEvent => ({
    eventType,
    timestamp: t(),
    data: extra,
  });
  return [
    { eventType: "agent_start", timestamp: t(), data: {} },
    { eventType: "message_start", timestamp: t(), data: { message: { role: "assistant", content: [] } } },
    am("thinking_start"),
    am("thinking_delta", { delta: "let me check…" }),
    am("thinking_end"),
    text("Here is "),
    text("Here is the answer."),
    tool("tool_execution_start", { toolCallId: "c1", toolName: "read", args: { path: "a.ts" } }),
    tool("tool_execution_end", { toolCallId: "c1", toolName: "read", result: "file body" }),
    text("Done."),
    { eventType: "agent_end", timestamp: t(), data: {} },
  ];
}

/** Continuous fold (models one frame-batch). */
function foldWhole(events: DashboardEvent[]): SessionState {
  return events.reduce((s, e) => reduceEvent(s, e, LIVE), createInitialState());
}

/** Fold split at index k: two sub-folds (models two frame-batches). */
function foldSplit(events: DashboardEvent[], k: number): SessionState {
  const head = events.slice(0, k);
  const tail = events.slice(k);
  let s = head.reduce((acc, e) => reduceEvent(acc, e, LIVE), createInitialState());
  s = tail.reduce((acc, e) => reduceEvent(acc, e, LIVE), s);
  return s;
}

describe("Phase 3 design validation — reduceEvent fold invariants", () => {
  it("SPLIT-INVARIANCE: every batch boundary yields identical SessionState", () => {
    const events = burst();
    const whole = foldWhole(events);
    // Try EVERY split point — a frame boundary could fall anywhere in the burst.
    for (let k = 0; k <= events.length; k++) {
      expect(foldSplit(events, k), `split at k=${k} diverged from whole-fold`).toEqual(whole);
    }
  });

  it("DETERMINISM: two independent folds of the same burst are equal", () => {
    expect(foldWhole(burst())).toEqual(foldWhole(burst()));
  });

  it("ORDER-SENSITIVITY: out-of-order application diverges (so the fold MUST sort by seq)", () => {
    const events = burst();
    const whole = foldWhole(events);
    // Move agent_end to the front — a plausible out-of-order WS arrival.
    const misordered = [events[events.length - 1], ...events.slice(0, -1)];
    expect(foldWhole(misordered)).not.toEqual(whole);
  });
});
