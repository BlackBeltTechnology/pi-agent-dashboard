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
import { createInitialState, finalizeBackfillSegment, reduceEvent, type SessionState } from "../chat/event-reducer.js";

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

/**
 * `elided` — the correctness floor for a reduced BACKFILL segment. Test-plan
 * scenarios E24, E25, E26, E27.
 *
 * Edge snapping is best-effort by design, so a slice can still end mid-turn and
 * orphan a `tool_execution_start` whose end lies in already-delivered content
 * and can therefore NEVER arrive. `finalizeBackfillSegment` is what turns that
 * into a truthful terminal state instead of a permanent spinner.
 *
 * See change: fix-lazy-history-backfill-ux (D5).
 */
describe("finalizeBackfillSegment — the backfill seam (E24, E25, E26, E27)", () => {
  const startTool = (id: string) => evt("tool_execution_start", { toolCallId: id, toolName: "Bash", args: {} });
  const endTool = (id: string) => evt("tool_execution_end", { toolCallId: id, toolName: "Bash", result: "ok" });
  const toolRows = (s: SessionState) => s.messages.filter((m) => m.toolCallId !== undefined);

  /**
   * E24 — stamp ALL of them, not "the ones at a seam". Within a slice a
   * dangling start's end is always ABOVE the slice, and later slices are
   * strictly lower, so every still-running row in a COMPLETED backfill segment
   * is provably unjoinable. A seam-scoped rule would fire nowhere at all.
   */
  it("E24: unfinished tools at the FIRST, MIDDLE and LAST position all elide", () => {
    const seg = fold([
      startTool("first"),
      startTool("middle"),
      startTool("last"),
    ]);
    // Before the pass: every one of them is a live spinner.
    expect(toolRows(seg).map((m) => m.toolStatus)).toEqual(["running", "running", "running"]);

    const rows = finalizeBackfillSegment(seg.messages).filter((m) => m.toolCallId !== undefined);
    expect(rows).toHaveLength(3);
    expect(rows.map((m) => m.toolCallId)).toEqual(["first", "middle", "last"]);
    for (const row of rows) {
      expect(row.toolStatus).toBe("elided");
      expect(row.toolStatus).not.toBe("running");
    }
  });

  it("E24b: a tool the segment DID complete keeps its real terminal status", () => {
    const seg = fold([startTool("done"), endTool("done"), startTool("orphan")]);
    const rows = finalizeBackfillSegment(seg.messages).filter((m) => m.toolCallId !== undefined);
    const byId = new Map(rows.map((m) => [m.toolCallId, m.toolStatus]));
    expect(byId.get("done")).toBe("complete");
    expect(byId.get("orphan")).toBe("elided");
  });

  /**
   * E25/E26 — the stamp is scoped to backfill segments. A live session reopened
   * mid-tool-run, and the initial windowed replay's own head seam, both carry a
   * dangling start whose end simply has not happened YET. Stamping those would
   * label a genuinely running tool "not loaded" AND drop it from supersede-heal
   * eligibility, which selects on `status === "running"`.
   */
  it("E25: a live-path tool_execution_start with no end stays `running`", () => {
    const live = fold([startTool("live")]);
    expect(toolRows(live)[0].toolStatus).toBe("running");
    expect(live.toolCalls.get("live")?.status).toBe("running");
  });

  it("E26: a windowed REPLAY ending on an unfinished tool stays running and reconcile-eligible", () => {
    const replay = fold([
      evt("message_start", { message: { role: "user", content: [{ type: "text", text: "go" }] } }),
      evt("message_end", { message: { role: "user", content: [{ type: "text", text: "go" }] } }),
      startTool("tail-live"),
    ]);
    // The replay path does NOT call finalizeBackfillSegment.
    expect(toolRows(replay).at(-1)!.toolStatus).toBe("running");
    expect(replay.toolCalls.get("tail-live")?.status).toBe("running");
  });

  /**
   * E27 — the same defect one type over: a row left mid-stream that nothing
   * ever clears, i.e. a permanently "streaming" bubble.
   *
   * FINDING, recorded rather than papered over: `design.md` asserts the reducer
   * PRODUCES such a row when a slice's top edge lands mid-message. It does not.
   * `ChatMessage.isStreaming` is written `false` in exactly one place
   * (`useMessageHandler.ts:444`) and `true` in none — `next.isStreaming` in the
   * reducer is the SESSION-level flag (`SessionState.isStreaming`), a different
   * field that happens to share a name. The row-level defect is therefore not
   * reachable through `reduceEvent` today.
   *
   * The finalize half of the pass is kept anyway: it is one comparison on a
   * walk the stamp already performs, and it fails CLOSED if any future reducer
   * path starts setting the row flag. It is asserted directly on the helper,
   * because routing it through `reduceEvent` would be a vacuous test — the
   * precondition can never arise there.
   */
  it("E27: a row carrying isStreaming is finalized, and its content is preserved", () => {
    const rows = [
      { id: "a", role: "assistant" as const, content: "half a th", timestamp: 1, isStreaming: true },
      { id: "b", role: "user" as const, content: "settled", timestamp: 2 },
    ];
    const after = finalizeBackfillSegment(rows);
    expect(after.some((m) => m.isStreaming === true)).toBe(false);
    expect(after[0].isStreaming).toBe(false);
    // Finalizing is not discarding.
    expect(after[0].content).toBe("half a th");
    // Untouched rows keep referential identity.
    expect(after[1]).toBe(rows[1]);
  });

  it("E27b: guards the finding above — reduceEvent never sets the ROW-level isStreaming", () => {
    const seg = fold([
      evt("message_start", { message: { role: "assistant", content: [] } }),
      evt("message_update", { message: { role: "assistant", content: [{ type: "text", text: "half a th" }] } }),
    ]);
    // If this ever goes red, the row-level defect became reachable and E27
    // above should be re-expressed through the reducer.
    expect(seg.messages.some((m) => m.isStreaming === true)).toBe(false);
  });

  it("leaves a segment with nothing to fix strictly untouched (identity preserved)", () => {
    const seg = fold([startTool("done"), endTool("done")]);
    const after = finalizeBackfillSegment(seg.messages);
    expect(after).toEqual(seg.messages);
    for (let i = 0; i < after.length; i++) expect(after[i]).toBe(seg.messages[i]);
  });
});
