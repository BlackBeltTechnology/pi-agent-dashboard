/**
 * A per-subagent stop (producer ≥ 0.6.0) through the REAL shell reducer + the
 * subagents plugin's finalizer: `subagent_completed` with `details.status:
 * "stopped"` is terminal wherever completed/failed is, renders non-error, and
 * is never reopened.
 *
 * Covers test-plan #E11 (reduce half), #X4 (parent abort wins), #X5 (event
 * order), #X6 (heal / late tick / settle after stop).
 * See change: subagent-queue-visibility (D4).
 */

import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";

const ev = (eventType: string, data: Record<string, unknown>, timestamp = 1000): DashboardEvent => ({
  eventType,
  timestamp,
  data,
});
const apply = (events: DashboardEvent[], from: SessionState = createInitialState()) =>
  events.reduce((s, e) => reduceEvent(s, e), from);

const start = (id: string, ts = 1000) => ev("tool_execution_start", { toolCallId: id, toolName: "Agent", args: {} }, ts);
const tick = (id: string, agentId: string, status = "running", ts = 2000) =>
  ev(
    "tool_execution_update",
    {
      toolCallId: id,
      toolName: "Agent",
      partialResult: { content: [{ type: "text", text: "working" }], details: { agentId, status, stoppable: true } },
    },
    ts,
  );
const stoppedDetails = (agentId: string, stopReason: "queued" | "running") => ({
  agentId,
  status: "stopped",
  stopReason,
  stoppable: true,
  durationMs: 3000,
});
const stoppedEvent = (agentId: string, stopReason: "queued" | "running" = "running", ts = 4000) =>
  ev("subagent_completed", { id: agentId, result: "Subagent stopped by user.", details: stoppedDetails(agentId, stopReason) }, ts);
const stoppedEnd = (id: string, agentId: string, stopReason: "queued" | "running" = "running", ts = 5000) =>
  ev(
    "tool_execution_end",
    { toolCallId: id, toolName: "Agent", result: "Subagent stopped by user.", isError: false, details: stoppedDetails(agentId, stopReason) },
    ts,
  );
const healEnd = (id: string, agentId: string, ts = 7000) =>
  ev(
    "tool_execution_end",
    { toolCallId: id, toolName: "Agent", isError: true, result: "parent session ended", healedBy: "session_ended", details: { agentId } },
    ts,
  );
const healSubagentFail = (agentId: string, ts = 7000) =>
  ev("subagent_failed", { id: agentId, error: "parent session ended", healedBy: "session_ended" }, ts);

const row = (s: SessionState, id: string) => s.messages.find((m) => m.toolCallId === id)!;

describe("stopped subagent through the shell reducer", () => {
  it("#E11 reduce: subagent_completed{stopped} records stopped + stopReason and finalizes the row non-error", () => {
    const s = apply([start("A"), tick("A", "ag-1"), stoppedEvent("ag-1", "queued")]);
    expect(s.subagents.get("ag-1")).toMatchObject({ status: "stopped", stopReason: "queued" });
    expect(row(s, "A").toolStatus).toBe("complete");
    expect(row(s, "A").toolDetails).toMatchObject({ status: "stopped", stopReason: "queued" });
  });

  it.each([
    ["terminal event first", (s: SessionState) => apply([stoppedEvent("ag-1"), stoppedEnd("A", "ag-1")], s)],
    ["tool end first", (s: SessionState) => apply([stoppedEnd("A", "ag-1"), stoppedEvent("ag-1")], s)],
  ])("#X5 %s → stopped in both orders", (_label, finish) => {
    const s = finish(apply([start("A"), tick("A", "ag-1")]));
    expect(row(s, "A").toolStatus).toBe("complete");
    expect(row(s, "A").toolDetails?.status).toBe("stopped");
    expect(s.subagents.get("ag-1")?.status).toBe("stopped");
  });

  it("#X6 session-end heal, a late tick and the parent settle leave it stopped", () => {
    let s = apply([start("A"), tick("A", "ag-1"), stoppedEvent("ag-1")]);
    s = apply([healSubagentFail("ag-1"), healEnd("A", "ag-1")], s);
    expect(s.subagents.get("ag-1")?.status).toBe("stopped");
    expect(row(s, "A").toolStatus).toBe("complete");
    expect(row(s, "A").toolDetails?.status).toBe("stopped");

    s = apply([tick("A", "ag-1", "running", 8000)], s);
    expect(s.subagents.get("ag-1")?.status).toBe("stopped");
    expect(row(s, "A").toolStatus).toBe("complete");
    expect(row(s, "A").toolDetails?.status).toBe("stopped");

    s = apply([ev("agent_settled", {}, 9000)], s);
    expect(s.subagents.get("ag-1")?.status).toBe("stopped");
    expect(row(s, "A").toolDetails?.status).toBe("stopped");
  });

  it("#X4 parent abort wins: an aborted failure renders as error, never stopped", () => {
    const s = apply([
      start("A"),
      tick("A", "ag-1"),
      ev("subagent_failed", { id: "ag-1", error: "aborted by parent", details: { agentId: "ag-1", status: "aborted" } }, 4000),
    ]);
    expect(s.subagents.get("ag-1")?.status).toBe("failed");
    expect(row(s, "A").toolStatus).toBe("error");
    expect(row(s, "A").toolDetails?.status).not.toBe("stopped");
  });

  it("queue fields from a queued tick reach the subagent state", () => {
    const s = apply([
      start("A"),
      ev("tool_execution_update", {
        toolCallId: "A",
        toolName: "Agent",
        partialResult: { content: [], details: { agentId: "ag-1", status: "queued", queuePosition: 2, activeSlots: 1, maxConcurrent: 1, stoppable: true } },
      }),
    ]);
    expect(s.subagents.get("ag-1")).toMatchObject({ queuePosition: 2, activeSlots: 1, maxConcurrent: 1, stoppable: true });
    expect(row(s, "A").toolStatus).toBe("running");
  });
});
