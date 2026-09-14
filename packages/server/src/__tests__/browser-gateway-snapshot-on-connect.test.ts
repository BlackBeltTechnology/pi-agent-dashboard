/**
 * Regression suite for change: fix-stale-sessions-on-reconnect.
 *
 * Pin: on every browser WS connect, the gateway sends exactly one
 * `sessions_snapshot` message (windowed per fix-connect-snapshot-frame-loss)
 * and does NOT iterate per-session `session_added` or per-cwd
 * `sessions_reordered` for the bootstrap. Since fix-connect-snapshot-frame-loss
 * (D3) the snapshot is the LAST bootstrap frame — every other connect state
 * frame precedes it.
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLastBindReachability } from "../auth/bind-reachability-service.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMetaPersistence } from "../persistence/meta-persistence.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { createSessionArchive } from "../session/session-archive.js";
import type { SessionOrderManager } from "../session/session-order-manager.js";
import { makeFakeDirectoryService } from "./helpers/load-fixtures.js";

function makeFakeWs() {
  const ws = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    bufferedAmount: number;
    readyState: number;
    OPEN: number;
  };
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.terminate = vi.fn();
  ws.readyState = 1;
  ws.OPEN = 1;
  ws.bufferedAmount = 0;
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
    const stubOrders = makeStubOrderManager(orders);
    // The snapshot window reads persisted orders through the MANAGER's
    // collaborator (D4), so the stub is wired into both the manager and the
    // gateway. See change: fix-connect-snapshot-frame-loss.
    const managerWithOrders = createMemorySessionManager(undefined, stubOrders);
    managerWithOrders.restore(sessionManager.listAll()[0] as never);
    managerWithOrders.restore(sessionManager.listAll()[1] as never);

    const gateway = createBrowserGateway(
      managerWithOrders,
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
      undefined,
      undefined,
      stubOrders,
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

    const snap = snapshots[0] as { sessions: Array<{ id: string; status: string }>; orders: Record<string, string[]>; endedTotals: Record<string, number> };
    const ids = snap.sessions.map((s) => s.id).sort();
    expect(ids).toEqual(["alive-1", "ended-1"]); // alive AND windowed ended included
    expect(snap.orders).toEqual({ "/repo/a": ["alive-1"] }); // empty entry filtered out
    expect(snap.endedTotals).toEqual({ "/repo/a": 1 }); // ended counted per group
  });

  it("snapshot is the LAST bootstrap frame: pinned_dirs_updated and every other connect send precede it (D3)", () => {
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
    expect(pinnedIdx).toBeGreaterThanOrEqual(0);
    expect(pinnedIdx).toBeLessThan(snapshotIdx);
    // Nothing is sent after the snapshot in the same synchronous turn.
    expect(types.length).toBe(snapshotIdx + 1);
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

// ── Bootstrap frame ordering (D3, E10) — see change: fix-connect-snapshot-frame-loss ──
//
// Every small idempotent connect state frame (openspec, git heads, prefs,
// pinned, reachability, terminals) reaches the browser BEFORE the one large
// `sessions_snapshot`, and nothing follows the snapshot in the same turn —
// so a saturated socket queues the small frames ahead of the big one.
describe("browser-gateway on-connect bootstrap ordering (E10)", () => {
  function connectFull() {
    const gateway = createBrowserGateway(
      createMemorySessionManager(),
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
      undefined,
      undefined,
      makeStubOrderManager({}),
      {
        getPinnedDirectories: () => ["/pinned"],
        setPinnedDirectories: () => {},
        getFavoriteModels: () => ["anthropic/claude-sonnet-4-5"],
        getWorkspaces: () => [{ id: "w1", name: "Work", collapsed: false, folders: ["/pinned"] }],
        getDisplayPrefs: () => ({ tokenStatsBar: true }),
        getSessionOrder: () => ({}),
        setSessionOrder: () => {},
      } as never,
      (() => {
        // Fake with known cwds + the folder-HEAD accessor so both
        // `openspec_update` (3) and `git_head_update` join the bootstrap
        // inventory (the gateway guards the accessor with typeof).
        const svc = makeFakeDirectoryService({ knownDirectories: ["/a", "/b", "/c"] }).service as unknown as Record<string, unknown>;
        svc.folderHeadSnapshot = () => [{ cwd: "/a", branch: "develop" }];
        return svc as never;
      })(),
      { list: () => [{ id: "t1", cwd: "/a", title: "T1", createdAt: 1 }, { id: "t2", cwd: "/b", title: "T2", createdAt: 2 }] } as never,
    );
    // Folder-HEAD replay needs the accessor; the fake service above lacks it.
    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});
    return { ws, msgs: sentMessages(ws) };
  }

  it("all openspec/git/prefs/pinned/reachability/terminal frames precede the single sessions_snapshot; nothing follows", () => {
    const { ws, msgs } = connectFull();
    const types = msgs.map((m) => m.type as string);
    const snapshotIdx = types.lastIndexOf("sessions_snapshot");

    expect(types.filter((t) => t === "sessions_snapshot")).toHaveLength(1);
    expect(snapshotIdx).toBeGreaterThanOrEqual(0);

    // Expected bootstrap inventory — 3 known cwds, 2 terminals, pinned prefs.
    expect(types.filter((t) => t === "openspec_update")).toHaveLength(3);
    expect(types.filter((t) => t === "git_head_update")).toHaveLength(1);
    expect(types.filter((t) => t === "terminal_added")).toHaveLength(2);
    for (const t of ["pinned_dirs_updated", "display_prefs_updated", "favorite_models_updated", "workspaces_updated"]) {
      expect(types, `${t} present`).toContain(t);
    }
    if (getLastBindReachability() !== null) {
      expect(types).toContain("reachability_updated");
    }

    // EVERY non-snapshot bootstrap frame precedes the snapshot…
    for (let i = 0; i < types.length; i++) {
      if (i !== snapshotIdx) expect(i, `${types[i]} precedes snapshot`).toBeLessThan(snapshotIdx);
    }
    // …no registry frame anywhere in the bootstrap…
    for (const t of ["session_added", "session_updated", "sessions_reordered"]) {
      expect(types).not.toContain(t);
    }
    // …and nothing is sent after the snapshot in the same synchronous turn.
    expect(ws.send.mock.calls.length).toBe(snapshotIdx + 1);
  });
});

// ── E7: archived sessions are non-resident in the connect snapshot ──────────
//
// A session that was archived leaves the live set entirely; the browser learns
// about it only through the per-folder `archivedCountByCwd` count.
// See change: archive-sessions-lazy-load.
describe("browser-gateway on-connect snapshot excludes archived sessions (E7)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-archived-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Real sidecar on disk so `archiveSession` can perform its eager write. */
  function seedFile(id: string): string {
    const dir = path.join(tmpDir, "--repo-a--");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type: "session", id, cwd: "/repo/a" })}\n`);
    writeSessionMeta(file, { cwd: "/repo/a", status: "ended", startedAt: 1, endedAt: 2 });
    return file;
  }

  it("snapshot carries the 2 resident sessions and counts the archived one per folder", () => {
    const sessionManager = createMemorySessionManager();
    const archive = createSessionArchive({
      sessionManager,
      metaPersistence: createMetaPersistence(),
      getPinnedDirs: () => [],
    });

    sessionManager.restore({
      id: "active-1", cwd: "/repo/a", source: "tui", status: "active",
      startedAt: 1, hidden: false, dataUnavailable: false,
    } as never);
    sessionManager.restore({
      id: "ended-1", cwd: "/repo/a", source: "tui", status: "ended",
      startedAt: 2, endedAt: 3, hidden: false, dataUnavailable: true,
    } as never);
    sessionManager.restore({
      id: "archived-1", cwd: "/repo/a", source: "tui", status: "ended",
      startedAt: 4, endedAt: 5, hidden: false, dataUnavailable: true,
      sessionFile: seedFile("archived-1"),
    } as never);

    // Genuine transition: archiveSession evicts from the manager AND indexes.
    expect(archive.archiveSession("archived-1", "manual")).toMatchObject({ ok: true });

    const gateway = createBrowserGateway(
      sessionManager,
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
      undefined,
      undefined,
      makeStubOrderManager({ "/repo/a": ["active-1", "ended-1", "archived-1"] }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      archive,
    );

    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});

    const snap = sentMessages(ws).find((m) => m.type === "sessions_snapshot") as {
      sessions: Array<{ id: string }>;
      archivedCountByCwd: Record<string, number>;
    };

    expect(snap.sessions).toHaveLength(2);
    expect(snap.sessions.map((s) => s.id).sort()).toEqual(["active-1", "ended-1"]);
    expect(snap.archivedCountByCwd).toEqual({ "/repo/a": 1 });
  });
});
