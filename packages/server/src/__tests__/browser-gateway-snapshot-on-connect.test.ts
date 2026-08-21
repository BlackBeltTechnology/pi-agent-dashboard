/**
 * Regression suite for change: fix-stale-sessions-on-reconnect.
 *
 * Pin: on every browser WS connect, the gateway sends exactly one
 * `sessions_snapshot` message containing all sessions and all non-empty
 * per-cwd orders, AND it does NOT iterate per-session `session_added`
 * or per-cwd `sessions_reordered` for the bootstrap.
 */

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import type { SessionOrderManager } from "../session/session-order-manager.js";
import { makeFakeDirectoryService } from "./helpers/load-fixtures.js";

function makeFakeWs() {
  const ws = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
    OPEN: number;
  };
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.readyState = 1;
  ws.OPEN = 1;
  return ws;
}

function makeStubPiGateway(): PiGateway {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession: vi.fn(),
    getConnectedSessionIds: vi.fn(() => []),
    hasSession: vi.fn(() => false),
    onEvent: vi.fn(),
  } as unknown as PiGateway;
}

function makeStubOrderManager(orders: Record<string, string[]>): SessionOrderManager {
  return {
    insert: vi.fn(),
    remove: vi.fn(),
    getOrder: vi.fn((cwd: string) => orders[cwd] ?? []),
    reorder: vi.fn(),
    getAllOrders: vi.fn(() => orders),
    moveToFront: vi.fn(),
  } as unknown as SessionOrderManager;
}

function sentMessages(ws: ReturnType<typeof makeFakeWs>) {
  return ws.send.mock.calls
    .map((args) => {
      try { return JSON.parse(String(args[0])); } catch { return null; }
    })
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object");
}

describe("browser-gateway on-connect sessions_snapshot", () => {
  it("sends exactly one sessions_snapshot and no per-session session_added/sessions_reordered", () => {
    const sessionManager = createMemorySessionManager();
    sessionManager.restore({
      id: "alive-1",
      cwd: "/repo/a",
      source: "tui",
      status: "active",
      startedAt: 1,
      hidden: false,
      dataUnavailable: false,
    } as never);
    sessionManager.restore({
      id: "ended-1",
      cwd: "/repo/a",
      source: "tui",
      status: "ended",
      startedAt: 2,
      endedAt: 3,
      hidden: false,
      dataUnavailable: true,
    } as never);

    const orders: Record<string, string[]> = {
      "/repo/a": ["alive-1"],
      "/repo/empty": [], // should be filtered out of snapshot.orders
    };

    const gateway = createBrowserGateway(
      sessionManager,
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
      undefined,
      undefined,
      makeStubOrderManager(orders),
    );

    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});

    const msgs = sentMessages(ws);
    const snapshots = msgs.filter((m) => m.type === "sessions_snapshot");
    const sessionAddeds = msgs.filter((m) => m.type === "session_added");
    const sessionsReordereds = msgs.filter((m) => m.type === "sessions_reordered");

    expect(snapshots).toHaveLength(1);
    expect(sessionAddeds).toHaveLength(0);
    expect(sessionsReordereds).toHaveLength(0);

    const snap = snapshots[0] as { sessions: Array<{ id: string; status: string }>; orders: Record<string, string[]> };
    const ids = snap.sessions.map((s) => s.id).sort();
    expect(ids).toEqual(["alive-1", "ended-1"]); // alive AND ended both included
    expect(snap.orders).toEqual({ "/repo/a": ["alive-1"] }); // empty entry filtered out
  });

  it("snapshot is sent before pinned_dirs_updated and other on-connect sends", () => {
    const sessionManager = createMemorySessionManager();
    const gateway = createBrowserGateway(
      sessionManager,
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
      undefined,
      undefined,
      makeStubOrderManager({}),
      // Stub preferencesStore so pinned_dirs_updated fires.
      {
        getPinnedDirectories: () => [],
        setPinnedDirectories: () => {},
        getSessionOrder: () => ({}),
        setSessionOrder: () => {},
      } as never,
    );

    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});

    const types = sentMessages(ws).map((m) => m.type as string);
    const snapshotIdx = types.indexOf("sessions_snapshot");
    const pinnedIdx = types.indexOf("pinned_dirs_updated");
    expect(snapshotIdx).toBeGreaterThanOrEqual(0);
    expect(pinnedIdx).toBeGreaterThan(snapshotIdx);
  });
});

describe("browser-gateway on-connect display_prefs_updated snapshot", () => {
  // See change: fix-first-launch-display-modal-stuck-on-mobile.
  function connectWith(prefsStoreExtra: Record<string, unknown>) {
    const gateway = createBrowserGateway(
      createMemorySessionManager(),
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
      undefined,
      undefined,
      makeStubOrderManager({}),
      {
        getPinnedDirectories: () => [],
        setPinnedDirectories: () => {},
        getSessionOrder: () => ({}),
        setSessionOrder: () => {},
        ...prefsStoreExtra,
      } as never,
    );
    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});
    return sentMessages(ws);
  }

  it("sends display_prefs_updated when getDisplayPrefs returns defined prefs", () => {
    const prefs = { tokenStatsBar: true, contextUsageBar: false };
    const msgs = connectWith({ getDisplayPrefs: () => prefs });
    const snaps = msgs.filter((m) => m.type === "display_prefs_updated");
    expect(snaps).toHaveLength(1);
    expect((snaps[0] as { prefs: unknown }).prefs).toEqual(prefs);
  });

  it("sends NO display_prefs_updated for a seedless (undefined) store", () => {
    const msgs = connectWith({ getDisplayPrefs: () => undefined });
    expect(msgs.filter((m) => m.type === "display_prefs_updated")).toHaveLength(0);
  });

  it("does not crash the handshake when getDisplayPrefs is absent (old stub)", () => {
    const msgs = connectWith({});
    // Handshake still completes: pinned snapshot present, no display snapshot.
    expect(msgs.filter((m) => m.type === "pinned_dirs_updated")).toHaveLength(1);
    expect(msgs.filter((m) => m.type === "display_prefs_updated")).toHaveLength(0);
  });
});

// ── folder-HEAD connect snapshot (fix-folder-header-worktree-branch-leak) ────
//
// `git_head_update` is broadcast only on first-seen-or-change, so a browser
// connecting after the server cached a folder would otherwise NEVER learn that
// folder's HEAD — leaving the client's positional child fallback permanently
// load-bearing. The connect block replays the cached map to that one socket.
describe("browser-gateway on-connect folder-HEAD snapshot", () => {
  /** Minimal DirectoryService stub: openspec surface + the folder-HEAD accessor. */
  function dirServiceWith(
    snapshot: Array<{ cwd: string; branch: string | null }> | undefined,
  ) {
    const base = {
      knownDirectories: () => [],
      getOpenSpecData: () => undefined,
    } as Record<string, unknown>;
    // `undefined` models a hand-built fake that LACKS the accessor entirely.
    if (snapshot !== undefined) base.folderHeadSnapshot = () => snapshot;
    return base as never;
  }

  function connect(directoryService: never) {
    const gateway = createBrowserGateway(
      createMemorySessionManager(),
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
      undefined,
      undefined,
      makeStubOrderManager({}),
      {
        getPinnedDirectories: () => [],
        setPinnedDirectories: () => {},
        getSessionOrder: () => ({}),
        setSessionOrder: () => {},
      } as never,
      directoryService,
    );
    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});
    return { gateway, ws, msgs: sentMessages(ws) };
  }

  const heads = (msgs: Array<Record<string, unknown>>) =>
    msgs.filter((m) => m.type === "git_head_update");

  it("a fresh browser receives the cached folder heads (#E16)", () => {
    const { msgs } = connect(dirServiceWith([{ cwd: "/repo", branch: "develop" }]));
    expect(heads(msgs)).toEqual([{ type: "git_head_update", cwd: "/repo", branch: "develop" }]);
  });

  it("the snapshot is unicast and cache-pure (#E17)", () => {
    const cache = [{ cwd: "/repo", branch: "develop" as string | null }];
    const before = JSON.stringify(cache);
    const service = dirServiceWith(cache);

    const gateway = createBrowserGateway(
      createMemorySessionManager(),
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
      undefined,
      undefined,
      makeStubOrderManager({}),
      {
        getPinnedDirectories: () => [],
        setPinnedDirectories: () => {},
        getSessionOrder: () => ({}),
        setSessionOrder: () => {},
      } as never,
      service,
    );

    const wsA = makeFakeWs();
    gateway.wss.emit("connection", wsA, {});
    const beforeB = heads(sentMessages(wsA)).length;

    const wsB = makeFakeWs();
    gateway.wss.emit("connection", wsB, {});

    expect(heads(sentMessages(wsB))).toEqual([
      { type: "git_head_update", cwd: "/repo", branch: "develop" },
    ]);
    // A received NOTHING extra from B's connect — it is a unicast, not a fan-out.
    expect(heads(sentMessages(wsA))).toHaveLength(beforeB);
    // The server-side cache is byte-identical: the accessor is a pure read.
    expect(JSON.stringify(cache)).toBe(before);
  });

  it("connect before polling starts sends no entries (#E18)", () => {
    // `folderHeadPoll` is created lazily in `startPolling` → empty snapshot.
    const { msgs } = connect(dirServiceWith([]));
    expect(heads(msgs)).toHaveLength(0);
    expect(msgs.filter((m) => m.type === "sessions_snapshot")).toHaveLength(1);
  });

  it("a cached non-git folder is delivered as null (#E19)", () => {
    const { msgs } = connect(dirServiceWith([{ cwd: "/notgit", branch: null }]));
    expect(heads(msgs)).toEqual([{ type: "git_head_update", cwd: "/notgit", branch: null }]);
  });

  it("tolerates a DirectoryService fake without the accessor (#E21)", () => {
    // The REAL `makeFakeDirectoryService`: it casts a fixed field set through
    // `as unknown as DirectoryService`, so a `Pick<>` type is only a
    // compile-time claim about a runtime object that lacks the method — the
    // `typeof … === "function"` guard is what actually keeps this alive.
    const { msgs } = connect(makeFakeDirectoryService().service as never);
    expect(heads(msgs)).toHaveLength(0);
    expect(msgs.filter((m) => m.type === "sessions_snapshot")).toHaveLength(1);
    expect(msgs.filter((m) => m.type === "pinned_dirs_updated")).toHaveLength(1);
  });
});
