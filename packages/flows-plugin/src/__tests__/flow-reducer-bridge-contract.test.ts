/**
 * L2 contract-pinned bridge-forward + reducer coverage.
 *
 * The dashboard bridge forwards pi-flows `flow:*` events to the dashboard
 * protocol via `FLOW_EVENT_MAP` (packages/extension/src/flow-event-wiring.ts);
 * the flows-plugin reducer consumes the mapped `flow_*` types. This test PINS
 * the reducer to that map: event types are read from `FLOW_EVENT_MAP` VALUES
 * (never hand-typed literals), so a pi-flows rename that updates the map
 * propagates here, and a reducer that stops handling a core lifecycle event
 * fails loudly.
 *
 * Hermetic by design (design D2): no browser, no network, no runtime
 * dependency on pi-flows. Real-engine event fidelity is covered at L3 (the
 * Docker harness), where pi-flows is genuinely installed.
 */

import type { DashboardEvent, FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
// Relative import into the extension package source: vitest maps the `.js`
// specifier to the `.ts` source. This is the CONTRACT PIN — the same map the
// bridge forwards through at runtime.
import { FLOW_EVENT_MAP } from "../../../extension/src/flow-event-wiring.js";
import { reduceFlowEvent } from "../reducer.js";

function ev(type: string, data: Record<string, unknown>): DashboardEvent {
  return { seq: 1, timestamp: 0, sessionId: "s1", eventType: type, data } as unknown as DashboardEvent;
}

// Event types resolved FROM the map (pin). If pi-flows renames an event and the
// bridge map updates, these follow automatically.
const T_STARTED = FLOW_EVENT_MAP["flow:flow-started"];
const T_AGENT_STARTED = FLOW_EVENT_MAP["flow:agent-started"];
const T_AGENT_COMPLETE = FLOW_EVENT_MAP["flow:agent-complete"];
const T_COMPLETE = FLOW_EVENT_MAP["flow:complete"];

describe("flow reducer × bridge FLOW_EVENT_MAP contract", () => {
  it("the map exposes the core lifecycle event types", () => {
    expect(T_STARTED).toBe("flow_started");
    expect(T_AGENT_STARTED).toBe("flow_agent_started");
    expect(T_AGENT_COMPLETE).toBe("flow_agent_complete");
    expect(T_COMPLETE).toBe("flow_complete");
  });

  it("a contract-pinned lifecycle reduces to a terminal flow + agent state", () => {
    let s: FlowState | null = null;
    s = reduceFlowEvent(s, ev(T_STARTED, {
      flowName: "contract",
      task: "t",
      steps: [{ id: "s1", stepType: "agent", agent: "a1", blockedBy: [] }],
    }));
    expect(s?.status).toBe("running");
    s = reduceFlowEvent(s, ev(T_AGENT_STARTED, { agentName: "a1", stepId: "s1" }));
    s = reduceFlowEvent(s, ev(T_AGENT_COMPLETE, {
      agentName: "a1",
      stepId: "s1",
      result: { success: true, status: "complete", tokens: { input: 1, output: 1 } },
    }));
    expect(s?.agents.get("s1")?.status).toBe("complete");
    s = reduceFlowEvent(s, ev(T_COMPLETE, { status: "success" }));
    expect(s?.status).toBe("success");
  });

  it("the reducer never throws on ANY mapped flow_* value (default passthrough)", () => {
    // Seed a state so post-start cases have something to fold into.
    const seeded = reduceFlowEvent(null, ev(T_STARTED, {
      flowName: "f",
      task: "t",
      steps: [{ id: "s1", stepType: "agent", agent: "a1", blockedBy: [] }],
    }));
    for (const mappedType of Object.values(FLOW_EVENT_MAP)) {
      expect(() => reduceFlowEvent(seeded, ev(mappedType, {}))).not.toThrow();
    }
  });

  it("a mapped event without a dedicated case leaves state unchanged", () => {
    const seeded = reduceFlowEvent(null, ev(T_STARTED, {
      flowName: "f",
      task: "t",
      steps: [{ id: "s1", stepType: "agent", agent: "a1", blockedBy: [] }],
    }));
    // flow_summary_started is mapped but intentionally has no reducer case.
    const passthrough = FLOW_EVENT_MAP["flow:summary-started"];
    expect(passthrough).toBe("flow_summary_started");
    expect(reduceFlowEvent(seeded, ev(passthrough, {}))).toBe(seeded);
  });

  it("each core lifecycle event produces an observable mutation (no silent drop)", () => {
    const started = reduceFlowEvent(null, ev(T_STARTED, {
      flowName: "f",
      task: "t",
      steps: [{ id: "s1", stepType: "agent", agent: "a1", blockedBy: [] }],
    }));
    expect(started).not.toBeNull(); // flow_started seeds

    const agentStarted = reduceFlowEvent(started, ev(T_AGENT_STARTED, { agentName: "a1", stepId: "s1" }));
    expect(agentStarted).not.toBe(started); // new state object

    const agentComplete = reduceFlowEvent(agentStarted, ev(T_AGENT_COMPLETE, {
      agentName: "a1",
      stepId: "s1",
      result: { success: true, status: "complete" },
    }));
    expect(agentComplete?.agents.get("s1")?.status).toBe("complete");

    const complete = reduceFlowEvent(agentComplete, ev(T_COMPLETE, { status: "success" }));
    expect(complete?.status).toBe("success");
  });
});
