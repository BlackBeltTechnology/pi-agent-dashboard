/**
 * `wireEvents` seeds project defaults only for LOCAL session registrations: a
 * remote bridge's cwd names a path on another host.
 * See change: auto-seed-project-defaults.
 */
import { describe, expect, it, vi } from "vitest";

const scheduleProjectSeed = vi.hoisted(() => vi.fn());
vi.mock("../project-seed.js", async (orig) => ({
  ...(await orig<typeof import("../project-seed.js")>()),
  scheduleProjectSeed,
}));

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
  wireEvents({
    sessionManager, eventStore, piGateway, browserGateway,
    sessionOrderManager: {
      insert: vi.fn(), remove: vi.fn(), getOrder: vi.fn(() => []), reorder: vi.fn(),
      getAllOrders: vi.fn(() => ({})), moveToFront: vi.fn(), rekey: vi.fn(),
    } as any,
    preferencesStore: {
      getPinnedDirectories: () => [], setPinnedDirectories: () => {}, getSessionOrder: () => ({}),
      setSessionOrder: () => {}, getAutoNameSessions: () => false, getClaudeSubscriptionCompat: () => false,
    } as any,
    pendingForkRegistry: createPendingForkRegistry(),
    directoryService: makeFakeDirectoryService().service,
    knownSessionIds: new Set<string>(),
    pendingDashboardSpawns: new Map<string, number>(),
    viewedSessionTracker: browserGateway.viewedSessionTracker,
  });
  const send = (sessionId: string, msg: Record<string, unknown>) => piGateway.onEvent!(sessionId, { sessionId, ...msg } as any);
  const seed = (id: string, fields: Record<string, unknown> = {}) => {
    sessionManager.register({ id, cwd: "/tmp/proj", source: "cli", startedAt: 1 } as any);
    if (Object.keys(fields).length) sessionManager.update(id, fields as any);
  };
  const nameUpdate = (id: string, name: string, nameSource?: string) =>
    send(id, { type: "session_name_update", name, ...(nameSource ? { nameSource } : {}) });
  const restores = (id: string) =>
    piGateway.sendToSession.mock.calls.filter((c: any[]) => c[0] === id && c[1].type === "auto_name_state_restore").map((c: any[]) => c[1]);
  const register = (id: string) => piGateway.onSessionRegistered?.(id, "/tmp/proj");
  return { sessionManager, send, seed, nameUpdate, restores, register, piGateway };
}

describe("project seed on session registration", () => {
  it("seeds the cwd of a local session", () => {
    scheduleProjectSeed.mockClear();
    const r = makeRig();
    r.seed("local");
    r.register("local");
    expect(scheduleProjectSeed).toHaveBeenCalledWith("/tmp/proj");
  });

  it("never seeds the cwd of a remote session", () => {
    scheduleProjectSeed.mockClear();
    const r = makeRig();
    r.seed("remote", { originDeviceId: "device-1" });
    r.register("remote");
    expect(scheduleProjectSeed).not.toHaveBeenCalled();
  });
});
