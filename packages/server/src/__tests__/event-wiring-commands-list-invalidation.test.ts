/**
 * `commands_list` fans a pi-resources invalidation out with the reporting
 * session's cwd; an unknown session emits nothing (test-plan #X8).
 * Harness: the `wireEvents` stub from `event-wiring-name-provenance.test.ts`.
 * See change: add-skill-atlas-screen (design D5).
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
    start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: vi.fn(() => []),
    isSessionConnected: vi.fn(() => true), onEvent: vi.fn(),
  } as any;
  const browserGateway = createBrowserGateway(sessionManager, eventStore, piGateway);
  const directoryService = makeFakeDirectoryService().service as any;
  const notify = vi.fn();
  directoryService.notifyPiResourcesInvalidated = notify;
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
    directoryService,
    knownSessionIds: new Set<string>(),
    pendingDashboardSpawns: new Map<string, number>(),
    viewedSessionTracker: browserGateway.viewedSessionTracker,
  });
  const send = (sessionId: string, msg: Record<string, unknown>) => piGateway.onEvent!(sessionId, { sessionId, ...msg } as any);
  return { sessionManager, send, notify };
}

describe("X8: commands_list → pi-resources invalidation", () => {
  it("known session notifies with its cwd", () => {
    const r = makeRig();
    r.sessionManager.register({ id: "s1", cwd: "/repo", source: "cli", startedAt: 1 } as any);
    r.send("s1", { type: "commands_list", commands: [] });
    expect(r.notify).toHaveBeenCalledWith("/repo");
  });

  it("unknown session notifies nothing", () => {
    const r = makeRig();
    r.send("ghost", { type: "commands_list", commands: [] });
    expect(r.notify).not.toHaveBeenCalled();
  });
});
