/**
 * E24: decision table for the flows actions gate (`session-card-action-bar`
 * claim). Open iff a `flows` / `flows:*` command (not `flows:new` alone) OR any
 * flow event; closed before the first `commandsList` publish.
 * See change: add-session-actions-flyout (D12).
 */
import {
  clearSessionEvents,
  publishSessionData,
  publishSessionEvent,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import {
  __resetSessionDataStoreForTests,
} from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flowsActionsAvailable, hasFlowsCommand } from "../client/flowsActionsGate.js";
import { __resetFlowsAvailabilityForTests } from "../client/flowsAvailability.js";

const cmds = (...names: string[]) => names.map((name) => ({ name }));
/** The plugin `flow_catalog` event. See change: flows-dock-chip-and-panel-actions. */
const catalogEvent = (flows: Array<{ name: string }>) =>
  ({ eventType: "flow_catalog", timestamp: 1, data: { catalogKey: "catalog", flows } }) as never;

const COMMANDS: Array<{ label: string; list: string[] | null; signal: boolean }> = [
  { label: "none published", list: null, signal: false },
  { label: "[flows]", list: ["flows"], signal: true },
  { label: "[flows:delete]", list: ["flows:delete"], signal: true },
  { label: "[flows:new only]", list: ["flows:new"], signal: false },
];

describe("flowsActionsAvailable (E24)", () => {
  beforeEach(() => {
    __resetFlowsAvailabilityForTests();
    __resetSessionDataStoreForTests();
  });
  afterEach(() => {
    __resetFlowsAvailabilityForTests();
    __resetSessionDataStoreForTests();
  });

  let n = 0;
  for (const c of COMMANDS) {
    for (const events of [0, 1]) {
      for (const catalog of [[], [{ name: "f" }]]) {
        it(`commands ${c.label} × events ${events} × catalog ${catalog.length} → ${c.signal || events > 0 ? "open" : "closed"}`, () => {
          const sid = `e24-${++n}`;
          if (c.list) publishSessionData(sid, "commandsList", cmds(...c.list));
          publishSessionEvent(sid, catalogEvent(catalog));
          if (events) publishSessionEvent(sid, { eventType: "flow_started", timestamp: 1, data: {} } as never);
          expect(flowsActionsAvailable(sid)).toBe(c.signal || events > 0);
          clearSessionEvents(sid);
        });
      }
    }
  }

  it("flows:new alongside another flows:* command still counts", () => {
    expect(hasFlowsCommand(cmds("flows:new", "flows:delete") as never)).toBe(true);
  });

  it("a flow catalog alone never opens the gate (it is not flow activity)", () => {
    publishSessionEvent("e24-list-only", catalogEvent([{ name: "f" }]));
    expect(flowsActionsAvailable("e24-list-only")).toBe(false);
    clearSessionEvents("e24-list-only");
  });
});
