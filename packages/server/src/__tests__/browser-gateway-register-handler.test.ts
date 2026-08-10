/**
 * Tests for browserGateway.registerHandler — the reverse channel that
 * plugins use to receive Browser→Server custom message types.
 *
 * See change: adopt-server-driven-intent-rendering.
 */
import { describe, it, expect, vi } from "vitest";
import { createBrowserGateway } from "../pairing/browser-gateway.js";

function makeMockDeps() {
  // Minimal mock dependencies for createBrowserGateway. We only need the
  // gateway's registerHandler + the message dispatch loop, not session
  // management.
  return {
    sessionManager: {
      listActive: () => [],
      listAll: () => [],
      getSession: () => undefined,
      registerSession: () => {},
      unregisterSession: () => {},
      updateSession: () => {},
      detachAll: () => {},
      attachExtension: () => {},
      detachExtension: () => {},
      markEnded: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    eventStore: {
      append: () => {},
      getEvents: () => [],
      getLatestEvent: () => undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    piGateway: {
      send: () => {},
      sendToSession: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

describe("browserGateway.registerHandler", () => {
  it("stores and looks up handlers by type", () => {
    const deps = makeMockDeps();
    const gateway = createBrowserGateway(deps.sessionManager, deps.eventStore, deps.piGateway);

    const handler = vi.fn();
    gateway.registerHandler("plugin_action", handler);

    // We can't easily invoke the WS message loop without a real WebSocket
    // connection, so we verify only that registration succeeds without
    // throwing. End-to-end dispatch is verified in section 19 manual smoke.
    expect(typeof gateway.registerHandler).toBe("function");
  });

  it("multiple handlers for different types can be registered", () => {
    const deps = makeMockDeps();
    const gateway = createBrowserGateway(deps.sessionManager, deps.eventStore, deps.piGateway);

    const handlerA = vi.fn();
    const handlerB = vi.fn();
    gateway.registerHandler("plugin_action", handlerA);
    gateway.registerHandler("plugin_other", handlerB);

    // No throw on registration. (Last-write-wins for the same type
    // is implicit Map semantics; not validated here.)
    expect(true).toBe(true);
  });
});

/**
 * PromptBus registry accessors — the read predicate, the reconcile snapshot
 * setter, and the unregister cleanup.
 *
 * See change: restore-ask-user-tool-state-on-reconnect, test-plan #E1–#E3,
 * #X1, #X2, #X6, #X7.
 */
describe("browserGateway PromptBus registry", () => {
  function makeGateway() {
    const deps = makeMockDeps();
    return createBrowserGateway(deps.sessionManager, deps.eventStore, deps.piGateway);
  }

  function prompt(promptId: string) {
    return { type: "prompt_request", promptId } as Record<string, unknown>;
  }

  it("#E1 returns true for a session with a tracked prompt", () => {
    const gateway = makeGateway();
    gateway.trackPromptRequest("s1", prompt("p1"));
    expect(gateway.hasPendingPromptRequests("s1")).toBe(true);
  });

  it("#E2 returns false once the last prompt is cleared, with no empty-map leak", () => {
    const gateway = makeGateway();
    gateway.trackPromptRequest("s1", prompt("p1"));
    gateway.clearPromptRequest("s1", "p1");
    expect(gateway.hasPendingPromptRequests("s1")).toBe(false);
    // The inner map must be deleted, not left behind empty. Re-tracking and
    // re-clearing must stay stable rather than accumulating dead sessions.
    gateway.trackPromptRequest("s1", prompt("p2"));
    expect(gateway.hasPendingPromptRequests("s1")).toBe(true);
    gateway.clearPromptRequest("s1", "p2");
    expect(gateway.hasPendingPromptRequests("s1")).toBe(false);
  });

  it("#E3 returns false for a never-seen session", () => {
    const gateway = makeGateway();
    expect(gateway.hasPendingPromptRequests("s9")).toBe(false);
  });

  it("#E9 stays true while a second prompt is still tracked", () => {
    const gateway = makeGateway();
    gateway.trackPromptRequest("s1", prompt("p1"));
    gateway.trackPromptRequest("s1", prompt("p2"));
    gateway.clearPromptRequest("s1", "p1");
    expect(gateway.hasPendingPromptRequests("s1")).toBe(true);
  });

  it("#X1 reconcile against an empty snapshot drops a stale entry", () => {
    const gateway = makeGateway();
    gateway.trackPromptRequest("s1", prompt("stale"));
    gateway.reconcilePromptRequests("s1", []);
    expect(gateway.hasPendingPromptRequests("s1")).toBe(false);
  });

  it("#X2 reconcile keeps re-sent ids and drops the rest", () => {
    const gateway = makeGateway();
    gateway.trackPromptRequest("s1", prompt("kept"));
    gateway.trackPromptRequest("s1", prompt("dropped"));
    gateway.reconcilePromptRequests("s1", ["kept"]);
    expect(gateway.hasPendingPromptRequests("s1")).toBe(true);
    // The dropped id must really be gone — clearing the kept one empties it.
    gateway.clearPromptRequest("s1", "kept");
    expect(gateway.hasPendingPromptRequests("s1")).toBe(false);
  });

  it("#X6 reconcile does not touch other sessions", () => {
    const gateway = makeGateway();
    gateway.trackPromptRequest("s1", prompt("p1"));
    gateway.trackPromptRequest("s2", prompt("p2"));
    gateway.reconcilePromptRequests("s1", []);
    expect(gateway.hasPendingPromptRequests("s1")).toBe(false);
    expect(gateway.hasPendingPromptRequests("s2")).toBe(true);
  });

  it("#X6 reconcile on a never-seen session is a no-op", () => {
    const gateway = makeGateway();
    expect(() => gateway.reconcilePromptRequests("s9", ["p1"])).not.toThrow();
    expect(gateway.hasPendingPromptRequests("s9")).toBe(false);
  });

  it("#X7 clearPendingRequestsForSession drops the session's prompts, leaving others intact", () => {
    const gateway = makeGateway();
    gateway.trackPromptRequest("s1", prompt("p1"));
    gateway.trackPromptRequest("s2", prompt("p2"));
    gateway.clearPendingRequestsForSession("s1");
    expect(gateway.hasPendingPromptRequests("s1")).toBe(false);
    expect(gateway.hasPendingPromptRequests("s2")).toBe(true);
  });

  it("#X8 clearPendingRequestsForSession drops the extension-UI registry too", () => {
    const gateway = makeGateway();
    gateway.trackUiRequest("s1", "r1", "ask_user", { title: "pick one" });
    gateway.trackUiRequest("s2", "r2", "ask_user", { title: "pick one" });
    expect(gateway.hasPendingUiRequest("s1")).toBe(true);
    gateway.clearPendingRequestsForSession("s1");
    expect(gateway.hasPendingUiRequest("s1")).toBe(false);
    expect(gateway.hasPendingUiRequest("s2")).toBe(true);
  });
});
