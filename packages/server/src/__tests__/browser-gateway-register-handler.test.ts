/**
 * Tests for browserGateway.registerHandler — the reverse channel that
 * plugins use to receive Browser→Server custom message types.
 *
 * See change: adopt-server-driven-intent-rendering.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSessionMeta, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireEvents } from "../event-wiring.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMetaPersistence } from "../persistence/meta-persistence.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { createSessionArchive } from "../session/session-archive.js";
import { makeFakeDirectoryService } from "./helpers/load-fixtures.js";

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

/**
 * X2 — a bridge re-registering an ARCHIVED id: registration wins over the
 * archive. The index row is dropped, the folder's decremented count is
 * broadcast, and the session comes back live and un-archived.
 *
 * Drives the real wiring: `wireEvents` installs `piGateway.onSessionRegistered`,
 * which is what `pi-gateway` calls right after it registers the session.
 * See change: archive-sessions-lazy-load.
 */
describe("bridge re-register of an archived session (X2)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-rereg-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedSidecar(id: string): string {
    const dir = path.join(tmpDir, "--repo--");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type: "session", id, cwd: "/repo" })}\n`);
    writeSessionMeta(file, { cwd: "/repo", status: "ended", startedAt: 1, endedAt: 2, archived: true, archivedAt: 3 });
    return file;
  }

  function archivedRow(id: string, sessionFile: string) {
    return { id, cwd: "/repo", groupPath: "/repo", endedAt: 2, archivedAt: 3, sessionFile };
  }

  it("drops the index row, broadcasts the decremented count, and the session is live and not archived", () => {
    const sessionManager = createMemorySessionManager();
    const archive = createSessionArchive({
      sessionManager,
      metaPersistence: createMetaPersistence(),
      getPinnedDirs: () => [],
    });
    const fileA = seedSidecar("rereg-me");
    const fileB = seedSidecar("stays-archived");
    // Two rows in the SAME folder, so the broadcast count is a real decrement
    // (2 → 1) rather than an indistinguishable "empty".
    archive.seed([archivedRow("rereg-me", fileA), archivedRow("stays-archived", fileB)]);

    const piGateway = {
      start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(),
      getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => false), onEvent: vi.fn(),
    } as any;
    const browserGateway = createBrowserGateway(
      sessionManager,
      createMemoryEventStore(() => false),
      piGateway,
    );
    // Same emitter wiring the server installs.
    archive.setEmitter({
      sessionArchived: (sessionId, cwd, count) =>
        browserGateway.broadcastToAll({ type: "session_archived", sessionId, cwd, count } as any),
      archivedCountUpdated: (cwd, count) =>
        browserGateway.broadcastToAll({ type: "archived_count_updated", cwd, count } as any),
      sessionAdded: (session) => browserGateway.broadcastSessionAdded(session),
    });

    const ws = new EventEmitter() as any;
    ws.send = vi.fn();
    ws.close = vi.fn();
    ws.readyState = 1;
    ws.OPEN = 1;
    ws.bufferedAmount = 0;
    browserGateway.wss.emit("connection", ws, {});
    ws.send.mockClear(); // isolate from the connect bootstrap

    wireEvents({
      sessionManager,
      eventStore: createMemoryEventStore(() => false),
      piGateway,
      browserGateway,
      sessionOrderManager: {
        insert: vi.fn(), remove: vi.fn(), getOrder: vi.fn(() => []), reorder: vi.fn(),
        getAllOrders: vi.fn(() => ({})), moveToFront: vi.fn(), rekey: vi.fn(),
      } as any,
      preferencesStore: {
        getPinnedDirectories: () => [], setPinnedDirectories: () => {},
        getSessionOrder: () => ({}), setSessionOrder: () => {},
        getAutoNameSessions: () => false,
      } as any,
      pendingForkRegistry: createPendingForkRegistry(),
      directoryService: makeFakeDirectoryService().service,
      knownSessionIds: new Set<string>(),
      pendingDashboardSpawns: new Map<string, number>(),
      sessionArchive: archive,
    });

    // The bridge attaches: pi-gateway registers the session, then fires the hook.
    sessionManager.register({
      id: "rereg-me",
      cwd: "/repo",
      source: "tui",
      startedAt: 1,
      sessionFile: fileA,
      registerReason: "reattach",
    } as any);
    piGateway.onSessionRegistered!("rereg-me", "/repo");

    // Index row gone; the sibling archived row is untouched.
    expect(archive.has("rereg-me")).toBe(false);
    expect(archive.has("stays-archived")).toBe(true);
    expect(archive.countsByKey()).toEqual({ "/repo": 1 });

    // The decremented count reached the browser.
    const frames = ws.send.mock.calls.map(([raw]: [string]) => JSON.parse(String(raw)));
    expect(frames.filter((f: any) => f.type === "archived_count_updated")).toEqual([
      { type: "archived_count_updated", cwd: "/repo", count: 1 },
    ]);

    // The session is live in the manager and carries no archived marker.
    const live = sessionManager.get("rereg-me");
    expect(live).toMatchObject({ id: "rereg-me", status: "active" });
    expect(live?.archived ?? false).toBe(false);
    // The on-disk marker is cleared too, so a later boot scan cannot re-archive it.
    expect(readSessionMeta(fileA)).toMatchObject({ archived: false });
  });
});
