/**
 * Unit tests for `shouldRenderFlowsSubcard`, the manifest-level visibility gate
 * for the `session-card-flows` claim. The FLOWS subcard carries status only, so
 * the gate is "the session has any flow event" — the flow catalog and edit mode no
 * longer matter (they gate the flow actions, see flows-actions-gate.test.ts).
 * See change: fix-empty-flows-subcard, add-session-actions-flyout (E25).
 */

import { clearSessionEvents, initPluginConfigs, publishSessionData, publishSessionEvent } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import {
  __resetSessionDataStoreForTests,
} from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetFlowsAvailabilityForTests, sessionHasFlowEvents } from "../client/flowsAvailability.js";
import { shouldRenderFlowsSubcard } from "../client/shouldRender.js";

const session = (id: string) => ({ id }) as never;
const setEditMode = (on: boolean) => initPluginConfigs({ flows: { editFlow: on } });
/** The plugin `flow_catalog` event (session metadata, never flow activity). */
const catalogEvent = (flows: Array<{ name: string }>) =>
  ({ eventType: "flow_catalog", timestamp: 1, data: { catalogKey: "catalog", flows } }) as never;

describe("flows-plugin: shouldRenderFlowsSubcard predicate", () => {
  beforeEach(() => {
    __resetFlowsAvailabilityForTests();
    __resetSessionDataStoreForTests();
    setEditMode(false);
  });

  afterEach(() => {
    __resetFlowsAvailabilityForTests();
    __resetSessionDataStoreForTests();
    setEditMode(false);
  });

  it("returns false for null/undefined session", () => {
    expect(shouldRenderFlowsSubcard(null)).toBe(false);
    expect(shouldRenderFlowsSubcard(undefined)).toBe(false);
  });

  it("hidden in the bug state: empty catalog + edit mode off + no flow events", () => {
    const sid = "bug-state";
    publishSessionEvent(sid, catalogEvent([]));
    // Extension present (a /flows command exists) must NOT open the gate anymore.
    publishSessionData(sid, "commandsList", [{ name: "flows" }]);
    expect(shouldRenderFlowsSubcard(session(sid))).toBe(false);
  });

  it("E25: true iff a flow event exists, irrespective of editFlow × catalog", () => {
    let n = 0;
    for (const edit of [false, true]) {
      for (const list of [[], [{ name: "deploy" }]]) {
        for (const withEvent of [false, true]) {
          const sid = `e25-${++n}`;
          setEditMode(edit);
          publishSessionEvent(sid, catalogEvent(list));
          if (withEvent) {
            publishSessionEvent(sid, { eventType: "flow_started", timestamp: 1, data: {} } as never);
          }
          expect(shouldRenderFlowsSubcard(session(sid))).toBe(withEvent);
          clearSessionEvents(sid);
        }
      }
    }
  });

  it("visible when a flow event exists (running/completed, zero listed flows)", () => {
    const sid = "flow-ran";
    publishSessionEvent(sid, catalogEvent([]));
    expect(shouldRenderFlowsSubcard(session(sid))).toBe(false);
    publishSessionEvent(sid, { eventType: "flow_started", timestamp: 1, data: {} } as never);
    expect(shouldRenderFlowsSubcard(session(sid))).toBe(true);
    clearSessionEvents(sid);
  });

  it("sessionHasFlowEvents ignores non-flow events, reflects flow events", () => {
    const sid = "flow-evt";
    expect(sessionHasFlowEvents(sid)).toBe(false);
    publishSessionEvent(sid, { eventType: "message_start", timestamp: 1, data: {} } as never);
    expect(sessionHasFlowEvents(sid)).toBe(false);
    publishSessionEvent(sid, { eventType: "flow_started", timestamp: 2, data: {} } as never);
    expect(sessionHasFlowEvents(sid)).toBe(true);
    clearSessionEvents(sid);
  });
});
