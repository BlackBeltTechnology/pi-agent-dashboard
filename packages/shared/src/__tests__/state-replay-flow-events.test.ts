/**
 * Replay of persisted flow-run events (change: replay-persisted-flow-runs).
 * pi-flows writes type:"custom" customType:"flow-event" entries with shape
 * { seq, eventType, data, flowRunId }. Replay re-forwards each as an
 * event_forward carrying eventType + data verbatim, ordered by seq, so the
 * client's idempotent reduceFlowEvent rebuilds the flow card on reload.
 */
import { describe, it, expect } from "vitest";
import { replayEntriesAsEvents } from "../state-replay.js";

function flowEventEntry(
  id: string,
  seq: number,
  eventType: string,
  data: Record<string, unknown>,
  flowRunId = "run-1",
) {
  return {
    type: "custom",
    customType: "flow-event",
    id,
    parentId: "root",
    timestamp: "2026-04-27T07:26:25.000Z",
    data: { seq, eventType, data, flowRunId },
  };
}

describe("replayEntriesAsEvents — persisted flow events", () => {
  it("re-forwards flow-event entries in seq order with data verbatim", () => {
    const entries = [
      flowEventEntry("f0", 0, "flow_started", { flowName: "demo" }),
      flowEventEntry("f1", 1, "flow_agent_started", { agentName: "researcher", stepId: "research" }),
      flowEventEntry("f2", 2, "flow_tool_call", { agentName: "researcher", toolName: "read", input: { path: "a.ts" } }),
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    const flows = events.filter((e) => e.event.eventType.startsWith("flow_"));

    expect(flows.map((e) => e.event.eventType)).toEqual([
      "flow_started",
      "flow_agent_started",
      "flow_tool_call",
    ]);
    expect((flows[0].event.data as any).flowName).toBe("demo");
    expect((flows[2].event.data as any).toolName).toBe("read");
  });

  it("sorts emitted flow events by ascending seq even when file order differs", () => {
    const entries = [
      flowEventEntry("f2", 2, "flow_tool_call", { agentName: "a", toolName: "bash" }),
      flowEventEntry("f0", 0, "flow_started", { flowName: "demo" }),
      flowEventEntry("f1", 1, "flow_agent_started", { agentName: "a", stepId: "s" }),
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    const flows = events.filter((e) => e.event.eventType.startsWith("flow_"));

    expect(flows.map((e) => e.event.eventType)).toEqual([
      "flow_started",
      "flow_agent_started",
      "flow_tool_call",
    ]);
  });

  it("ignores custom entries whose customType is not flow-event", () => {
    const entries = [
      { type: "custom", customType: "other-thing", id: "x", timestamp: "2026-04-27T07:26:25.000Z", data: { seq: 0, eventType: "flow_started", data: {} } },
    ];
    const events = replayEntriesAsEvents("sess-1", entries);
    expect(events.filter((e) => e.event.eventType.startsWith("flow_"))).toHaveLength(0);
  });

  it("skips malformed flow-event records (missing/non-string eventType) without throwing", () => {
    const entries = [
      { type: "custom", customType: "flow-event", id: "b1", timestamp: "2026-04-27T07:26:25.000Z", data: { seq: 0, data: {} } },
      { type: "custom", customType: "flow-event", id: "b2", timestamp: "2026-04-27T07:26:25.000Z", data: { seq: 1, eventType: 42, data: {} } },
      flowEventEntry("f2", 2, "flow_complete", { status: "success" }),
    ];

    let events: ReturnType<typeof replayEntriesAsEvents> = [];
    expect(() => { events = replayEntriesAsEvents("sess-1", entries); }).not.toThrow();
    const flows = events.filter((e) => e.event.eventType.startsWith("flow_"));
    expect(flows.map((e) => e.event.eventType)).toEqual(["flow_complete"]);
  });

  it("leaves message and model_change replay unaffected when interleaved with flow events", () => {
    const entries = [
      { type: "message", id: "u1", timestamp: "2026-04-27T07:26:25.000Z", message: { role: "user", content: [{ type: "text", text: "go" }] } },
      flowEventEntry("f0", 0, "flow_started", { flowName: "demo" }),
      { type: "model_change", id: "m1", timestamp: "2026-04-27T07:26:26.000Z", provider: "anthropic", modelId: "claude" },
      { type: "message", id: "a1", parentId: "u1", timestamp: "2026-04-27T07:26:30.000Z", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    expect(events.find((e) => e.event.eventType === "message_start")).toBeDefined();
    expect(events.find((e) => e.event.eventType === "message_end")).toBeDefined();
    expect(events.find((e) => e.event.eventType === "model_select")).toBeDefined();
    expect(events.find((e) => e.event.eventType === "flow_started")).toBeDefined();
  });
});
