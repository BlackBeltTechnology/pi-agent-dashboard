/**
 * TOCTOU race regression tests for the directory-service mtime gate.
 *
 * The bug being fixed: `pollOne` used to compute the per-change cache mtime
 * AFTER `openspec status` returned. A write that landed during the CLI call
 * would stamp `{ mtimeMs: post-write, status: pre-write }` into the cache,
 * after which the gate's invariant ("mtime equal => CLI result equal") was
 * broken for that entry forever — the cache would happily reuse the stale
 * status because `current mtime == cached mtime` from then on.
 *
 * See change: fix-openspec-mtime-gate-toctou.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import type { SessionManager } from "../memory-session-manager.js";
import type { PreferencesStore } from "../preferences-store.js";

// Mock the shared openspec poller so we don't shell out.
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

function createMockSessionManager(sessions: DashboardSession[] = []): SessionManager {
  const map = new Map<string, DashboardSession>();
  for (const s of sessions) map.set(s.id, s);
  return {
    register: vi.fn(),
    restore: vi.fn(),
    unregister: vi.fn(),
    update: vi.fn(),
    get: (id: string) => map.get(id),
    listActive: () => [],
    listAll: () => Array.from(map.values()),
  } as unknown as SessionManager;
}

describe("DirectoryService TOCTOU race (fix-openspec-mtime-gate-toctou)", () => {
  let tmpDir: string;
  let cwd: string;
  let changesDir: string;
  let service: DirectoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-toctou-"));
    cwd = tmpDir;
    changesDir = path.join(cwd, "openspec", "changes");
    fs.mkdirSync(path.join(changesDir, "change-a"), { recursive: true });
    fs.writeFileSync(path.join(changesDir, "change-a", "tasks.md"), "- [ ] 1.1 a\n");
  });

  afterEach(() => {
    service?.stopPolling();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("write-during-CLI is detected and the cache is NOT poisoned", async () => {
    const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({ changes: [
      { name: "change-a", status: "in-progress", completedTasks: 0, totalTasks: 1 },
    ] });

    // Simulate a write happening DURING the CLI call: bump tasks.md mtime
    // inside the mocked status implementation. Pre-call stat saw the original
    // mtime; post-call stat will see the bumped one.
    (runOpenSpecStatus as any).mockImplementation(async () => {
      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(path.join(changesDir, "change-a", "tasks.md"), future, future);
      // Return the (now stale) status the CLI would have computed before the write.
      return {
        artifacts: [
          { id: "proposal", status: "done" },
          { id: "design", status: "done" },
          { id: "specs", status: "done" },
          { id: "tasks", status: "ready" }, // ← the racy/stale value
        ],
        isComplete: false,
      };
    });

    const stateStore = createMockPreferencesStore();
    const sessionManager = createMockSessionManager();
    service = createDirectoryService(stateStore, sessionManager);

    // Force-refresh is the only path that spawns `openspec status`
    // (optimize-openspec-poll-derive-artifacts-locally). The racy mock bumps
    // tasks.md DURING the CLI call, so the TOCTOU guard detects the in-flight
    // write and refuses to stamp change-a. The stale CLI status (tasks: ready)
    // must therefore NOT be cached.
    await service.refreshOpenSpec(cwd);

    // A subsequent gated poll derives artifact status from local files. If the
    // TOCTOU guard had failed and stamped the racy entry, this gated tick would
    // gate-HIT and reuse the poisoned `tasks: ready`. Correct behavior: the
    // entry was discarded, so the gated tick re-derives `tasks: done`
    // (totalTasks > 0) from disk.
    await service.pollDirectoryGated(cwd);
    const data = service.getOpenSpecData(cwd);
    const ca = data?.changes.find((c) => c.name === "change-a");
    expect(ca?.artifacts.find((a) => a.id === "tasks")?.status).toBe("done");
  });

  it("happy path (no race): cache is stamped with preCallMtime and gate hits on the next tick", async () => {
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

    const stateStore = createMockPreferencesStore();
    const sessionManager = createMockSessionManager();
    service = createDirectoryService(stateStore, sessionManager);

    await service.pollDirectoryGated(cwd);
    (runOpenSpecList as any).mockClear();
    (runOpenSpecStatus as any).mockClear();

    // Second poll — nothing changed on disk → gate must hit, zero CLI calls.
    await service.pollDirectoryGated(cwd);
    expect(runOpenSpecList).not.toHaveBeenCalled();
    expect(runOpenSpecStatus).not.toHaveBeenCalled();
  });

  it("bulk fast-forward authoring does not poison the cache (W1)", async () => {
    // Simulates `/opsx:ff` writing all 4 artifact files in succession while
    // periodic polls fire mid-stream. Each `runOpenSpecStatus` call sees a
    // different snapshot of disk: the first sees only proposal/design, the
    // second sees specs added, etc. Each interleaved write bumps the file's
    // mtime AFTER the CLI mock is entered — reproducing the TOCTOU window.
    // The TOCTOU guard MUST discard each racy result, and the cache MUST
    // converge to the final post-authoring statuses by the next gated tick
    // after the writes stop.
    const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({ changes: [
      { name: "change-a", status: "in-progress", completedTasks: 0, totalTasks: 1 },
    ] });

    // Track which artifacts the "CLI" should consider authored on the next call.
    // Each FF step writes the next artifact and the mock reports it as done.
    let ffStep = 0;
    const ffArtifacts = [
      ["proposal"],
      ["proposal", "design"],
      ["proposal", "design", "specs"],
      ["proposal", "design", "specs", "tasks"],
    ];
    (runOpenSpecStatus as any).mockImplementation(async () => {
      // Simulate a write happening DURING this CLI call — the next FF step
      // bumps tasks.md's mtime. This is exactly the race window the proposal
      // targets, fired once per poll while authoring is in flight.
      if (ffStep < ffArtifacts.length - 1) {
        const future = new Date(Date.now() + (ffStep + 1) * 60_000);
        fs.utimesSync(path.join(changesDir, "change-a", "tasks.md"), future, future);
      }
      const authored = new Set(ffArtifacts[ffStep]);
      ffStep++;
      return {
        artifacts: [
          { id: "proposal", status: authored.has("proposal") ? "done" : "ready" },
          { id: "design",   status: authored.has("design")   ? "done" : "ready" },
          { id: "specs",    status: authored.has("specs")    ? "done" : "ready" },
          { id: "tasks",    status: authored.has("tasks")    ? "done" : "ready" },
        ],
        isComplete: authored.size === 4,
      };
    });

    const stateStore = createMockPreferencesStore();
    const sessionManager = createMockSessionManager();
    service = createDirectoryService(stateStore, sessionManager);

    // Three force-refreshes fire while authoring is mid-stream. Force-refresh
    // is the only path that spawns `openspec status`
    // (optimize-openspec-poll-derive-artifacts-locally); each races (the mock
    // bumps tasks.md during the call) and gets discarded by the TOCTOU guard,
    // so no stale status (e.g. tasks=ready) is ever stamped into the cache.
    await service.refreshOpenSpec(cwd);
    await service.refreshOpenSpec(cwd);
    await service.refreshOpenSpec(cwd);

    // Authoring completes: the remaining artifact files land on disk. tasks.md
    // already carries a checkbox (design R3) and totalTasks > 0.
    fs.writeFileSync(path.join(changesDir, "change-a", "proposal.md"), "## Why\n");
    fs.mkdirSync(path.join(changesDir, "change-a", "specs", "cap"), { recursive: true });
    fs.writeFileSync(path.join(changesDir, "change-a", "specs", "cap", "spec.md"), "## ADDED\n");

    // A gated tick derives the converged all-done state from local files — the
    // racy force-refreshes left no poisoned entry to gate-HIT on.
    await service.pollDirectoryGated(cwd);

    const data = service.getOpenSpecData(cwd);
    const ca = data?.changes.find((c) => c.name === "change-a");
    expect(ca, "change-a should be present").toBeDefined();
    expect(ca?.artifacts.find((a) => a.id === "proposal")?.status).toBe("done");
    expect(ca?.artifacts.find((a) => a.id === "design")?.status).toBe("done");
    expect(ca?.artifacts.find((a) => a.id === "specs")?.status).toBe("done");
    expect(ca?.artifacts.find((a) => a.id === "tasks")?.status).toBe("done");
  });

  it("DEBUG-gated warn: emits exactly one line per discard when DEBUG matches; silent otherwise", async () => {
    const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({ changes: [
      { name: "change-a", status: "in-progress", completedTasks: 0, totalTasks: 1 },
    ] });
    (runOpenSpecStatus as any).mockImplementation(async () => {
      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(path.join(changesDir, "change-a", "tasks.md"), future, future);
      return { artifacts: [], isComplete: false };
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const originalDebug = process.env.DEBUG;

    try {
      // DEBUG unset → silent
      delete process.env.DEBUG;
      const stateStore = createMockPreferencesStore();
      const sessionManager = createMockSessionManager();
      service = createDirectoryService(stateStore, sessionManager);
      // Force-refresh is the only path that spawns `openspec status` and can
      // trigger the TOCTOU discard (optimize-openspec-poll-derive-artifacts-locally).
      await service.refreshOpenSpec(cwd);
      expect(warnSpy).not.toHaveBeenCalled();
      service.stopPolling();

      warnSpy.mockClear();

      // DEBUG=pi-dashboard → exactly one warn for the racy change
      process.env.DEBUG = "pi-dashboard";
      // Reset file mtime so the next poll re-arms the race.
      fs.utimesSync(path.join(changesDir, "change-a", "tasks.md"), new Date(), new Date());
      service = createDirectoryService(createMockPreferencesStore(), createMockSessionManager());
      await service.refreshOpenSpec(cwd);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/fix-openspec-mtime-gate-toctou.*change-a/);
    } finally {
      if (originalDebug === undefined) delete process.env.DEBUG;
      else process.env.DEBUG = originalDebug;
      warnSpy.mockRestore();
    }
  });
});
