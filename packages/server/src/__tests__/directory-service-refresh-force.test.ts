/**
 * Force-refresh contract tests.
 *
 * Per `fix-openspec-mtime-gate-toctou`:
 *   - User-initiated refresh (`refreshOpenSpec`) MUST bypass the change-detection gate.
 *   - Periodic poll (`pollDirectoryGated`) MUST honor the gate.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import type { SessionManager } from "../memory-session-manager.js";
import type { PreferencesStore } from "../preferences-store.js";

vi.mock("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js")>();
  return {
    ...actual,
    pollOpenSpecAsync: vi.fn(async () => ({ initialized: false, changes: [] })),
    runOpenSpecList: vi.fn(async () => null),
    runOpenSpecStatus: vi.fn(async () => null),
  };
});

vi.mock("../pi-resource-scanner.js", () => ({
  scanPiResources: vi.fn(async () => ({ local: { extensions: [], skills: [], prompts: [] }, global: { extensions: [], skills: [], prompts: [] }, packages: [] })),
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/state-replay.js", () => ({
  replayEntriesAsEvents: vi.fn(() => []),
}));

vi.mock("../session-discovery.js", () => ({
  discoverSessionsForCwd: vi.fn(() => []),
}));

vi.mock("../session-file-reader.js", () => ({
  loadSessionEntries: vi.fn(() => []),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  SessionManager: {
    list: vi.fn(async () => []),
    open: vi.fn(() => ({ getBranch: vi.fn(() => []) })),
  },
}));

function createMockPreferencesStore(): PreferencesStore {
  return {
    getPinnedDirectories: () => [],
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

function createMockSessionManager(): SessionManager {
  return {
    register: vi.fn(),
    restore: vi.fn(),
    unregister: vi.fn(),
    update: vi.fn(),
    get: () => undefined,
    listActive: () => [],
    listAll: () => [],
  } as unknown as SessionManager;
}

describe("DirectoryService refresh-vs-gated contracts (fix-openspec-mtime-gate-toctou)", () => {
  let tmpDir: string;
  let cwd: string;
  let changesDir: string;
  let service: DirectoryService;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-refresh-"));
    cwd = tmpDir;
    changesDir = path.join(cwd, "openspec", "changes");
    fs.mkdirSync(path.join(changesDir, "change-a"), { recursive: true });
    fs.writeFileSync(path.join(changesDir, "change-a", "tasks.md"), "- [ ] 1.1 a\n");

    const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({ changes: [
      { name: "change-a", status: "in-progress", completedTasks: 0, totalTasks: 1 },
    ] });
    (runOpenSpecStatus as any).mockResolvedValue({
      artifacts: [
        { id: "proposal", status: "done" },
        { id: "design", status: "done" },
        { id: "specs", status: "done" },
        { id: "tasks", status: "done" },
      ],
      isComplete: true,
    });
  });

  afterEach(() => {
    service?.stopPolling();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("refreshOpenSpec re-spawns the CLI even when no file mtime changed", async () => {
    const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    service = createDirectoryService(createMockPreferencesStore(), createMockSessionManager());

    // Seed the cache.
    await service.pollDirectoryGated(cwd);
    (runOpenSpecList as any).mockClear();
    (runOpenSpecStatus as any).mockClear();

    // No file changed. User clicks refresh.
    await service.refreshOpenSpec(cwd);

    // Force-mode → both list and status spawn.
    expect(runOpenSpecList).toHaveBeenCalledTimes(1);
    expect(runOpenSpecStatus).toHaveBeenCalledTimes(1);
    expect((runOpenSpecStatus as any).mock.calls[0][1]).toBe("change-a");
  });

  it("onDirectoryAdded uses pollDirectoryGated, not the force-mode refreshOpenSpec (S1)", async () => {
    // After fix-openspec-mtime-gate-toctou, refreshOpenSpec bypasses the
    // gate (force=true). The internal `onDirectoryAdded` path must continue
    // to use the gated variant so re-pinning a directory whose cache is
    // already warm doesn't fan out into O(N) status spawns.
    const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    service = createDirectoryService(createMockPreferencesStore(), createMockSessionManager());

    // Seed the cache.
    await service.pollDirectoryGated(cwd);
    (runOpenSpecList as any).mockClear();
    (runOpenSpecStatus as any).mockClear();

    // Re-pin (simulated): no file mtime moved since the seed.
    await service.onDirectoryAdded(cwd);

    // Force path would have spawned 1 list + 1 status. Gated path does
    // neither because the file-aware effective mtime is unchanged.
    expect(runOpenSpecList).not.toHaveBeenCalled();
    expect(runOpenSpecStatus).not.toHaveBeenCalled();
  });

  it("pollDirectoryGated does NOT spawn the CLI when no file mtime changed (gate respected)", async () => {
    const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    service = createDirectoryService(createMockPreferencesStore(), createMockSessionManager());

    // Seed the cache.
    await service.pollDirectoryGated(cwd);
    (runOpenSpecList as any).mockClear();
    (runOpenSpecStatus as any).mockClear();

    // Periodic tick — no file change.
    await service.pollDirectoryGated(cwd);
    expect(runOpenSpecList).not.toHaveBeenCalled();
    expect(runOpenSpecStatus).not.toHaveBeenCalled();
  });
});
