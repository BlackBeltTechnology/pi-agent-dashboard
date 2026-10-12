/**
 * Concurrent ask_user prompts: the reducer must never drop a prompt whose
 * `requestId` is new, even when two prompts share a title (the `update_roles`
 * case). Only a same-id re-send (reconnect replay) is suppressed.
 *
 * Covers test-plan U1–U5.
 *
 * See change: surface-concurrent-ask-user-prompts.
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import {
  addInteractiveRequest,
  createInitialState,
  dismissInteractiveRequest,
  reduceEvent,
  resolveInteractiveRequest,
  type SessionState,
} from "../lib/chat/event-reducer.js";
import { derivePendingFreeFloating } from "../lib/chat/pending-free-floating.js";

function confirm(state: SessionState, id: string, title: string, message: string): SessionState {
  return addInteractiveRequest(state, id, "confirm", { title, message });
}

describe("addInteractiveRequest — concurrent ask_user dedup", () => {
  it("U1 two concurrent confirms sharing a title both surface", () => {
    let s = createInitialState();
    s = confirm(s, "p1", "Update global roles?", "Set role A");
    s = confirm(s, "p2", "Update global roles?", "Set role B");

    expect(s.interactiveRequests.map((r) => r.requestId)).toEqual(["p1", "p2"]);
    expect(s.interactiveRequests.every((r) => r.status === "pending")).toBe(true);
    expect(s.messages.filter((m) => m.id === "ui-p1")).toHaveLength(1);
    expect(s.messages.filter((m) => m.id === "ui-p2")).toHaveLength(1);
  });

  it("U2 two byte-identical concurrent confirms both surface", () => {
    let s = createInitialState();
    s = confirm(s, "p1", "Update global roles?", "Set role A");
    s = confirm(s, "p2", "Update global roles?", "Set role A");

    expect(s.interactiveRequests.map((r) => r.requestId)).toEqual(["p1", "p2"]);
    expect(s.interactiveRequests.every((r) => r.status === "pending")).toBe(true);
  });

  it("U3 same-id re-send is suppressed", () => {
    let s = createInitialState();
    s = confirm(s, "p1", "Update global roles?", "Set role A");
    const after = confirm(s, "p1", "Update global roles?", "Set role A");

    expect(after).toBe(s);
    expect(after.interactiveRequests.filter((r) => r.requestId === "p1")).toHaveLength(1);
    expect(after.messages.filter((m) => m.id === "ui-p1")).toHaveLength(1);
  });

  it("U4 answering one leaves the other pending", () => {
    let s = createInitialState();
    s = confirm(s, "p1", "Update global roles?", "Set role A");
    s = confirm(s, "p2", "Update global roles?", "Set role B");
    s = resolveInteractiveRequest(s, "p1", true);

    const p1 = s.interactiveRequests.find((r) => r.requestId === "p1")!;
    const p2 = s.interactiveRequests.find((r) => r.requestId === "p2")!;
    expect(p1.status).toBe("resolved");
    expect(p2.status).toBe("pending");
  });

  it("R-reconnect replay of the pending burst yields no duplicate rows or panel cards", () => {
    let s = createInitialState();
    s = confirm(s, "p1", "Update global roles?", "Set role A");
    s = confirm(s, "p2", "Update global roles?", "Set role B");
    // Reconnect replay re-sends the SAME ids.
    s = confirm(s, "p1", "Update global roles?", "Set role A");
    s = confirm(s, "p2", "Update global roles?", "Set role B");

    expect(s.interactiveRequests.map((r) => r.requestId)).toEqual(["p1", "p2"]);
    expect(s.messages.filter((m) => m.id === "ui-p1")).toHaveLength(1);
    expect(s.messages.filter((m) => m.id === "ui-p2")).toHaveLength(1);
    // Panel derives one card per pending id — no duplication.
    expect(derivePendingFreeFloating(s.messages, s.interactiveRequests).map((r) => r.requestId)).toEqual([
      "p1",
      "p2",
    ]);
  });

  it("U5 cancelling one does not cancel the other", () => {
    let s = createInitialState();
    s = confirm(s, "p1", "Update global roles?", "Set role A");
    s = confirm(s, "p2", "Update global roles?", "Set role B");
    s = dismissInteractiveRequest(s, "p1");

    const p1 = s.interactiveRequests.find((r) => r.requestId === "p1")!;
    const p2 = s.interactiveRequests.find((r) => r.requestId === "p2")!;
    expect(p1.status).toBe("dismissed");
    expect(p2.status).toBe("pending");
  });
});

/**
 * Tool row duration prefers pi's recorded execution time (pi >= 1.1.0
 * `durationMs` on `tool_execution_end`), falling back to timestamps.
 * Covers test-plan E5–E8. See change: update-pi-core-1-1-adopt-apis.
 */
describe("tool_execution_end — recorded durationMs", () => {
  const evt = (eventType: string, data: Record<string, unknown>, ts: number): DashboardEvent =>
    ({ eventType, timestamp: ts, data }) as DashboardEvent;
  const start = (ts = 1000) => evt("tool_execution_start", { toolCallId: "call_1", toolName: "bash", args: {} }, ts);
  const end = (extra: Record<string, unknown> = {}, ts = 5000) =>
    evt("tool_execution_end", { toolCallId: "call_1", toolName: "bash", result: "ok", isError: false, ...extra }, ts);
  const row = (s: SessionState) => s.messages.find((m) => m.toolCallId === "call_1");
  const run = (...events: DashboardEvent[]) => events.reduce((s, e) => reduceEvent(s, e), createInitialState());

  it("E5 recorded duration wins over the timestamp difference", () => {
    expect(row(run(start(), end({ durationMs: 1200 })))?.duration).toBe(1200);
  });

  it("E6 falls back to timestamps when durationMs is absent", () => {
    expect(row(run(start(), end()))?.duration).toBe(4000);
  });

  it("E7 invalid durationMs (negative, string, null, NaN) is ignored", () => {
    for (const bad of [-5, "1200", null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(row(run(start(), end({ durationMs: bad })))?.duration, String(bad)).toBe(4000);
    }
  });

  it("E5b a recorded zero is a valid duration", () => {
    expect(row(run(start(), end({ durationMs: 0 })))?.duration).toBe(0);
  });

  it("E8 a nested end keeps its live span and leaves the root duration alone", () => {
    const nStart = evt("tool_execution_start", { toolCallId: "call_1/1", toolName: "bash", args: {}, parentToolCallId: "call_1" }, 2000);
    const nEnd = evt("tool_execution_end", { toolCallId: "call_1/1", toolName: "bash", parentToolCallId: "call_1", result: "x", isError: false, durationMs: 50 }, 2300);
    const s = run(start(), nStart, nEnd);
    expect(row(s)?.nested?.find((e) => e.id === "call_1/1")?.durationMs).not.toBe(50);
    expect(row(s)?.duration).toBeUndefined(); // root still running
    expect(row(run(start(), nStart, nEnd, end({ durationMs: 1200 })))?.duration).toBe(1200);
  });
});

/** pi 1.1.0 `agent_settled.aborted` is forwarded but ignored (test-plan #E18). */
describe("agent_settled — aborted flag is ignored", () => {
  it("E18 resolves the same status for aborted:true and aborted:false", () => {
    const settle = (aborted: boolean) =>
      reduceEvent(
        reduceEvent(createInitialState(), { eventType: "agent_start", timestamp: 1, data: {} } as DashboardEvent),
        { eventType: "agent_settled", timestamp: 2, data: { type: "agent_settled", aborted } } as DashboardEvent,
      );
    const a = settle(true);
    const b = settle(false);
    expect(a.status).toBe("idle");
    expect(a.isStreaming).toBe(false);
    expect({ status: a.status, isStreaming: a.isStreaming, retryState: a.retryState, lastError: a.lastError }).toEqual({
      status: b.status,
      isStreaming: b.isStreaming,
      retryState: b.retryState,
      lastError: b.lastError,
    });
  });
});
