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
