/**
 * Regression: when the OpenSpec change watcher fires, the resulting
 * `pollOne(cwd, false)` call MUST still respect the mtime-gate so that
 * duplicate fs.watch events (which Node emits commonly on macOS) do not
 * fan out into multiple `openspec status` CLI spawns.
 *
 * See change: fix-openspec-taskcheck-delay.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import type { OpenSpecChangeWatcher } from "../openspec/openspec-change-watcher.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// Mock the shared openspec poller — we want to count CLI spawns.
const runOpenSpecListMock = vi.fn();
const runOpenSpecStatusMock = vi.fn();
vi.mock("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js")>();
  return {
    ...actual,
    pollOpenSpecAsync: vi.fn(async () => ({ initialized: false, changes: [] })),
    runOpenSpecList: (...args: any[]) => runOpenSpecListMock(...args),
    runOpenSpecStatus: (...args: any[]) => runOpenSpecStatusMock(...args),
  };
});

vi.mock("../pi/pi-resource-scanner.js", () => ({
  scanPiResources: vi.fn(async () => ({ local: { extensions: [], skills: [], prompts: [] }, global: { extensions: [], skills: [], prompts: [] }, packages: [] })),
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/state-replay.js", () => ({
  replayEntriesAsEvents: vi.fn(() => []),
}));

vi.mock("../session/session-discovery.js", () => ({
  discoverSessionsForCwd: vi.fn(() => []),
}));

function createMockPrefs(pinned: string[]): PreferencesStore {
  return {
    getPinnedDirectories: () => pinned,
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
    dispose: vi.fn(),
  } as unknown as PreferencesStore;
}

function createMockSessions(): SessionManager {
  return {
    register: vi.fn(),
    restore: vi.fn(),
    unregister: vi.fn(),
    update: vi.fn(),
    get: () => undefined,
    listActive: () => [],
    listAll: () => [] as DashboardSession[],
  } as unknown as SessionManager;
}

/**
 * Stub watcher that exposes a `fire(cwd)` method so tests can simulate
 * fs.watch events without touching the real filesystem.
 */
function createStubWatcher(): OpenSpecChangeWatcher & { fire(cwd: string): void; onChange?: (cwd: string) => void } {
  let onChangeCb: ((cwd: string) => void) | undefined;
  const attached = new Set<string>();
  return {
    attach: (cwd) => { const had = attached.has(cwd); attached.add(cwd); return !had; },
    detach: (cwd) => { attached.delete(cwd); },
    detachAll: () => { attached.clear(); },
    size: () => attached.size,
    // Test hook
    fire: (cwd) => onChangeCb?.(cwd),
    set onChange(cb: (cwd: string) => void) { onChangeCb = cb; },
  };
}

describe("DirectoryService + watcher dedup", () => {
  let service: DirectoryService;
  let tmpCwd: string;

  beforeEach(() => {
    runOpenSpecListMock.mockReset();
    runOpenSpecStatusMock.mockReset();
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "ds-watcher-dedup-"));
    fs.mkdirSync(path.join(tmpCwd, "openspec", "changes", "demo"), { recursive: true });
    fs.writeFileSync(path.join(tmpCwd, "openspec", "changes", "demo", "tasks.md"), "## Tasks\n- [ ] one\n");
  });

  afterEach(() => {
    service?.stopPolling();
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  it("two back-to-back watcher fires without mtime change cause at most one openspec list spawn (status never spawned)", async () => {
    // First call returns a single demo change; status returns a stub.
    runOpenSpecListMock.mockResolvedValue({
      changes: [{ name: "demo", status: "active", completedTasks: 0, totalTasks: 1 }],
    });
    runOpenSpecStatusMock.mockResolvedValue({
      name: "demo",
      status: "active",
      artifacts: [],
      completedTasks: 0,
      totalTasks: 1,
    });

    const prefs = createMockPrefs([tmpCwd]);
    const sessions = createMockSessions();
    service = createDirectoryService(prefs, sessions);

    // Prime the cache with one real poll (no gate skip yet — cache empty).
    await service.pollDirectoryGated(tmpCwd);
    const statusAfterFirst = runOpenSpecStatusMock.mock.calls.length;
    const listAfterFirst = runOpenSpecListMock.mock.calls.length;
    expect(listAfterFirst).toBeGreaterThanOrEqual(1);
    // New contract (optimize-openspec-poll-derive-artifacts-locally): the gated
    // path derives artifact status locally and never spawns `openspec status`.
    expect(statusAfterFirst).toBe(0);

    // Now simulate two watcher fires back-to-back without modifying tasks.md.
    // The mtime-gate should swallow both — no additional list spawns.
    await service.pollDirectoryGated(tmpCwd);
    await service.pollDirectoryGated(tmpCwd);

    expect(runOpenSpecListMock.mock.calls.length).toBe(listAfterFirst);
    expect(runOpenSpecStatusMock.mock.calls.length).toBe(statusAfterFirst);
  });

  it("attaches watcher on onDirectoryAdded and detaches on stopPolling", async () => {
    runOpenSpecListMock.mockResolvedValue({ changes: [] });
    const prefs = createMockPrefs([]);
    const sessions = createMockSessions();
    const stub = createStubWatcher();
    service = createDirectoryService(prefs, sessions, undefined, { changeWatcher: stub });

    await service.onDirectoryAdded(tmpCwd);
    expect(stub.size()).toBe(1);

    service.stopPolling();
    expect(stub.size()).toBe(0);
  });
});
