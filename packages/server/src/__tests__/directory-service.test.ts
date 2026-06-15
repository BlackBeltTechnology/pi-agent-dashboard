/**
 * Tests for DirectoryService - server-side directory-scoped operations.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import type { PreferencesStore } from "../preferences-store.js";
import type { SessionManager } from "../memory-session-manager.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// Mock the shared openspec poller. We expose three entry points now:
//   - pollOpenSpecAsync: legacy monolithic (still used as fallback where no mtime gate applies)
//   - runOpenSpecList:   new granular list call
//   - runOpenSpecStatus: new granular status call
vi.mock("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js")>();
  return {
    ...actual,
    pollOpenSpecAsync: vi.fn(async () => ({ initialized: false, changes: [] })),
    runOpenSpecList: vi.fn(async () => null),
    runOpenSpecStatus: vi.fn(async () => null),
  };
});

// Mock pi-resource-scanner so polling ticks don't hit the filesystem.
vi.mock("../pi-resource-scanner.js", () => ({
  scanPiResources: vi.fn(async () => ({ local: { extensions: [], skills: [], prompts: [] }, global: { extensions: [], skills: [], prompts: [] }, packages: [] })),
}));

// Mock the shared state replay
vi.mock("@blackbelt-technology/pi-dashboard-shared/state-replay.js", () => ({
  replayEntriesAsEvents: vi.fn(() => []),
}));

// Mock session-discovery
vi.mock("../session-discovery.js", () => ({
  discoverSessionsForCwd: vi.fn(() => []),
}));

// Mock session-file-reader
vi.mock("../session-file-reader.js", () => ({
  loadSessionEntries: vi.fn(() => []),
}));

// Mock the pi-coding-agent SessionManager (legacy, kept for compatibility)
vi.mock("@earendil-works/pi-coding-agent", () => ({
  SessionManager: {
    list: vi.fn(async () => []),
    open: vi.fn(() => ({
      getBranch: vi.fn(() => []),
    })),
  },
}));

function createMockPreferencesStore(pinnedDirs: string[] = []): PreferencesStore {
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
    setOpenSpecUpdateSignature: vi.fn(),
    setDisplayPrefs: vi.fn((p) => p as any),
    dispose: vi.fn(),
  };
}

function createMockSessionManager(sessions: DashboardSession[] = []): SessionManager {
  const map = new Map<string, DashboardSession>();
  for (const s of sessions) map.set(s.id, s);
  return {
    register: vi.fn((params) => {
      const session = { ...params, status: "active", startedAt: Date.now() } as DashboardSession;
      map.set(params.id, session);
      return session;
    }),
    restore: vi.fn(),
    unregister: vi.fn((id) => {
      const s = map.get(id);
      if (s) { s.status = "ended"; s.endedAt = Date.now(); }
    }),
    update: vi.fn(),
    get: (id) => map.get(id),
    listActive: () => Array.from(map.values()).filter((s) => s.status !== "ended"),
    listAll: () => Array.from(map.values()),
  };
}

describe("DirectoryService", () => {
  let service: DirectoryService;

  afterEach(() => {
    service?.stopPolling();
  });

  describe("knownDirectories", () => {
    it("returns union of pinned dirs and session cwds", () => {
      const stateStore = createMockPreferencesStore(["/pinned/a", "/pinned/b"]);
      const sessionManager = createMockSessionManager([
        { id: "s1", cwd: "/pinned/a", source: "tui", status: "active", startedAt: 1 } as DashboardSession,
        { id: "s2", cwd: "/project/c", source: "tui", status: "active", startedAt: 2 } as DashboardSession,
      ]);
      service = createDirectoryService(stateStore, sessionManager);

      const dirs = service.knownDirectories();
      expect(dirs).toContain("/pinned/a");
      expect(dirs).toContain("/pinned/b");
      expect(dirs).toContain("/project/c");
      expect(dirs.length).toBe(3);
    });

    it("deduplicates directories", () => {
      const stateStore = createMockPreferencesStore(["/same/dir"]);
      const sessionManager = createMockSessionManager([
        { id: "s1", cwd: "/same/dir", source: "tui", status: "active", startedAt: 1 } as DashboardSession,
      ]);
      service = createDirectoryService(stateStore, sessionManager);

      const dirs = service.knownDirectories();
      expect(dirs.filter((d) => d === "/same/dir").length).toBe(1);
    });
  });

  describe("discoverSessions", () => {
    it("calls discoverSessionsForCwd and returns metadata", async () => {
      const { discoverSessionsForCwd } = await import("../session-discovery.js");
      (discoverSessionsForCwd as any).mockReturnValueOnce([
        {
          id: "hist-1",
          cwd: "/project",
          name: "old session",
          startedAt: Date.now(),
          modifiedAt: Date.now(),
          firstMessage: "hello",
          sessionFile: "/project/.pi/sessions/hist-1.jsonl",
          sessionDir: "/project/.pi/sessions",
        },
      ]);

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);

      const sessions = service.discoverSessions("/project");
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe("hist-1");
      expect(sessions[0].cwd).toBe("/project");
      expect(sessions[0].sessionFile).toBe("/project/.pi/sessions/hist-1.jsonl");
    });

    it("returns empty array when no sessions found", async () => {
      const { discoverSessionsForCwd } = await import("../session-discovery.js");
      (discoverSessionsForCwd as any).mockReturnValueOnce([]);

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);

      const sessions = service.discoverSessions("/nonexistent");
      expect(sessions).toEqual([]);
    });
  });

  describe("loadSessionEvents", () => {
    it("loads and converts session entries", async () => {
      const { loadSessionEntries } = await import("../session-file-reader.js");
      const { replayEntriesAsEvents } = await import("@blackbelt-technology/pi-dashboard-shared/state-replay.js");
      
      const mockEntries = [{ type: "message", message: { role: "user", content: "hi" } }];
      (loadSessionEntries as any).mockReturnValueOnce(mockEntries);
      (replayEntriesAsEvents as any).mockReturnValueOnce([
        { type: "event_forward", sessionId: "s1", event: { eventType: "message_start", timestamp: 1, data: {} } },
      ]);

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);

      const result = await service.loadSessionEvents("s1", "/path/to/session.jsonl");
      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(1);
      expect(loadSessionEntries).toHaveBeenCalledWith("/path/to/session.jsonl");
    });

    it("returns error on missing file", async () => {
      const { loadSessionEntries } = await import("../session-file-reader.js");
      (loadSessionEntries as any).mockImplementationOnce(() => { throw Object.assign(new Error("not found"), { code: "ENOENT" }); });

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);

      const result = await service.loadSessionEvents("s1", "/missing.jsonl");
      expect(result.success).toBe(false);
      expect(result.error).toBe("file_not_found");
    });
  });

  describe("getOpenSpecData / refreshOpenSpec", () => {
    it("returns cached data after polling", async () => {
      // Use the granular mocks; fs.stat on the bogus path will return undefined so
      // the new gated poll short-circuits. To exercise the happy path we set up a
      // real tmp dir with an openspec/changes folder.
      const fs = await import("node:fs");
      const os = await import("node:os");
      const path = await import("node:path");
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ds-cache-"));
      fs.mkdirSync(path.join(tmp, "openspec", "changes", "change-1"), { recursive: true });

      const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
      (runOpenSpecList as any).mockResolvedValue({ changes: [
        { name: "change-1", status: "in-progress", completedTasks: 0, totalTasks: 1 },
      ] });
      (runOpenSpecStatus as any).mockResolvedValue({ artifacts: [], isComplete: false });

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);

      const data = await service.refreshOpenSpec(tmp);
      expect(data.initialized).toBe(true);
      expect(data.changes[0].name).toBe("change-1");

      const cached = service.getOpenSpecData(tmp);
      expect(cached).toEqual(data);

      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("applies design override (R3): tasks.md with checkboxes promotes design→done", async () => {
      // See change: fix-openspec-design-detection.
      const fs = await import("node:fs");
      const os = await import("node:os");
      const path = await import("node:path");
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ds-design-override-"));
      const changeDir = path.join(tmp, "openspec", "changes", "change-x");
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(path.join(changeDir, "tasks.md"), "## 1. Setup\n\n- [ ] 1.1 Do thing\n");

      const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
      (runOpenSpecList as any).mockResolvedValue({ changes: [
        { name: "change-x", status: "in-progress", completedTasks: 0, totalTasks: 1 },
      ] });
      (runOpenSpecStatus as any).mockResolvedValue({
        artifacts: [
          { id: "proposal", status: "done" },
          { id: "specs", status: "done" },
          { id: "design", status: "ready" },
          { id: "tasks", status: "ready" },
        ],
        isComplete: false,
      });

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);

      const data = await service.refreshOpenSpec(tmp);
      const change = data.changes.find((c) => c.name === "change-x")!;
      const design = change.artifacts.find((a) => a.id === "design")!;
      expect(design.status).toBe("done");
      // tasks artifact should pass through unchanged (still ready)
      expect(change.artifacts.find((a) => a.id === "tasks")!.status).toBe("ready");

      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("design override leaves design=ready when no evidence", async () => {
      const fs = await import("node:fs");
      const os = await import("node:os");
      const path = await import("node:path");
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ds-design-no-override-"));
      const changeDir = path.join(tmp, "openspec", "changes", "change-y");
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");

      const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
      (runOpenSpecList as any).mockResolvedValue({ changes: [
        { name: "change-y", status: "in-progress", completedTasks: 0, totalTasks: 0 },
      ] });
      (runOpenSpecStatus as any).mockResolvedValue({
        artifacts: [
          { id: "proposal", status: "done" },
          { id: "design", status: "ready" },
        ],
      });

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);

      const data = await service.refreshOpenSpec(tmp);
      const change = data.changes.find((c) => c.name === "change-y")!;
      expect(change.artifacts.find((a) => a.id === "design")!.status).toBe("ready");

      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe("onDirectoryAdded", () => {
    it("discovers sessions and polls openspec immediately", async () => {
      const { discoverSessionsForCwd } = await import("../session-discovery.js");
      const { pollOpenSpecAsync } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
      
      (discoverSessionsForCwd as any).mockReturnValueOnce([]);
      (pollOpenSpecAsync as any).mockResolvedValue({ initialized: false, changes: [] });

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);

      const result = await service.onDirectoryAdded("/new/dir");
      expect(discoverSessionsForCwd).toHaveBeenCalledWith("/new/dir");
      expect(result.sessions).toEqual([]);
      expect(result.openspecData).toBeDefined();
    });
  });

  describe("polling", () => {
    it("startPolling and stopPolling control the timer", () => {
      vi.useFakeTimers();
      const stateStore = createMockPreferencesStore(["/project"]);
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);

      const onChange = vi.fn();
      service.startPolling(onChange);
      
      // Should not have fired yet
      expect(onChange).not.toHaveBeenCalled();

      service.stopPolling();
      vi.useRealTimers();
    });
  });

  describe("mtime gate", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const path = require("node:path") as typeof import("node:path");

    let tmpDir: string;
    let cwd: string;
    let changesDir: string;

    beforeEach(async () => {
      vi.clearAllMocks();
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-mtime-"));
      cwd = tmpDir;
      changesDir = path.join(cwd, "openspec", "changes");
      fs.mkdirSync(changesDir, { recursive: true });
      fs.mkdirSync(path.join(changesDir, "change-a"));
      fs.mkdirSync(path.join(changesDir, "change-b"));
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("first poll invokes list and status for each change", async () => {
      const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
      (runOpenSpecList as any).mockResolvedValue({ changes: [
        { name: "change-a", status: "in-progress", completedTasks: 1, totalTasks: 2 },
        { name: "change-b", status: "in-progress", completedTasks: 0, totalTasks: 3 },
      ] });
      (runOpenSpecStatus as any).mockResolvedValue({ artifacts: [], isComplete: false });

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);

      const data = await service.refreshOpenSpec(cwd);
      expect(data.initialized).toBe(true);
      expect(data.changes).toHaveLength(2);
      expect(runOpenSpecList).toHaveBeenCalledTimes(1);
      expect(runOpenSpecStatus).toHaveBeenCalledTimes(2);
    });

    it("second poll with unchanged mtimes makes zero CLI calls", async () => {
      const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
      (runOpenSpecList as any).mockResolvedValue({ changes: [
        { name: "change-a", status: "in-progress", completedTasks: 1, totalTasks: 2 },
      ] });
      (runOpenSpecStatus as any).mockResolvedValue({ artifacts: [], isComplete: false });

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);

      // First poll (force = true bypasses gate, populates cache).
      await service.refreshOpenSpec(cwd);
      (runOpenSpecList as any).mockClear();
      (runOpenSpecStatus as any).mockClear();

      // Second poll via the internal gated path.
      await service.pollDirectoryGated(cwd);
      expect(runOpenSpecList).not.toHaveBeenCalled();
      expect(runOpenSpecStatus).not.toHaveBeenCalled();
    });

    it("gated re-derivation never spawns status, even when one change's mtime advances", async () => {
      // New contract (optimize-openspec-poll-derive-artifacts-locally): the
      // periodic/gated path derives artifact status from local files. It never
      // spawns `openspec status` per change — only force-refresh does.
      const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
      (runOpenSpecList as any).mockResolvedValue({ changes: [
        { name: "change-a", status: "in-progress", completedTasks: 1, totalTasks: 2 },
        { name: "change-b", status: "in-progress", completedTasks: 0, totalTasks: 3 },
      ] });
      (runOpenSpecStatus as any).mockResolvedValue({ artifacts: [], isComplete: false });

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);
      await service.refreshOpenSpec(cwd);
      (runOpenSpecList as any).mockClear();
      (runOpenSpecStatus as any).mockClear();

      // Bump mtime of change-a only by touching a file inside it.
      const future = new Date(Date.now() + 10_000);
      fs.utimesSync(path.join(changesDir, "change-a"), future, future);

      await service.pollDirectoryGated(cwd);
      // List is gated by top-level mtime (unchanged) so it's skipped.
      expect(runOpenSpecList).not.toHaveBeenCalled();
      // Status is NEVER spawned on the gated path — change-a is re-derived locally.
      expect(runOpenSpecStatus).not.toHaveBeenCalled();
    });

    it("changeDetection: 'always' bypasses the gate", async () => {
      const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
      (runOpenSpecList as any).mockResolvedValue({ changes: [
        { name: "change-a", status: "in-progress", completedTasks: 0, totalTasks: 1 },
      ] });
      (runOpenSpecStatus as any).mockResolvedValue({ artifacts: [], isComplete: false });

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager, { changeDetection: "always" });
      await service.refreshOpenSpec(cwd);
      (runOpenSpecList as any).mockClear();
      (runOpenSpecStatus as any).mockClear();

      await service.pollDirectoryGated(cwd);
      expect(runOpenSpecList).toHaveBeenCalledTimes(1);
      // Gate bypassed → list re-runs, but status is still derived locally (0 spawns).
      expect(runOpenSpecStatus).not.toHaveBeenCalled();
    });

    it("re-spawns list+status when tasks.md is edited in place (POSIX dir-mtime blind spot)", async () => {
      // This test covers the bug fix in change `fix-openspec-mtime-gate-blind-spots`:
      // POSIX directory mtime advances only on entry create/delete/rename, not on
      // in-place file content edits. The previous gate used dir mtime alone and
      // missed these edits, leaving `completedTasks` stuck at the cached value.
      const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
      (runOpenSpecList as any).mockResolvedValue({ changes: [
        { name: "change-a", status: "in-progress", completedTasks: 0, totalTasks: 3 },
        { name: "change-b", status: "in-progress", completedTasks: 0, totalTasks: 1 },
      ] });
      (runOpenSpecStatus as any).mockResolvedValue({ artifacts: [], isComplete: false });

      // Seed tasks.md inside change-a so the file is part of the gate signal.
      const tasksMd = path.join(changesDir, "change-a", "tasks.md");
      fs.writeFileSync(tasksMd, "- [ ] 1.1 a\n- [ ] 1.2 b\n- [ ] 1.3 c\n", "utf-8");

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);
      await service.refreshOpenSpec(cwd);
      (runOpenSpecList as any).mockClear();
      (runOpenSpecStatus as any).mockClear();

      // Simulate an in-place edit: rewrite tasks.md AND bump its file mtime.
      // Crucially, do NOT touch the parent directory's mtime — that's the
      // blind spot the fix is supposed to cover.
      fs.writeFileSync(tasksMd, "- [x] 1.1 a\n- [x] 1.2 b\n- [ ] 1.3 c\n", "utf-8");
      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(tasksMd, future, future);

      (runOpenSpecList as any).mockResolvedValue({ changes: [
        { name: "change-a", status: "in-progress", completedTasks: 2, totalTasks: 3 },
        { name: "change-b", status: "in-progress", completedTasks: 0, totalTasks: 1 },
      ] });

      await service.pollDirectoryGated(cwd);

      // List re-runs because the tasks.md file mtime is part of the list-step signal.
      expect(runOpenSpecList).toHaveBeenCalledTimes(1);
      // Status is never spawned on the gated path; change-a is re-derived locally.
      expect(runOpenSpecStatus).not.toHaveBeenCalled();
      // Cache reflects the new counter (from the re-run list entry).
      const data = service.getOpenSpecData(cwd);
      const ca = data?.changes.find((c) => c.name === "change-a");
      expect(ca?.completedTasks).toBe(2);
    });

    it("post-archive path uses pollDirectoryGated (zero status spawns for unchanged changes)", async () => {
      // Covers the post-archive contract: `fix-openspec-mtime-gate-blind-spots`
      // made the gate file-aware so the bulk-archive path could safely skip
      // status spawns for unchanged changes. `fix-openspec-mtime-gate-toctou`
      // re-introduced `force=true` on the user-facing `refreshOpenSpec` (so a
      // user clicking the refresh icon always sees authoritative data), and
      // routed the bulk-archive handler through `pollDirectoryGated` instead
      // — preserving the O(1) status-spawn property after archives.
      // Pre-fix (pre-blind-spots) this test would see 4 status spawns because
      // `force=true` disabled the gate.
      const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");

      // Set up 5 changes in the directory (replacing the beforeEach default).
      fs.rmSync(path.join(changesDir, "change-a"), { recursive: true });
      fs.rmSync(path.join(changesDir, "change-b"), { recursive: true });
      for (const n of ["c1", "c2", "c3", "c4", "c5"]) {
        fs.mkdirSync(path.join(changesDir, n));
      }

      (runOpenSpecList as any).mockResolvedValueOnce({ changes: [
        { name: "c1", status: "in-progress", completedTasks: 0, totalTasks: 1 },
        { name: "c2", status: "in-progress", completedTasks: 0, totalTasks: 1 },
        { name: "c3", status: "in-progress", completedTasks: 0, totalTasks: 1 },
        { name: "c4", status: "in-progress", completedTasks: 0, totalTasks: 1 },
        { name: "c5", status: "in-progress", completedTasks: 0, totalTasks: 1 },
      ] });
      (runOpenSpecStatus as any).mockResolvedValue({ artifacts: [], isComplete: false });

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);

      // First poll seeds the cache (5 list+status spawns; not what's under test).
      await service.pollDirectoryGated(cwd);
      (runOpenSpecList as any).mockClear();
      (runOpenSpecStatus as any).mockClear();

      // Simulate archive: remove one change directory and bump <changes>/ mtime.
      fs.rmSync(path.join(changesDir, "c5"), { recursive: true });
      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(changesDir, future, future);
      (runOpenSpecList as any).mockResolvedValueOnce({ changes: [
        { name: "c1", status: "in-progress", completedTasks: 0, totalTasks: 1 },
        { name: "c2", status: "in-progress", completedTasks: 0, totalTasks: 1 },
        { name: "c3", status: "in-progress", completedTasks: 0, totalTasks: 1 },
        { name: "c4", status: "in-progress", completedTasks: 0, totalTasks: 1 },
      ] });

      await service.pollDirectoryGated(cwd);

      expect(runOpenSpecList).toHaveBeenCalledTimes(1);
      // The gate skips every status because none of the surviving changes'
      // artifact files moved. This is the path `handleOpenSpecBulkArchive`
      // now takes (was `refreshOpenSpec` before fix-openspec-mtime-gate-toctou).
      expect(runOpenSpecStatus).toHaveBeenCalledTimes(0);
    });

    it("removed change is pruned from cache", async () => {
      const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
      (runOpenSpecList as any).mockResolvedValueOnce({ changes: [
        { name: "change-a", status: "in-progress", completedTasks: 0, totalTasks: 1 },
        { name: "change-b", status: "in-progress", completedTasks: 0, totalTasks: 1 },
      ] });
      (runOpenSpecStatus as any).mockResolvedValue({ artifacts: [], isComplete: false });

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);
      await service.refreshOpenSpec(cwd);

      // Remove change-b and bump top-level mtime.
      fs.rmSync(path.join(changesDir, "change-b"), { recursive: true });
      const future = new Date(Date.now() + 20_000);
      fs.utimesSync(changesDir, future, future);
      (runOpenSpecList as any).mockResolvedValueOnce({ changes: [
        { name: "change-a", status: "in-progress", completedTasks: 0, totalTasks: 1 },
      ] });
      (runOpenSpecStatus as any).mockClear();

      await service.pollDirectoryGated(cwd);
      const data = service.getOpenSpecData(cwd);
      expect(data?.changes).toHaveLength(1);
      expect(data?.changes[0].name).toBe("change-a");
    });
  });

  describe("semaphore + refresh", () => {
    it("caps concurrent CLI spawns during refresh storms", async () => {
      const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
      (runOpenSpecList as any).mockImplementation(async () => ({ changes: [
        { name: "c1", status: "in-progress", completedTasks: 0, totalTasks: 1 },
      ] }));

      let active = 0;
      let peak = 0;
      (runOpenSpecStatus as any).mockImplementation(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return { artifacts: [], isComplete: false };
      });

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager, { maxConcurrentSpawns: 2, changeDetection: "always" });

      // 10 concurrent refreshes across 5 dirs with list returning 1 change each.
      await Promise.all(Array.from({ length: 10 }, (_, i) => service.refreshOpenSpec(`/project-${i}`)));
      expect(peak).toBeLessThanOrEqual(2);
    });
  });

  describe("jitter", () => {
    it("produces deterministic per-cwd offsets within jitterSeconds", async () => {
      const { phaseOffsetMs } = await import("../directory-service.js");
      const a1 = phaseOffsetMs("/project/a", 5);
      const a2 = phaseOffsetMs("/project/a", 5);
      const b = phaseOffsetMs("/project/b", 5);
      expect(a1).toBe(a2);          // stable
      expect(a1).toBeLessThan(5000);
      expect(a1).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(5000);
    });

    it("returns 0 when jitterSeconds is 0", async () => {
      const { phaseOffsetMs } = await import("../directory-service.js");
      expect(phaseOffsetMs("/any", 0)).toBe(0);
    });
  });

  describe("reconfigurePolling", () => {
    it("accepts a new interval without losing cached data", async () => {
      const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
      (runOpenSpecList as any).mockResolvedValue({ changes: [] });
      (runOpenSpecStatus as any).mockResolvedValue(null);

      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);
      await service.refreshOpenSpec("/x");
      service.reconfigurePolling({ enabled: true, pollIntervalSeconds: 60, maxConcurrentSpawns: 5, changeDetection: "mtime", jitterSeconds: 0, useWorker: true });
      expect(service.getOpenSpecData("/x")).toBeDefined();
    });
  });
});
