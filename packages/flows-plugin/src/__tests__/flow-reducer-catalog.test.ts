/**
 * The flows reducer consumes `flow_catalog`: latest wins (replay order kept),
 * never touches flow progress state, never throws.
 * See change: flows-dock-chip-and-panel-actions (test-plan E8, X7).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { reduceFlowsSessionState } from "../client/FlowsSessionStateContext.js";
import { reduceFlowEvent } from "../reducer.js";
import { stateStore } from "../server/state-store.js";

let seq = 0;
const ev = (eventType: string, data: Record<string, unknown>, ts = ++seq): DashboardEvent =>
  ({ seq: ++seq, timestamp: ts, eventType, data }) as unknown as DashboardEvent;
const catalog = (...names: string[]) =>
  ev("flow_catalog", { catalogKey: "catalog", flows: names.map((name) => ({ name, description: "", source: "", taskRequired: false })) });

describe("flow_catalog in the flows reducer", () => {
  it("E8: latest catalog wins across replay; flow progress is unaffected", () => {
    const events = [
      catalog("A"),
      ev("flow_started", { flowName: "f", task: "", steps: [{ id: "s", stepType: "agent", agent: "a", blockedBy: [] }] }),
      catalog("B"),
    ];
    const withCatalog = reduceFlowsSessionState(events);
    const withoutCatalog = reduceFlowsSessionState([events[1]]);
    expect(withCatalog.catalog?.map((f) => f.name)).toEqual(["B"]);
    // Same flow state as if no catalog event were in the stream: nothing renders for it.
    expect(withCatalog.flowState?.flowName).toBe("f");
    expect(withCatalog.flowStates.size).toBe(withoutCatalog.flowStates.size);
    expect([...withCatalog.flowStates.keys()]).toEqual([...withoutCatalog.flowStates.keys()]);
  });

  it("catalog unknown until seen; an empty catalog is known", () => {
    expect(reduceFlowsSessionState([]).catalog).toBeUndefined();
    expect(reduceFlowsSessionState([catalog()]).catalog).toEqual([]);
  });

  it("a catalog alone produces no flow state", () => {
    const s = reduceFlowsSessionState([catalog("x")]);
    expect(s.flowState).toBeNull();
    expect(s.flowStates.size).toBe(0);
  });

  it("X7: malformed / unexpected catalog payloads never throw and never create a flow", () => {
    const bad = [
      ev("flow_catalog", {}),
      ev("flow_catalog", { flows: "nope" }),
      ev("flow_catalog", { flows: [null, 7, { description: "no name" }] }),
    ];
    expect(() => reduceFlowsSessionState(bad)).not.toThrow();
    const s = reduceFlowsSessionState(bad);
    expect(s.flowState).toBeNull();
    expect(s.catalog).toEqual([]);
    // The raw flow reducer and the server store pass it through unchanged.
    expect(reduceFlowEvent(null, bad[0])).toBeNull();
    stateStore.__resetForTests();
    stateStore.applyEvent("S", catalog("x"));
    expect(stateStore.getState("S")?.flowState ?? null).toBeNull();
  });
});
