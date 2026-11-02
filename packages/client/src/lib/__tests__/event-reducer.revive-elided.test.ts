/**
 * A long-running tool whose `tool_execution_start` lands in a lazy BACKFILL
 * segment (tail-only replay after restart/reload) must not be stuck at
 * "result not loaded": a server-reported open call stays running through the
 * splice, and a live top-level tick revives an elided row.
 *
 * Promoted from the spike (commit 4dd743584) and extended with test-plan
 * scenarios F1–F9. The subagents finalizer is registered by the vitest setup
 * file (`test-support/subagents-reducer-slice.ts`).
 * See change: fix-backfill-elides-live-tools (D2, D3).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import {
  createInitialState,
  finalizeBackfillSegment,
  hasLaterAssistantInference,
  reduceEvent,
  type SessionState,
  seedRunningToolCall,
} from "../chat/event-reducer.js";

const evt = (eventType: string, data: Record<string, unknown> = {}, ts = 1000): DashboardEvent =>
  ({ eventType, timestamp: ts, data }) as DashboardEvent;
const fold = (events: DashboardEvent[], from: SessionState = createInitialState()) =>
  events.reduce((s, e) => reduceEvent(s, e), from);

const assistantStart = () => evt("message_start", { message: { role: "assistant", content: [] } });
const toolStart = (id: string, toolName = "Agent", ts = 1000) =>
  evt("tool_execution_start", { toolCallId: id, toolName, args: { description: `apply ${id}` } }, ts);
const agentTick = (id: string, details: Record<string, unknown> = { agentId: `a-${id}`, status: "running" }, ts = 5000) =>
  evt(
    "tool_execution_update",
    { toolCallId: id, toolName: "Agent", partialResult: { content: [{ type: "text", text: "working" }], details } },
    ts,
  );
const realEnd = (id: string, toolName = "Agent") =>
  evt("tool_execution_end", { toolCallId: id, toolName, isError: false, result: "done" }, 9000);
const sessionEndedHeal = (id: string) =>
  evt("tool_execution_end", {
    toolCallId: id,
    toolName: "Agent",
    isError: true,
    result: "parent session ended",
    healedBy: "session_ended",
  });

/** Mirror of the `useMessageHandler` `history_backfill_result` splice (gap row omitted). */
function splice(current: SessionState, backfill: DashboardEvent[], openToolCallIds?: ReadonlySet<string>): SessionState {
  const seg = fold(backfill);
  const spliced = finalizeBackfillSegment(seg.messages, openToolCallIds);
  let toolCalls = current.toolCalls;
  for (const row of spliced) {
    if (row.toolStatus === "running" && row.toolCallId && openToolCallIds?.has(row.toolCallId)) {
      toolCalls = seedRunningToolCall(toolCalls, row, current.assistantInferenceSeq, backfill[0]?.timestamp);
    }
  }
  return { ...current, messages: [...spliced, ...current.messages], toolCalls };
}

const row = (s: SessionState, id: string) => s.messages.find((m) => m.toolCallId === id);

/** Live tail newer than the Agent start, with `n` assistant inferences already seen. */
const tail = (inferences = 0) =>
  fold([
    ...Array.from({ length: inferences }, assistantStart),
    evt("message_start", { message: { role: "user", content: [{ type: "text", text: "later" }] } }),
  ]);

describe("backfill elides a still-running tool (spike reproduction)", () => {
  it("without an open report the splice stamps the row elided", () => {
    const s = splice(tail(), [toolStart("t1")]);
    expect(row(s, "t1")?.toolStatus).toBe("elided");
  });

  it("a live tick revives an elided row and re-seats the toolCalls entry", () => {
    let s = splice(tail(), [toolStart("t1")]);
    s = reduceEvent(s, agentTick("t1"));
    expect(row(s, "t1")?.toolStatus).toBe("running");
    expect(s.toolCalls.get("t1")?.status).toBe("running");
  });

  it("an id the server reports open is never elided", () => {
    const s = splice(tail(), [toolStart("t1"), toolStart("t2")], new Set(["t1"]));
    expect(row(s, "t1")?.toolStatus).toBe("running");
    expect(row(s, "t2")?.toolStatus).toBe("elided");
  });
});

describe("reviveElidedRow on a top-level tool_execution_update (F1–F7)", () => {
  /** A spliced elided Agent row carrying stale heal-settled details. */
  function elidedAgent(inferences = 3): SessionState {
    const s = splice(tail(inferences), [toolStart("r", "Agent", 1000)]);
    return {
      ...s,
      messages: s.messages.map((m) =>
        m.toolCallId === "r" ? { ...m, toolDetails: { status: "completed", healedBy: "turn_settled", resultMissing: true } } : m,
      ),
    };
  }

  it("F1: a structured tick revives the row, clears heal keys and seeds a complete entry", () => {
    const before = elidedAgent(3);
    expect(row(before, "r")?.toolStatus).toBe("elided");
    expect(before.assistantInferenceSeq).toBe(3);
    const s = reduceEvent(before, agentTick("r", { status: "running" }));
    expect(row(s, "r")?.toolStatus).toBe("running");
    expect(row(s, "r")?.toolDetails?.status).toBe("running");
    expect(row(s, "r")?.toolDetails).not.toHaveProperty("healedBy");
    expect(s.toolCalls.get("r")).toMatchObject({ status: "running", startedAt: 1000, emittedAtInferenceSeq: 3 });
  });

  it("F2: a tick without partialResult, or with a plain string, revives and seeds", () => {
    for (const partialResult of [undefined, "line of output"]) {
      const base = splice(tail(), [toolStart("b", "Bash")]);
      expect(row(base, "b")?.toolStatus).toBe("elided");
      const s = reduceEvent(base, evt("tool_execution_update", { toolCallId: "b", toolName: "Bash", partialResult }));
      expect(row(s, "b")?.toolStatus, String(partialResult)).toBe("running");
      expect(s.toolCalls.get("b")?.status, String(partialResult)).toBe("running");
    }
  });

  it("F3: a nested update naming the elided root never revives it", () => {
    const base = splice(tail(), [toolStart("r", "Agent")]);
    const s = reduceEvent(
      base,
      evt("tool_execution_update", { toolCallId: "child", toolName: "Bash", parentToolCallId: "r", partialResult: "x" }),
    );
    expect(row(s, "r")?.toolStatus).toBe("elided");
    expect(s.toolCalls.has("r")).toBe(false);
  });

  it("F4: a real end completes a revived row", () => {
    let s = reduceEvent(elidedAgent(), agentTick("r", { status: "running" }));
    s = reduceEvent(s, realEnd("r"));
    expect(row(s, "r")?.toolStatus).toBe("complete");
    expect(row(s, "r")?.result).toBe("done");
  });

  it("F5: a session_ended heal closes both a revived row and a splice-kept row", () => {
    let s = splice(tail(), [toolStart("rev", "Bash"), toolStart("kept", "Bash")], new Set(["kept"]));
    expect(row(s, "kept")?.toolStatus).toBe("running");
    s = reduceEvent(s, evt("tool_execution_update", { toolCallId: "rev", toolName: "Bash" }));
    s = reduceEvent(s, sessionEndedHeal("rev"));
    s = reduceEvent(s, sessionEndedHeal("kept"));
    expect(row(s, "rev")?.toolStatus).toBe("error");
    expect(row(s, "kept")?.toolStatus).toBe("error");
  });

  it("F6: only an inference AFTER the revive makes the call supersedable", () => {
    const s = reduceEvent(elidedAgent(3), agentTick("r", { status: "running" }));
    expect(s.toolCalls.get("r")?.emittedAtInferenceSeq).toBe(3);
    expect(hasLaterAssistantInference(s, "r")).toBe(false);
    expect(hasLaterAssistantInference(reduceEvent(s, assistantStart()), "r")).toBe(true);
  });

  it("F7: a late tick never revives a row completed by a real end", () => {
    let s = fold([toolStart("c", "Bash"), realEnd("c", "Bash")]);
    s = reduceEvent(s, evt("tool_execution_update", { toolCallId: "c", toolName: "Bash", partialResult: "late" }));
    expect(row(s, "c")?.toolStatus).toBe("complete");
  });
});

describe("revive vs the Agent finalizer (F8, F9)", () => {
  it("F8: a late tick for a subagent the client records terminal leaves the elided card as it was", () => {
    let s = splice(tail(), [toolStart("r", "Agent")]);
    s = reduceEvent(s, evt("subagent_completed", { id: "ag-1", result: "R" }));
    expect(s.subagents.get("ag-1")?.status).toBe("completed");
    s = reduceEvent(s, agentTick("r", { agentId: "ag-1", status: "running" }));
    expect(row(s, "r")?.toolStatus).toBe("elided");
    expect(s.toolCalls.get("r")?.status).not.toBe("running");
  });

  it("F8b: a tick WITHOUT partialResult for a terminal subagent's row also leaves it elided", () => {
    let s = splice(tail(), [toolStart("r", "Agent")]);
    s = {
      ...s,
      messages: s.messages.map((m) => (m.toolCallId === "r" ? { ...m, toolDetails: { agentId: "ag-1" } } : m)),
    };
    s = reduceEvent(s, evt("subagent_completed", { id: "ag-1", result: "R" }));
    s = reduceEvent(s, evt("tool_execution_update", { toolCallId: "r", toolName: "Agent" }));
    expect(row(s, "r")?.toolStatus).toBe("elided");
    expect(s.toolCalls.has("r")).toBe(false);
    // A plain-string partial result (forwarded unthrottled) takes the same path.
    s = reduceEvent(s, evt("tool_execution_update", { toolCallId: "r", toolName: "Agent", partialResult: "late text" }));
    expect(row(s, "r")?.toolStatus).toBe("elided");
    expect(s.toolCalls.has("r")).toBe(false);
  });

  it("F9: an unknown subagent's tick revives the row AND hydrates the subagent", () => {
    let s = splice(tail(), [toolStart("r", "Agent")]);
    s = reduceEvent(s, agentTick("r", { agentId: "ag-2", status: "running" }));
    expect(row(s, "r")?.toolStatus).toBe("running");
    expect(s.subagents.get("ag-2")?.status).toBe("running");
  });
});

describe("seedRunningToolCall", () => {
  const keptRow = { id: "tool-c1", role: "toolResult", content: "Agent", toolName: "Agent", toolCallId: "c1", toolStatus: "running", timestamp: 9, startedAt: 9 } as SessionState["messages"][number];

  it("leaves an existing RUNNING entry untouched (same Map)", () => {
    const map = new Map([["c1", { toolCallId: "c1", toolName: "Agent", status: "running" as const, startedAt: 5, emittedAtInferenceSeq: 1 }]]);
    expect(seedRunningToolCall(map, keptRow, 4)).toBe(map);
  });

  it("restores a TERMINAL entry the server reports open to running, refreshing only its inference stamp", () => {
    const map = new Map([["c1", { toolCallId: "c1", toolName: "Agent", status: "complete" as const, startedAt: 5, emittedAtInferenceSeq: 1 }]]);
    const out = seedRunningToolCall(map, keptRow, 4);
    expect(out).not.toBe(map);
    expect(out.get("c1")).toMatchObject({ status: "running", startedAt: 5, emittedAtInferenceSeq: 4 });
    expect(map.get("c1")?.status).toBe("complete");
  });
});
