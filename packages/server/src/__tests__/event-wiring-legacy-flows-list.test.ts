/**
 * An older bridge's `flows_list` message is ignored: no throw, nothing sent to
 * browsers, no sibling `request_flows_refresh`. The flow list is plugin-owned
 * (flows plugin catalog event). Harness: `event-wiring-commands-list-invalidation.test.ts`.
 * See change: flows-dock-chip-and-panel-actions (D8; test-plan E29).
 */
import { describe, expect, it, vi } from "vitest";
import { wireEvents } from "../event-wiring.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { makeFakeDirectoryService } from "./helpers/load-fixtures.js";

function makeRig() {
  const sessionManager = createMemorySessionManager();
  const eventStore = createMemoryEventStore(() => false);
  const piGateway = {
    start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: vi.fn(() => ["s1", "s2"]),
    isSessionConnected: vi.fn(() => true), onEvent: vi.fn(),
  } as any;
  const browserGateway = createBrowserGateway(sessionManager, eventStore, piGateway);
  const toSubscribers = vi.spyOn(browserGateway, "sendToSubscribers");
  const broadcast = vi.spyOn(browserGateway, "broadcast");
  wireEvents({
    sessionManager, eventStore, piGateway, browserGateway,
    sessionOrderManager: {
      insert: vi.fn(), remove: vi.fn(), getOrder: vi.fn(() => []), reorder: vi.fn(),
      getAllOrders: vi.fn(() => ({})), moveToFront: vi.fn(), rekey: vi.fn(),
    } as any,
    preferencesStore: {
      getPinnedDirectories: () => [], setPinnedDirectories: () => {}, getSessionOrder: () => ({}),
      setSessionOrder: () => {}, getAutoNameSessions: () => false,
    } as any,
    pendingForkRegistry: createPendingForkRegistry(),
    directoryService: makeFakeDirectoryService().service as any,
    knownSessionIds: new Set<string>(),
    pendingDashboardSpawns: new Map<string, number>(),
    viewedSessionTracker: browserGateway.viewedSessionTracker,
  });
  const send = (sessionId: string, msg: Record<string, unknown>) => piGateway.onEvent!(sessionId, { sessionId, ...msg } as any);
  return { sessionManager, piGateway, toSubscribers, broadcast, send };
}

describe("E29: legacy flows_list from an old bridge", () => {
  it("is ignored without error: no browser message, no request_flows_refresh", () => {
    const r = makeRig();
    r.sessionManager.register({ id: "s1", cwd: "/repo", source: "cli", startedAt: 1 } as any);
    r.sessionManager.register({ id: "s2", cwd: "/repo", source: "cli", startedAt: 1 } as any);
    r.toSubscribers.mockClear();
    r.broadcast.mockClear();
    r.piGateway.sendToSession.mockClear();
    expect(() => r.send("s1", { type: "flows_list", flows: [{ name: "batch:apply", description: "", taskRequired: false }] })).not.toThrow();
    const sentTypes = [...r.toSubscribers.mock.calls.map((c) => (c[1] as { type?: string })?.type), ...r.broadcast.mock.calls.map((c) => (c[0] as { type?: string })?.type)];
    expect(sentTypes).not.toContain("flows_list");
    expect(r.piGateway.sendToSession.mock.calls.map((c: unknown[]) => (c[1] as { type?: string })?.type)).not.toContain("request_flows_refresh");
  });
});
