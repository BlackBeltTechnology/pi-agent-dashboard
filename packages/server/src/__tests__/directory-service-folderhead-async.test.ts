/**
 * CONTRACT #4 guard for Phase 2 branch 3.1 (tickOpen -> folderHeads):
 * the folder-head git HEAD reads run async + non-blocking, and the remedy must
 * NOT regress two invariants from `refresh-folder-header-branch`:
 *
 *   1. Ordering: for a given cwd, `git_head_update` still precedes
 *      `openspec_update` within a tick (folder-head fan-out is awaited before
 *      the openspec fan-out).
 *   2. Branch switch still reflects on the next tick (no suppression).
 *
 * See change: attribute-openspec-poll-eventloop-stalls.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import type { HeadInfo } from "../git-worktree/git-operations.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";

const runOpenSpecListMock = vi.fn();
vi.mock("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js")>();
  return {
    ...actual,
    pollOpenSpecAsync: vi.fn(async () => ({ initialized: false, changes: [] })),
    runOpenSpecList: (...args: any[]) => runOpenSpecListMock(...args),
    runOpenSpecStatus: vi.fn(async () => ({ name: "demo", status: "active", artifacts: [], completedTasks: 0, totalTasks: 1 })),
  };
});
vi.mock("../pi/pi-resource-scanner.js", () => ({
  scanPiResources: vi.fn(async () => ({ local: { extensions: [], skills: [], prompts: [] }, global: { extensions: [], skills: [], prompts: [] }, packages: [] })),
}));
vi.mock("../session/session-discovery.js", () => ({ discoverSessionsForCwd: vi.fn(() => []) }));

function createMockPrefs(pinned: string[]): PreferencesStore {
  return {
    getPinnedDirectories: () => pinned,
    getSessionOrder: () => ({}),
    getFavoriteModels: vi.fn(() => []),
    getWorkspaces: vi.fn(() => []),
    flush: vi.fn(),
    dispose: vi.fn(),
  } as unknown as PreferencesStore;
}
function createMockSessions(): SessionManager {
  return {
    get: () => undefined,
    listActive: () => [],
    listAll: () => [] as DashboardSession[],
  } as unknown as SessionManager;
}
function createStubWatcher() {
  const attached = new Set<string>();
  return {
    attach: (cwd: string) => { const had = attached.has(cwd); attached.add(cwd); return !had; },
    detach: (cwd: string) => { attached.delete(cwd); },
    detachAll: () => { attached.clear(); },
    size: () => attached.size,
    set onChange(_cb: (cwd: string) => void) { /* unused */ },
  };
}
function mkChangesDir(cwd: string): void {
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "demo"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "demo", "tasks.md"), "## Tasks\n- [ ] one\n");
}

describe("DirectoryService — async folder-head poll (branch 3.1 guard)", () => {
  let service: DirectoryService;
  let tmpCwd: string;

  beforeEach(() => {
    runOpenSpecListMock.mockReset();
    runOpenSpecListMock.mockResolvedValue({ changes: [{ name: "demo", status: "active", completedTasks: 0, totalTasks: 1 }] });
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "ds-fhasync-"));
  });
  afterEach(() => {
    service?.stopPolling();
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  it("4.1a git_head_update precedes openspec_update for a cwd within a tick", async () => {
    mkChangesDir(tmpCwd);
    const order: Array<{ kind: "git" | "openspec"; cwd: string }> = [];
    service = createDirectoryService(
      createMockPrefs([tmpCwd]),
      createMockSessions(),
      { pollIntervalSeconds: 0.05, jitterSeconds: 0, useWorker: false },
      {
        changeWatcher: createStubWatcher() as any,
        folderHeadWatcher: createStubWatcher() as any,
        // Async reader with a small delay — proves ordering holds even when the
        // HEAD read resolves on a later turn than the synchronous tick head.
        folderHeadReadHead: async (): Promise<HeadInfo> => {
          await new Promise((r) => setTimeout(r, 5));
          return { branch: "develop", detached: false, sha: "abc1234" };
        },
      },
    );
    service.startPolling(
      (cwd) => order.push({ kind: "openspec", cwd }),
      (msg) => order.push({ kind: "git", cwd: msg.cwd }),
    );

    await new Promise((r) => setTimeout(r, 130)); // let a tick complete
    service.stopPolling();

    const gitIdx = order.findIndex((e) => e.kind === "git" && e.cwd === tmpCwd);
    const ospecIdx = order.findIndex((e) => e.kind === "openspec" && e.cwd === tmpCwd);
    expect(gitIdx).toBeGreaterThanOrEqual(0);
    expect(ospecIdx).toBeGreaterThanOrEqual(0);
    // git_head_update for this cwd fires before its openspec_update.
    expect(gitIdx).toBeLessThan(ospecIdx);
  });

  it("4.1a a branch switch still reflects on the next tick (no suppression)", async () => {
    const gitBranches: Array<string | null> = [];
    let branch = "os/foo";
    service = createDirectoryService(
      createMockPrefs([tmpCwd]),
      createMockSessions(),
      { pollIntervalSeconds: 0.05, jitterSeconds: 0, useWorker: false },
      {
        changeWatcher: createStubWatcher() as any,
        folderHeadWatcher: createStubWatcher() as any,
        folderHeadReadHead: (): HeadInfo => ({ branch, detached: false, sha: "abc1234" }),
      },
    );
    service.startPolling(
      () => { /* openspec */ },
      (msg) => gitBranches.push(msg.branch),
    );

    await new Promise((r) => setTimeout(r, 80)); // first tick -> os/foo
    branch = "develop"; // external checkout between ticks
    await new Promise((r) => setTimeout(r, 130)); // next tick -> develop
    service.stopPolling();

    expect(gitBranches[0]).toBe("os/foo");
    expect(gitBranches).toContain("develop");
  });
});
