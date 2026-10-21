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
import { afterEach, describe, expect, it } from "vitest";
import { disableSubagentsPlugin, registerSubagentsReducerSlice } from "../../test-support/subagents-reducer-slice.js";
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

// ── A live tick disproves a `session_ended` heal ─────────────────────────────
// A live bridge replay (old bridges / poisoned stores) can carry a fabricated
// `session_ended` end for a call that is still running. The next live tick
// proves the process is alive: the card and its subagent go back to running.
// See change: fix-replay-fabricates-orphan-end-for-live-calls (D5, D6).
const liveTick = (t: number, id: string, agentId: string): DashboardEvent => ({
  eventType: "tool_execution_update",
  timestamp: t,
  data: {
    toolCallId: id,
    partialResult: {
      content: [{ type: "text", text: "(running…)" }],
      details: { agentId, subagentType: "Explore", description: "probe", status: "running", toolUses: 5 },
    },
  },
});
const realSubagentFail = (t: number, id: string): DashboardEvent => ({
  eventType: "subagent_failed",
  timestamp: t,
  data: { id, error: "model refused" },
});

describe("session_ended heal — reopened by a live tick", () => {
  const poisoned = () =>
    apply([asstStart(1), toolStart(2, "A"), liveTick(3, "A", "ag-1"), healEnd(4, "A", "ag-1")]);

  it("records the heal marker on the subagent and clears it on real writes (test-plan #F6)", () => {
    const healed = apply([subagentStarted(1, "ag-1"), healSubagentFail(2, "ag-1")]);
    expect(healed.subagents.get("ag-1")?.healedBy).toBe("session_ended");

    const restarted = reduceEvent(healed, subagentStarted(3, "ag-1"));
    expect(restarted.subagents.get("ag-1")?.healedBy).toBeUndefined();

    const realDone = reduceEvent(healed, subagentCompleted(3, "ag-1"));
    expect(realDone.subagents.get("ag-1")?.healedBy).toBeUndefined();

    const viaEnd = apply([asstStart(1), toolStart(2, "A"), liveTick(3, "A", "ag-1"), healEnd(4, "A", "ag-1")]);
    expect(viaEnd.subagents.get("ag-1")?.healedBy).toBe("session_ended");
    const realBackfill = reduceEvent(viaEnd, {
      eventType: "tool_execution_end",
      timestamp: 5,
      data: { toolCallId: "A", toolName: "Agent", result: "done", isError: false, details: { agentId: "ag-1" } },
    });
    expect(realBackfill.subagents.get("ag-1")?.healedBy).toBeUndefined();
    expect(realBackfill.subagents.get("ag-1")?.status).toBe("completed");
  });

  it("reopens the row, the toolCalls entry and the subagent (test-plan #F1)", () => {
    const before = poisoned();
    expect(before.toolCalls.get("A")?.status).toBe("error");

    const s = reduceEvent(before, liveTick(10, "A", "ag-1"));
    const row = s.messages.findLast((m) => m.toolCallId === "A");
    expect(row?.toolStatus).toBe("running");
    expect(s.toolCalls.get("A")?.status).toBe("running");
    expect(row?.duration).toBeUndefined();
    expect(row?.toolDetails?.healedBy).toBeUndefined();
    const sub = s.subagents.get("ag-1");
    expect(sub?.status).toBe("running");
    expect(sub?.healedBy).toBeUndefined();
    expect(sub?.error).toBeUndefined();
    // The "result not received" badge (`isAgentResultNotReceived`) keys on these two.
    expect(row?.toolDetails?.healedBy).not.toBe("session_ended");
    expect(row?.toolDetails?.resultMissing).toBeUndefined();
  });

  it("the real end after a reopen finalizes normally (test-plan #F2)", () => {
    const reopened = reduceEvent(poisoned(), liveTick(10, "A", "ag-1"));
    const s = reduceEvent(reopened, {
      eventType: "tool_execution_end",
      timestamp: 20,
      data: { toolCallId: "A", toolName: "Agent", result: "done", isError: false, details: { agentId: "ag-1" } },
    });
    const row = s.messages.findLast((m) => m.toolCallId === "A");
    expect(row?.toolStatus).toBe("complete");
    expect(row?.result).toBe("done");
    expect(s.subagents.get("ag-1")?.status).toBe("completed");
  });

  it("a real terminal row is not reopened (test-plan #F3)", () => {
    const done = apply([asstStart(1), toolStart(2, "A"), liveTick(3, "A", "ag-1"), realEnd(4, "A", "done")]);
    const s = reduceEvent(done, liveTick(5, "A", "ag-1"));
    expect(s.messages.findLast((m) => m.toolCallId === "A")?.toolStatus).toBe("complete");
    expect(s.toolCalls.get("A")?.status).toBe("complete");
  });

  it("a really-failed subagent is not reopened (test-plan #F4)", () => {
    const before = apply([
      asstStart(1),
      toolStart(2, "A"),
      liveTick(3, "A", "ag-1"),
      realSubagentFail(4, "ag-1"),
      healEnd(5, "A", "ag-1"),
    ]);
    const s = reduceEvent(before, liveTick(10, "A", "ag-1"));
    expect(s.subagents.get("ag-1")?.status).toBe("failed");
    expect(s.subagents.get("ag-1")?.error).toBe("model refused");
  });

  it("other heals keep their behaviour (test-plan #F5)", () => {
    // turn_settled: the neutral settle heal stays finalized on a late tick.
    const settled = apply([
      asstStart(1),
      toolStart(2, "A"),
      liveTick(3, "A", "ag-1"),
      { eventType: "agent_settled", timestamp: 4, data: {} },
    ]);
    const settledRow = settled.messages.findLast((m) => m.toolCallId === "A");
    expect(settledRow?.toolDetails?.healedBy).toBe("turn_settled");
    const s1 = reduceEvent(settled, liveTick(5, "A", "ag-1"));
    const r1 = s1.messages.findLast((m) => m.toolCallId === "A");
    expect(r1?.toolStatus).toBe("complete");
    expect(r1?.toolDetails?.healedBy).toBe("turn_settled");

    // subagent_stopped heal from a real subagent_completed stays terminal.
    const stopped = apply([asstStart(1), toolStart(2, "A"), liveTick(3, "A", "ag-1"), subagentCompleted(4, "ag-1")]);
    const s2 = reduceEvent(stopped, liveTick(5, "A", "ag-1"));
    expect(s2.messages.findLast((m) => m.toolCallId === "A")?.toolStatus).toBe("complete");
    expect(s2.subagents.get("ag-1")?.status).toBe("completed");
  });
});

// ── Subagents plugin disabled: the generic heals stay in core ────────────────
// With the plugin off no finalizer is registered: the server-synthesized end
// still stops the Agent row, the neutral settle heal still runs, a live tick
// still reopens the row — and `SessionState.subagents` is never written; the
// synthesized `subagent_failed` folds into the owned group row.
// See change: decouple-plugins-from-core (design D5 items 8-9; test-plan #X4).
describe("session_ended heal — subagents plugin disabled (test-plan #X4)", () => {
  afterEach(() => {
    registerSubagentsReducerSlice();
  });

  it("Agent card heals without the plugin; subagent_failed folds into the group row", () => {
    disableSubagentsPlugin();
    const before = apply([asstStart(1), toolStart(2, "A"), liveTick(3, "A", "ag-1")]);
    const subagentsBefore = before.subagents;
    const s = apply([healEnd(4, "A", "ag-1"), healSubagentFail(5, "ag-1")], before);

    const row = s.messages.findLast((m) => m.toolCallId === "A");
    expect(row?.toolStatus).toBe("error");
    expect(row?.result).toBe("parent session ended");
    expect(s.toolCalls.get("A")?.status).toBe("error");
    expect(s.subagents).toBe(subagentsBefore);
    expect(s.subagents.size).toBe(0);
    const group = s.messages.find((m) => (m as { ownedGroup?: unknown }).ownedGroup);
    expect(group).toMatchObject({ role: "rawEvent", toolName: "subagent_failed", ownedGroup: { ownerId: "subagents", count: 1 } });
  });

  it("a live tick on a session_ended row reopens the row and leaves subagents untouched", () => {
    disableSubagentsPlugin();
    const healed = apply([asstStart(1), toolStart(2, "A"), healEnd(3, "A", "ag-1")]);
    const subagentsBefore = healed.subagents;
    const s = reduceEvent(healed, liveTick(10, "A", "ag-1"));
    const row = s.messages.findLast((m) => m.toolCallId === "A");
    expect(row?.toolStatus).toBe("running");
    expect(row?.toolDetails?.healedBy).toBeUndefined();
    expect(row?.duration).toBeUndefined();
    expect(s.toolCalls.get("A")?.status).toBe("running");
    expect(s.subagents).toBe(subagentsBefore);
  });

  it("a running Agent row at turn settle gets the neutral sentinel body", () => {
    disableSubagentsPlugin();
    const s = apply([
      asstStart(1),
      toolStart(2, "A"),
      liveTick(3, "A", "ag-1"),
      { eventType: "agent_settled", timestamp: 4, data: {} },
    ]);
    const row = s.messages.findLast((m) => m.toolCallId === "A");
    expect(row?.toolStatus).toBe("complete");
    expect(row?.result).toBe("subagent stopped — result not received");
    expect(row?.toolDetails?.resultMissing).toBe(true);
    expect(row?.toolDetails?.healedBy).toBe("turn_settled");
    expect(s.subagents.size).toBe(0);
  });
});
