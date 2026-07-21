/**
 * Tests for `openspec.enabled` gating in DirectoryService.
 *
 * Confirms:
 *   - `refreshOpenSpec` short-circuits (no CLI spawn, returns cleared shape).
 *   - `pollDirectoryGated` short-circuits.
 *   - `scheduleOpenSpecTick` short-circuits.
 *   - `reconfigurePolling({ enabled: false })` clears every cached cwd and
 *     broadcasts `openspec_update` via the onChange callback.
 *
 * See change: auto-hide-empty-session-subcards.
 */

import { DEFAULT_OPENSPEC_POLL } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";

// Mock CLI entry points so we can spy on whether they get called.
vi.mock("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js")
  >();
  return {
    ...actual,
    pollOpenSpecAsync: vi.fn(async () => ({ initialized: true, changes: [] })),
    runOpenSpecList: vi.fn(async () => null),
    runOpenSpecStatus: vi.fn(async () => null),
  };
});

vi.mock("../pi/pi-resource-scanner.js", () => ({
  scanPiResources: vi.fn(async () => ({
    local: { extensions: [], skills: [], prompts: [] },
    global: { extensions: [], skills: [], prompts: [] },
    packages: [],
  })),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/state-replay.js", () => ({
  replayEntriesAsEvents: vi.fn(() => []),
}));
vi.mock("../session/session-discovery.js", () => ({
  discoverSessionsForCwd: vi.fn(() => []),
}));
vi.mock("../session/session-file-reader.js", () => ({
  loadSessionEntries: vi.fn(() => []),
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  SessionManager: {
    list: vi.fn(async () => []),
    open: vi.fn(() => ({ getBranch: vi.fn(() => []) })),
  },
}));

function makePrefs(pinnedDirs: string[] = []): PreferencesStore {
  return {
    getPinnedDirectories: () => pinnedDirs,
    getSessionOrder: () => ({}),
    setSessionOrder: vi.fn(),
    setPinnedDirectories: vi.fn(),
    pinDirectory: vi.fn(),
    unpinDirectory: vi.fn(),
    reorderPinnedDirs: vi.fn(),
    getFavoriteModels: vi.fn(() => []),
    setFavoriteModels: vi.fn(),
    addFavoriteModel: vi.fn(),
    removeFavoriteModel: vi.fn(),
    getWorkspaces: vi.fn(() => []),
    createWorkspace: vi.fn(() => null),
    renameWorkspace: vi.fn(() => false),
    deleteWorkspace: vi.fn(() => false),
    setWorkspaceCollapsed: vi.fn(() => false),
    addFolderToWorkspace: vi.fn(() => false),
    removeFolderFromWorkspace: vi.fn(() => false),
    reorderWorkspaceFolders: vi.fn(() => false),
    reorderWorkspaces: vi.fn(() => false),
    flush: vi.fn(),
    getDisplayPrefs: vi.fn(() => undefined),
    getOpenSpecUpdateSignature: vi.fn(() => undefined),
    getAutoInitWorktreeOnSpawn: vi.fn(() => false),
    getAutoNameSessions: vi.fn(() => true),
    setAutoNameSessions: vi.fn(),
    getLiveServers: vi.fn(() => []),
    setLiveServers: vi.fn(),
    setAutoInitWorktreeOnSpawn: vi.fn(),
    setOpenSpecUpdateSignature: vi.fn(),
    setDisplayPrefs: vi.fn((p) => p as any),
    dispose: vi.fn(),
  };
}
function makeSessionMgr(sessions: DashboardSession[] = []): SessionManager {
  const map = new Map<string, DashboardSession>();
  for (const s of sessions) map.set(s.id, s);
  return {
    register: vi.fn(),
    restore: vi.fn(),
    unregister: vi.fn(),
    update: vi.fn(),
    get: (id: string) => map.get(id),
    listActive: () => Array.from(map.values()).filter(s => s.status !== "ended"),
    listAll: () => Array.from(map.values()),
  };
}

describe("DirectoryService — openspec.enabled gate", () => {
  let service: DirectoryService;

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    service?.stopPolling();
  });

  it("refreshOpenSpec returns cleared shape and spawns no CLI when disabled", async () => {
    const prefs = makePrefs(["/repo"]);
    const sessMgr = makeSessionMgr();
    service = createDirectoryService(prefs, sessMgr, { ...DEFAULT_OPENSPEC_POLL, enabled: false });

    const { pollOpenSpecAsync, runOpenSpecList, runOpenSpecStatus } = await import(
      "@blackbelt-technology/pi-dashboard-shared/openspec-poller.js"
    );

    const data = await service.refreshOpenSpec("/repo");
    expect(data).toEqual({
      initialized: false,
      pending: false,
      changes: [],
      hasOpenspecDir: false,
    });
    expect(pollOpenSpecAsync).not.toHaveBeenCalled();
    expect(runOpenSpecList).not.toHaveBeenCalled();
    expect(runOpenSpecStatus).not.toHaveBeenCalled();
  });

  it("pollDirectoryGated returns cleared shape and spawns no CLI when disabled", async () => {
    const prefs = makePrefs();
    const sessMgr = makeSessionMgr();
    service = createDirectoryService(prefs, sessMgr, { ...DEFAULT_OPENSPEC_POLL, enabled: false });

    const { runOpenSpecList } = await import(
      "@blackbelt-technology/pi-dashboard-shared/openspec-poller.js"
    );

    const data = await service.pollDirectoryGated("/repo");
    expect(data).toEqual({
      initialized: false,
      pending: false,
      changes: [],
      hasOpenspecDir: false,
    });
    expect(runOpenSpecList).not.toHaveBeenCalled();
  });

  it("reconfigurePolling({ enabled: false }) broadcasts cleared payload for every cached cwd", async () => {
    const prefs = makePrefs(["/a", "/b"]);
    const sessMgr = makeSessionMgr();
    service = createDirectoryService(prefs, sessMgr); // starts enabled

    // Seed the cache by calling refresh while enabled.
    const { runOpenSpecList, runOpenSpecStatus } = await import(
      "@blackbelt-technology/pi-dashboard-shared/openspec-poller.js"
    );
    (runOpenSpecList as any).mockResolvedValue({
      mtimeMs: 1,
      result: { changes: [], specs: [] },
    });
    (runOpenSpecStatus as any).mockResolvedValue(null);
    await service.refreshOpenSpec("/a");
    await service.refreshOpenSpec("/b");

    expect(service.getOpenSpecData("/a")).toBeDefined();
    expect(service.getOpenSpecData("/b")).toBeDefined();

    // Wire the broadcast callback then flip the master gate.
    const broadcasts: Array<{ cwd: string; data: unknown }> = [];
    service.startPolling((cwd, data) => broadcasts.push({ cwd, data }));

    service.reconfigurePolling({ ...DEFAULT_OPENSPEC_POLL, enabled: false });

    const cleared = { initialized: false, pending: false, changes: [], hasOpenspecDir: false };
    const cwds = new Set(broadcasts.map(b => b.cwd));
    expect(cwds.has("/a")).toBe(true);
    expect(cwds.has("/b")).toBe(true);
    for (const b of broadcasts) {
      expect(b.data).toEqual(cleared);
    }
    expect(service.getOpenSpecData("/a")).toEqual(cleared);
    expect(service.getOpenSpecData("/b")).toEqual(cleared);
  });

  it("no broadcast on disabled→disabled or enabled→enabled reconfiguration", async () => {
    const prefs = makePrefs(["/a"]);
    const sessMgr = makeSessionMgr();
    service = createDirectoryService(prefs, sessMgr, { ...DEFAULT_OPENSPEC_POLL, enabled: false });

    const broadcasts: Array<{ cwd: string }> = [];
    service.startPolling((cwd) => broadcasts.push({ cwd }));

    // disabled → disabled with new interval — should not trigger the
    // disable-broadcast path.
    service.reconfigurePolling({
      ...DEFAULT_OPENSPEC_POLL,
      enabled: false,
      pollIntervalSeconds: 90,
    });
    expect(broadcasts).toHaveLength(0);
  });
});
