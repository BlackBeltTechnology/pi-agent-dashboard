/**
 * `wireEvents` wiring of name provenance: the bridge `session_name_update` guard
 * (E10/E11/X6) and the register-time `auto_name_state_restore` (E17).
 * Harness: the `wireEvents` dependency stub from `event-wiring-push.test.ts`.
 * See change: investigate-auto-name-provenance-relabel.
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

describe("E10: session_name_update guard through wireEvents", () => {
  it("user claim on the witness keeps provenance; a different name latches user and clears the witness", () => {
    const r = makeRig();
    r.seed("s1", { name: "W", nameSource: "system", nameSourceFor: "W" });
    r.nameUpdate("s1", "W", "user");
    expect(r.sessionManager.get("s1")).toMatchObject({ name: "W", nameSource: "system", nameSourceFor: "W" });
    r.nameUpdate("s1", "X", "user");
    const s = r.sessionManager.get("s1")!;
    expect(s).toMatchObject({ name: "X", nameSource: "user" });
    expect(s.nameSourceFor).toBeUndefined();
  });
  it("an auto claim while system/user is dropped entirely (name and provenance)", () => {
    const r = makeRig();
    r.seed("s1", { name: "add-x", nameSource: "system", nameSourceFor: "add-x" });
    r.nameUpdate("s1", "Auto Title", "auto");
    expect(r.sessionManager.get("s1")).toMatchObject({ name: "add-x", nameSource: "system", nameSourceFor: "add-x" });
    r.seed("s2", { name: "mine", nameSource: "user" });
    r.nameUpdate("s2", "Auto Title", "auto");
    expect(r.sessionManager.get("s2")).toMatchObject({ name: "mine", nameSource: "user" });
  });
  it("an auto claim on an unnamed / auto session is applied with a witness", () => {
    const r = makeRig();
    r.seed("s1");
    r.nameUpdate("s1", "Fix login", "auto");
    expect(r.sessionManager.get("s1")).toMatchObject({ name: "Fix login", nameSource: "auto", nameSourceFor: "Fix login" });
  });
});

describe("E11 / X6: provenance survives plain names and the old-bridge echo", () => {
  it("E11: plain name then the user claim for the same name keeps auto + witness", () => {
    const r = makeRig();
    r.seed("s1", { name: "Fix login", nameSource: "auto", nameSourceFor: "Fix login" });
    r.nameUpdate("s1", "Fix login");
    r.nameUpdate("s1", "Fix login", "user");
    expect(r.sessionManager.get("s1")).toMatchObject({ nameSource: "auto", nameSourceFor: "Fix login" });
  });
  it("X6: old bridge echoing a system name as user keeps system", () => {
    const r = makeRig();
    r.seed("s1", { name: "add-x", nameSource: "system", nameSourceFor: "add-x" });
    r.nameUpdate("s1", "add-x", "user");
    expect(r.sessionManager.get("s1")?.nameSource).toBe("system");
  });
});

describe("E17: register-time restore", () => {
  const stop = (extra: object = {}) => ({
    hardStopped: true, errorEmitted: false, attemptsUsed: 0, starvedCount: 0, waitingCount: 0, sawStarved: false, hasAutoName: false, ...extra,
  });
  it("no state and no provenance → no restore", () => {
    const r = makeRig();
    r.seed("s1");
    r.register("s1");
    expect(r.restores("s1")).toHaveLength(0);
  });
  it("system without state → restore system + witness", () => {
    const r = makeRig();
    r.seed("s1", { nameSource: "system", nameSourceFor: "add-x" });
    r.register("s1");
    expect(r.restores("s1")[0]).toMatchObject({ nameSource: "system", nameSourceFor: "add-x" });
  });
  it("auto with a persisted user-latched cause-less stop → restore auto, hardStopped:false", () => {
    const r = makeRig();
    r.seed("s1", { nameSource: "auto", nameSourceFor: "A", autoNamerState: stop({ nameSource: "user" }) });
    r.register("s1");
    const m = r.restores("s1")[0];
    expect(m.nameSource).toBe("auto");
    expect(m.state.hardStopped).toBe(false);
  });
  it("user + stopped → restore user, hardStopped:true", () => {
    const r = makeRig();
    r.seed("s1", { nameSource: "user", autoNamerState: stop() });
    r.register("s1");
    const m = r.restores("s1")[0];
    expect(m.nameSource).toBe("user");
    expect(m.state.hardStopped).toBe(true);
  });
});
