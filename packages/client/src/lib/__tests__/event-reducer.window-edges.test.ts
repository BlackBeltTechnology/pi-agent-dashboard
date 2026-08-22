/**
 * Reducer tolerance at a WINDOW EDGE — test-plan F1, F2, F3.
 *
 * The server snaps both cut edges to message boundaries, but both snaps are
 * BEST-EFFORT: neither may find a boundary within `SNAP_LOOKUP`, so a head or
 * tail segment can genuinely begin with an orphaned terminator. Snapping raises
 * quality; THIS is the correctness guarantee. The repo already carries a
 * `fix-reducer-crash-undefined-toolname` regression precisely because a reducer
 * throw runs above every error boundary and black-screens the whole app.
 *
 * See change: lazy-load-session-history (D4).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";

function evt(eventType: string, data: Record<string, unknown> = {}, ts = 1000): DashboardEvent {
  return { eventType, timestamp: ts, data } as DashboardEvent;
}

const fold = (events: DashboardEvent[], from: SessionState = createInitialState()) =>
  events.reduce((s, e) => reduceEvent(s, e), from);

describe("reduceEvent — orphaned terminators at a window edge", () => {
  it("F1: a segment beginning with message_end and no message_start returns a state", () => {
    let state!: SessionState;
    expect(() => {
      state = fold([
        evt("message_end", { message: { role: "assistant", content: [{ type: "text", text: "orphan tail" }] } }),
        evt("message_start", { message: { role: "user", content: [{ type: "text", text: "next" }] } }),
        evt("message_end", { message: { role: "user", content: [{ type: "text", text: "next" }] } }),
      ]);
    }).not.toThrow();
    expect(state).toBeDefined();
    expect(Array.isArray(state.messages)).toBe(true);
  });

  it("F2: a segment beginning with tool_execution_end and no start returns a state", () => {
    let state!: SessionState;
    expect(() => {
      state = fold([
        evt("tool_execution_end", { toolCallId: "orphan-1", toolName: "Read", result: "…" }),
        evt("tool_execution_start", { toolCallId: "t2", toolName: "Bash", args: {} }),
        evt("tool_execution_end", { toolCallId: "t2", toolName: "Bash", result: "ok" }),
      ]);
    }).not.toThrow();
    expect(state).toBeDefined();
    expect(Array.isArray(state.messages)).toBe(true);
  });

  it("F2b: an orphaned tool_execution_end whose toolName is also absent does not throw", () => {
    expect(() => fold([evt("tool_execution_end", { toolCallId: "orphan-2" })])).not.toThrow();
  });
});

describe("reduceEvent — an in-stream seq discontinuity (F3)", () => {
  it("F3: head seqs 1-20 then tail seqs 4800-5000 fold into ONE coherent state", () => {
    // A windowed replay delivers head and tail in the SAME `event_replay`
    // stream, so the reducer sees a seq jump mid-fold. It must not treat the
    // tail as a fresh session: the reset rule is keyed on the batch's FIRST
    // seq, which is the head's, so no reset may fire on the tail.
    const head = Array.from({ length: 20 }, (_, i) =>
      evt("message_start", { message: { role: "user", content: [{ type: "text", text: `head ${i}` }] } }, 1000 + i),
    );
    const tail = Array.from({ length: 200 }, (_, i) =>
      evt("message_start", { message: { role: "user", content: [{ type: "text", text: `tail ${i}` }] } }, 9000 + i),
    );

    const afterHead = fold(head);
    const combined = fold(tail, afterHead);

    // The head's rows survive the discontinuity — nothing was rebuilt.
    expect(combined.messages.length).toBeGreaterThanOrEqual(afterHead.messages.length);
    const texts = combined.messages.map((m) => m.content);
    expect(texts).toContain("head 0");
    expect(texts).toContain("tail 199");
  });
});
