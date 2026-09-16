/**
 * Reducer guards for the server-synthesized `healedBy:"session_ended"` heal.
 *
 * The heal terminates tool cards + subagents left open by a session that died.
 * It must only ever finalize a `running` row: a real terminal state (a call
 * that completed, a subagent that reported `completed`) must never be clobbered
 * by a late synthesized end.
 *
 * Folded 1:1 from the change's test-plan manifest: F1–F5.
 * See change: heal-orphaned-tool-cards-on-session-end (design D4).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";

function apply(events: DashboardEvent[], from: SessionState = createInitialState()): SessionState {
  return events.reduce((s, e) => reduceEvent(s, e), from);
}

const asstStart = (t: number): DashboardEvent => ({
  eventType: "message_start",
  timestamp: t,
  data: { message: { role: "assistant", content: [] } },
});
const toolStart = (t: number, id: string, name = "Agent"): DashboardEvent => ({
  eventType: "tool_execution_start",
  timestamp: t,
  data: { toolCallId: id, toolName: name, args: {} },
});
const realEnd = (t: number, id: string, result = "ok"): DashboardEvent => ({
  eventType: "tool_execution_end",
  timestamp: t,
  data: { toolCallId: id, toolName: "Agent", result, isError: false },
});
/** Exactly what `synthesizeSessionEndedEnd` puts on the wire. */
const healEnd = (t: number, id: string, agentId?: string): DashboardEvent => ({
  eventType: "tool_execution_end",
  timestamp: t,
  data: {
    toolCallId: id,
    toolName: "Agent",
    isError: true,
    result: "parent session ended",
    healedBy: "session_ended",
    ...(agentId ? { details: { agentId } } : {}),
  },
});
/** Exactly what `synthesizeSessionEndedSubagentFail` puts on the wire. */
const healSubagentFail = (t: number, id: string): DashboardEvent => ({
  eventType: "subagent_failed",
  timestamp: t,
  data: { id, error: "parent session ended", healedBy: "session_ended" },
});
const subagentStarted = (t: number, id: string): DashboardEvent => ({
  eventType: "subagent_started",
  timestamp: t,
  data: { id, type: "Explore", description: "d" },
});
const subagentCompleted = (t: number, id: string): DashboardEvent => ({
  eventType: "subagent_completed",
  timestamp: t,
  data: { id, result: "done" },
});

describe("session_ended heal — reducer guards", () => {
  it("flips a running Agent card to error and its subagent to failed (#F1)", () => {
    const s = apply([asstStart(1), toolStart(2, "A"), subagentStarted(3, "ag-1"), healEnd(4, "A", "ag-1")]);

    expect(s.toolCalls.get("A")?.status).toBe("error");
    expect(s.messages.findLast((m) => m.toolCallId === "A")?.toolStatus).toBe("error");
    expect(s.subagents.get("ag-1")?.status).toBe("failed");
    expect(s.subagents.get("ag-1")?.error).toBe("parent session ended");
  });

  it("keeps the live Agent snapshot on the healed row (review fix)", () => {
    const tick: DashboardEvent = {
      eventType: "tool_execution_update",
      timestamp: 3,
      data: {
        toolCallId: "A",
        partialResult: {
          content: [{ type: "text", text: "(running…)" }],
          details: {
            agentId: "ag-1",
            subagentType: "Explore",
            description: "probe",
            toolUses: 4,
            status: "running",
          },
        },
      },
    };
    const s = apply([asstStart(1), toolStart(2, "A"), tick, healEnd(4, "A", "ag-1")]);
    const row = s.messages.findLast((m) => m.toolCallId === "A");
    // The synthesized end carries only `{agentId}` — the snapshot must survive.
    expect(row?.toolDetails?.agentId).toBe("ag-1");
    expect(row?.toolDetails?.subagentType).toBe("Explore");
    expect(row?.toolDetails?.toolUses).toBe(4);
    // …but the snapshot's own status goes terminal with the card.
    expect(row?.toolDetails?.status).toBe("error");
  });

  it("does not clobber an already-complete tool call (#F2)", () => {
    const before = apply([asstStart(1), toolStart(2, "A"), realEnd(3, "A")]);
    const after = reduceEvent(before, healEnd(4, "A"));
    expect(after).toEqual(before);
  });

  it("does not clobber an already-completed subagent (#F3)", () => {
    const before = apply([
      asstStart(1),
      toolStart(2, "A"),
      subagentStarted(3, "ag-1"),
      subagentCompleted(4, "ag-1"),
    ]);

    const viaBackfill = reduceEvent(before, healEnd(5, "A", "ag-1"));
    expect(viaBackfill.subagents.get("ag-1")?.status).toBe("completed");
    expect(viaBackfill.toolCalls.get("A")?.status).toBe("error");

    const viaFail = reduceEvent(viaBackfill, healSubagentFail(6, "ag-1"));
    expect(viaFail.subagents.get("ag-1")?.status).toBe("completed");
    expect(viaFail.toolCalls.get("A")?.status).toBe("error");
  });

  it("lets a real end overwrite a superseded placeholder and clear the marker (#F4)", () => {
    const superseded = apply([
      asstStart(1),
      toolStart(2, "A"),
      {
        eventType: "tool_execution_end",
        timestamp: 3,
        data: { toolCallId: "A", toolName: "Agent", result: "", isError: false, healedBy: "superseded" },
      },
    ]);
    expect(superseded.messages.findLast((m) => m.toolCallId === "A")?.toolDetails?.healedBy).toBe("superseded");

    const real = reduceEvent(superseded, realEnd(4, "A", "the real result"));
    const row = real.messages.findLast((m) => m.toolCallId === "A");
    expect(row?.result).toBe("the real result");
    expect(row?.toolDetails?.healedBy).toBeUndefined();
  });

  it("creates no phantom card for an unknown tool call id (#F5)", () => {
    const before = apply([asstStart(1), toolStart(2, "A")]);
    const after = reduceEvent(before, healEnd(3, "Z"));
    expect(after).toEqual(before);
  });
});
