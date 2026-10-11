/**
 * Wiring of the live-only in-flight tool-call hint. Folded from test-plan
 * E6 and the route side of E1b.
 *
 * Harness: the `wireEvents` rig from `event-wiring-usage.test.ts`.
 * See change: distinguish-tool-result-pending-vs-gone (D2).
 */
import { describe, expect, it, vi } from "vitest";
import { wireEvents } from "../event-wiring.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createInFlightToolCalls } from "../session/in-flight-tool-calls.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { makeFakeDirectoryService } from "./helpers/load-fixtures.js";

function makeRig() {
  const sessionManager = createMemorySessionManager();
  const eventStore = createMemoryEventStore(() => false);
  const inFlightToolCalls = createInFlightToolCalls();
  const piGateway = {
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession: vi.fn(),
    getConnectedSessionIds: vi.fn(() => []),
    isSessionConnected: vi.fn(() => true),
    clearHostPressure: vi.fn(),
    onEvent: vi.fn(),
  } as any;
  const browserGateway = createBrowserGateway(sessionManager, eventStore, piGateway);
  wireEvents({
    sessionManager,
    eventStore,
    piGateway,
    browserGateway,
    inFlightToolCalls,
    sessionOrderManager: {
      insert: vi.fn(),
      remove: vi.fn(),
      getOrder: vi.fn(() => []),
      reorder: vi.fn(),
      getAllOrders: vi.fn(() => ({})),
      moveToFront: vi.fn(),
      rekey: vi.fn(),
    } as any,
    preferencesStore: {
      getPinnedDirectories: () => [],
      setPinnedDirectories: () => {},
      getSessionOrder: () => ({}),
      setSessionOrder: () => {},
      getAutoNameSessions: () => false,
    } as any,
    pendingForkRegistry: createPendingForkRegistry(),
    directoryService: makeFakeDirectoryService().service,
    knownSessionIds: new Set<string>(),
    pendingDashboardSpawns: new Map<string, number>(),
  });
  const send = (sessionId: string, msg: Record<string, unknown>) =>
    piGateway.onEvent!(sessionId, { sessionId, ...msg } as any);
  const event = (sessionId: string, eventType: string, data: Record<string, unknown> = {}) =>
    send(sessionId, { type: "event_forward", event: { eventType, timestamp: Date.now(), data } });
  const register = (sessionId: string) => {
    sessionManager.register({ id: sessionId, cwd: "/tmp/proj", source: "cli", startedAt: 1 } as any);
    send(sessionId, { type: "session_register", cwd: "/tmp/proj", source: "cli" });
  };
  return { sessionManager, eventStore, inFlightToolCalls, send, event, register };
}

describe("event-wiring: in-flight tool-call hint", () => {
  it("E6: a live start is observed; a register clears it; replayed events never feed it", () => {
    const { inFlightToolCalls: h, event, send, register } = makeRig();
    register("s");
    send("s", { type: "replay_complete" });

    event("s", "tool_execution_start", { toolCallId: "a", toolName: "bash" });
    expect(h.isInFlight("s", "a")).toBe(true);

    // Reconnect: the register clears, and the replay that follows is ignored.
    send("s", { type: "session_register", cwd: "/tmp/proj", source: "cli" });
    expect(h.isInFlight("s", "a")).toBe(false);
    event("s", "tool_execution_start", { toolCallId: "b", toolName: "bash" });
    event("s", "tool_execution_end", { toolCallId: "a" });
    event("s", "agent_settled");
    expect(h.isInFlight("s", "b")).toBe(false);

    // After replay_complete the stream is live again.
    send("s", { type: "replay_complete" });
    event("s", "tool_execution_start", { toolCallId: "c", toolName: "bash" });
    expect(h.isInFlight("s", "c")).toBe(true);
    event("s", "agent_settled");
    expect(h.isInFlight("s", "c")).toBe(false);
  });

  it("E6: session end clears the hint", () => {
    const { inFlightToolCalls: h, sessionManager, event, send, register } = makeRig();
    register("s");
    send("s", { type: "replay_complete" });
    event("s", "tool_execution_start", { toolCallId: "a", toolName: "bash" });
    expect(h.isInFlight("s", "a")).toBe(true);
    sessionManager.unregister("s");
    expect(h.isInFlight("s", "a")).toBe(false);
  });

  it("E6: session removal clears the hint", () => {
    const { inFlightToolCalls: h, sessionManager, event, send, register } = makeRig();
    register("s");
    send("s", { type: "replay_complete" });
    event("s", "tool_execution_start", { toolCallId: "a", toolName: "bash" });
    sessionManager.remove("s");
    expect(h.isInFlight("s", "a")).toBe(false);
  });

  it("E1b: a live top-level start forgets a recorded eviction; a nested one does not", () => {
    const { eventStore, event, send, register } = makeRig();
    const forget = vi.spyOn(eventStore, "forgetEvictedToolEnd");
    register("s");
    send("s", { type: "replay_complete" });
    event("s", "tool_execution_start", { toolCallId: "a", toolName: "bash" });
    expect(forget).toHaveBeenCalledWith("s", "a");
    forget.mockClear();
    event("s", "tool_execution_start", { toolCallId: "n", toolName: "bash", parentToolCallId: "a" });
    expect(forget).not.toHaveBeenCalled();
  });
});
