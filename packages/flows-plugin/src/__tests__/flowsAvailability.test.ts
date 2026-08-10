/**
 * Unit tests for `shouldRenderFlowsSubcard`, the manifest-level visibility gate
 * for the `session-card-flows` claim. The gate reads live per-session-data
 * (`flowsList`) + plugin config (`editFlow`) + flow events — the same sources
 * `SessionFlowActionsClaim` uses to decide it renders content. See change:
 * fix-empty-flows-subcard.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetSessionDataStoreForTests,
  clearSessionEvents,
  publishSessionData,
  publishSessionEvent,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { initPluginConfigs } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { __resetFlowsAvailabilityForTests, sessionHasFlowEvents } from "../client/flowsAvailability.js";
import { shouldRenderFlowsSubcard } from "../client/shouldRender.js";

const session = (id: string) => ({ id }) as never;
const setEditMode = (on: boolean) => initPluginConfigs({ flows: { editFlow: on } });

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

  it("hidden in the bug state: flowsList empty + edit mode off + no flow events", () => {
    const sid = "bug-state";
    publishSessionData(sid, "flowsList", []);
    // Extension present (a /flows command exists) must NOT open the gate anymore.
    publishSessionData(sid, "commandsList", [{ name: "flows" }]);
    expect(shouldRenderFlowsSubcard(session(sid))).toBe(false);
  });

  it("visible when flowsList is non-empty", () => {
    const sid = "has-flows";
    publishSessionData(sid, "flowsList", [{ name: "deploy" }]);
    expect(shouldRenderFlowsSubcard(session(sid))).toBe(true);
  });

  it("visible when edit mode is on (author-first, zero flows)", () => {
    const sid = "edit-mode";
    publishSessionData(sid, "flowsList", []);
    setEditMode(true);
    expect(shouldRenderFlowsSubcard(session(sid))).toBe(true);
  });

  it("visible when a flow event exists (running/completed, zero listed flows)", () => {
    const sid = "flow-ran";
    publishSessionData(sid, "flowsList", []);
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
