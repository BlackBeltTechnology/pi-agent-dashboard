/**
 * Regression tests for the specs/** mtime watch set in the directory-service
 * gated cache.
 *
 * The bug being fixed: `perChangeArtifactPaths` previously only watched
 * `<change>/`, `tasks.md`, `proposal.md`, and `design.md`. Authoring
 * `specs/<cap>/spec.md` did not bump any of those mtimes (POSIX dir-mtime
 * does not propagate up past the immediate parent), so the cache could
 * stamp `specs: ready` on the first poll and never invalidate. The fix
 * extends the watch set to include `specs/`, every immediate
 * `specs/<cap>/`, and every `specs/<cap>/spec.md`.
 *
 * See change: fix-openspec-specs-mtime-gate-blind-spot.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";

vi.mock("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js")>();
  return {
    ...actual,
    pollOpenSpecAsync: vi.fn(async () => ({ initialized: false, changes: [] })),
    runOpenSpecList: vi.fn(async () => null),
    runOpenSpecStatus: vi.fn(async () => null),
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

vi.mock("../session/session-file-reader.js", () => ({
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

/** Bump the mtime of an existing path strictly past every prior bump. Uses a
 *  module-level monotonic counter so successive calls in the same millisecond
 *  still produce strictly-increasing mtimes (the previous `Date.now()`-based
 *  implementation flaked when two bumps landed in the same ms, since the gate
 *  uses `===` equality against the cached mtime). */
let bumpCounter = 0;
function bumpMtime(p: string, deltaMs = 60_000) {
  bumpCounter += 1;
  const future = new Date(Date.now() + deltaMs + bumpCounter * 1000);
  fs.utimesSync(p, future, future);
}

describe("DirectoryService specs/** mtime watch set", () => {
  let tmpDir: string;
  let cwd: string;
  let changesDir: string;
  let changeDir: string;
  let service: DirectoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-specs-mtime-"));
    cwd = tmpDir;
    changesDir = path.join(cwd, "openspec", "changes");
    changeDir = path.join(changesDir, "foo");
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, "proposal.md"), "## Why\n");
    fs.writeFileSync(path.join(changeDir, "design.md"), "## Context\n");
    fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [ ] 1.1 a\n");
  });

  afterEach(() => {
    service?.stopPolling();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("specs file creation invalidates per-change cache", async () => {
    const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({
      changes: [{ name: "foo", status: "in-progress", completedTasks: 0, totalTasks: 1 }],
    });

    // Before any specs files exist, the CLI reports specs: ready.
    (runOpenSpecStatus as any).mockImplementation(async () => {
      // The mock reads the live filesystem to decide what to return — this
      // simulates the real openspec CLI's fast-glob-based check.
      const hasSpec = fs.existsSync(path.join(changeDir, "specs", "cap-a", "spec.md"))
        || fs.existsSync(path.join(changeDir, "specs", "cap-b", "spec.md"));
      return {
        artifacts: [
          { id: "proposal", status: "done" },
          { id: "design", status: "done" },
          { id: "specs", status: hasSpec ? "done" : "ready" },
          { id: "tasks", status: "ready" },
        ],
        isComplete: false,
      };
    });

    service = createDirectoryService(createMockPreferencesStore(), createMockSessionManager());

    // First poll: no specs files → specs: ready.
    await service.pollDirectoryGated(cwd);
    {
      const data = service.getOpenSpecData(cwd);
      const foo = data?.changes.find((c) => c.name === "foo");
      expect(foo?.artifacts.find((a) => a.id === "specs")?.status).toBe("ready");
    }

    (runOpenSpecList as any).mockClear();
    (runOpenSpecStatus as any).mockClear();

    // Author specs/cap-a/spec.md AFTER the first poll. This is the user's
    // mid-flight authoring; the change directory's mtime DOES advance (since
    // we created a new entry under specs/), but the bug pre-fix was that the
    // gate's signal didn't react to specs/<cap>/spec.md edits in general.
    fs.mkdirSync(path.join(changeDir, "specs", "cap-a"), { recursive: true });
    fs.writeFileSync(path.join(changeDir, "specs", "cap-a", "spec.md"), "## ADDED\n");
    bumpMtime(path.join(changeDir, "specs", "cap-a", "spec.md"));

    // Second poll: gate must invalidate and the change is re-derived from
    // local files. The gated path NEVER spawns `openspec status`
    // (optimize-openspec-poll-derive-artifacts-locally) — the new specs file is
    // picked up by the local specs-evidence probe.
    await service.pollDirectoryGated(cwd);
    expect(runOpenSpecStatus).not.toHaveBeenCalled();
    {
      const data = service.getOpenSpecData(cwd);
      const foo = data?.changes.find((c) => c.name === "foo");
      expect(foo?.artifacts.find((a) => a.id === "specs")?.status).toBe("done");
    }
  });

  it("in-place edit to existing spec.md invalidates per-change cache", async () => {
    const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({
      changes: [{ name: "foo", status: "in-progress", completedTasks: 0, totalTasks: 1 }],
    });
    (runOpenSpecStatus as any).mockImplementation(async () => ({
      artifacts: [
        { id: "proposal", status: "done" },
        { id: "design", status: "done" },
        { id: "specs", status: "done" },
        { id: "tasks", status: "ready" },
      ],
      isComplete: false,
    }));

    // Author specs/cap-a/spec.md before the first poll so we exercise the
    // "in-place edit" path specifically (not the "creation" path).
    fs.mkdirSync(path.join(changeDir, "specs", "cap-a"), { recursive: true });
    const specPath = path.join(changeDir, "specs", "cap-a", "spec.md");
    fs.writeFileSync(specPath, "v1");

    service = createDirectoryService(createMockPreferencesStore(), createMockSessionManager());

    await service.pollDirectoryGated(cwd);
    (runOpenSpecList as any).mockClear();
    (runOpenSpecStatus as any).mockClear();

    // No-op poll: nothing changed → gate must hit, zero CLI calls.
    await service.pollDirectoryGated(cwd);
    expect(runOpenSpecStatus).not.toHaveBeenCalled();

    // Edit in place. POSIX bumps the file's mtime but NOT the parent dir's.
    // Without specs/<cap>/spec.md in the watch set, the gate would miss this.
    fs.writeFileSync(specPath, "v2");
    bumpMtime(specPath);

    // Gate invalidates on the spec.md mtime bump and re-derives — no status
    // spawn (optimize-openspec-poll-derive-artifacts-locally). specs stays done
    // because the file still exists.
    await service.pollDirectoryGated(cwd);
    expect(runOpenSpecStatus).not.toHaveBeenCalled();
    {
      const data = service.getOpenSpecData(cwd);
      expect(data?.changes[0].artifacts.find((a) => a.id === "specs")?.status).toBe("done");
    }
  });

  it("deletion of specs/<cap> invalidates per-change cache", async () => {
    const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({
      changes: [{ name: "foo", status: "in-progress", completedTasks: 0, totalTasks: 1 }],
    });
    (runOpenSpecStatus as any).mockImplementation(async () => {
      const hasSpec = fs.existsSync(path.join(changeDir, "specs", "cap-a", "spec.md"));
      return {
        artifacts: [
          { id: "proposal", status: "done" },
          { id: "design", status: "done" },
          { id: "specs", status: hasSpec ? "done" : "ready" },
          { id: "tasks", status: "ready" },
        ],
        isComplete: false,
      };
    });

    fs.mkdirSync(path.join(changeDir, "specs", "cap-a"), { recursive: true });
    fs.writeFileSync(path.join(changeDir, "specs", "cap-a", "spec.md"), "v1");
    bumpMtime(path.join(changeDir, "specs", "cap-a", "spec.md"));

    service = createDirectoryService(createMockPreferencesStore(), createMockSessionManager());

    await service.pollDirectoryGated(cwd);
    {
      const data = service.getOpenSpecData(cwd);
      expect(data?.changes[0].artifacts.find((a) => a.id === "specs")?.status).toBe("done");
    }

    (runOpenSpecList as any).mockClear();
    (runOpenSpecStatus as any).mockClear();

    // Remove the entire capability subtree. specs/ mtime advances (entry-
    // delete semantics) so the gate must invalidate.
    fs.rmSync(path.join(changeDir, "specs", "cap-a"), { recursive: true });
    bumpMtime(path.join(changeDir, "specs"));

    // Gate invalidates on the specs/ deletion and re-derives — no status spawn
    // (optimize-openspec-poll-derive-artifacts-locally). specs falls back to
    // ready because no spec file remains.
    await service.pollDirectoryGated(cwd);
    expect(runOpenSpecStatus).not.toHaveBeenCalled();
    {
      const data = service.getOpenSpecData(cwd);
      expect(data?.changes[0].artifacts.find((a) => a.id === "specs")?.status).toBe("ready");
    }
  });

  it("change with no specs/ directory at all does not throw", async () => {
    const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({
      changes: [{ name: "foo", status: "in-progress", completedTasks: 0, totalTasks: 1 }],
    });
    (runOpenSpecStatus as any).mockResolvedValue({
      artifacts: [
        { id: "proposal", status: "done" },
        { id: "design", status: "ready" },
        { id: "specs", status: "ready" },
        { id: "tasks", status: "blocked" },
      ],
      isComplete: false,
    });

    // beforeEach already created the change without a specs/ directory.
    service = createDirectoryService(createMockPreferencesStore(), createMockSessionManager());

    await expect(service.pollDirectoryGated(cwd)).resolves.not.toThrow();
    const data = service.getOpenSpecData(cwd);
    expect(data?.changes[0].artifacts.find((a) => a.id === "specs")?.status).toBe("ready");
  });

  it("specs override promotes ready→done when local files exist (defense in depth)", async () => {
    const { runOpenSpecList, runOpenSpecStatus } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({
      changes: [{ name: "foo", status: "in-progress", completedTasks: 0, totalTasks: 1 }],
    });
    // CLI lies and says ready even though spec files exist on disk. The
    // local-evidence override at the buildOpenSpecData layer should still
    // promote to done.
    (runOpenSpecStatus as any).mockResolvedValue({
      artifacts: [
        { id: "proposal", status: "done" },
        { id: "design", status: "done" },
        { id: "specs", status: "ready" }, // ← stale CLI verdict
        { id: "tasks", status: "ready" },
      ],
      isComplete: false,
    });

    fs.mkdirSync(path.join(changeDir, "specs", "cap-a"), { recursive: true });
    fs.writeFileSync(path.join(changeDir, "specs", "cap-a", "spec.md"), "## ADDED\n");

    service = createDirectoryService(createMockPreferencesStore(), createMockSessionManager());

    await service.pollDirectoryGated(cwd);
    const data = service.getOpenSpecData(cwd);
    const foo = data?.changes.find((c) => c.name === "foo");
    // The override fired: local evidence promoted ready → done despite the
    // CLI's stale verdict.
    expect(foo?.artifacts.find((a) => a.id === "specs")?.status).toBe("done");
  });
});
