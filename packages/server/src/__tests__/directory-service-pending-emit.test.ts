/**
 * The gated poll path emits a transitional `{ initialized:false, pending:true }`
 * snapshot — via the `onChangeCallback` installed by `startPolling` — before the
 * slow `openspec list` spawn, for any cwd whose `openspec/changes/` exists but
 * whose cache holds no authoritative `initialized:true` data yet. All three
 * broadcast wrappers (periodic tick, watcher-fired re-poll, onDirectoryAdded)
 * funnel through `pollDirectoryGated`, so these tests drive that public method.
 *
 * See change: emit-openspec-pending-from-poll.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DashboardSession, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { discoverAndBroadcastSessions } from "../session/session-bootstrap.js";

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

/** Stub watcher — these tests drive `pollDirectoryGated` directly. */
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

describe("DirectoryService — poll-path pending emit", () => {
  let service: DirectoryService;
  let tmpCwd: string;
  let emits: Array<{ cwd: string; data: OpenSpecData }>;

  beforeEach(() => {
    runOpenSpecListMock.mockReset();
    runOpenSpecStatusMock.mockReset();
    runOpenSpecStatusMock.mockResolvedValue({ name: "demo", status: "active", artifacts: [], completedTasks: 0, totalTasks: 1 });
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "ds-pending-emit-"));
    emits = [];
  });

  afterEach(() => {
    service?.stopPolling();
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  function build(): void {
    service = createDirectoryService(createMockPrefs([tmpCwd]), createMockSessions(), undefined, {
      changeWatcher: createStubWatcher() as any,
    });
    service.startPolling((cwd, data) => emits.push({ cwd, data }));
  }

  it("2.1 emits pending:true before the final initialized payload (committed openspec dir)", async () => {
    mkChangesDir(tmpCwd);
    runOpenSpecListMock.mockResolvedValue({ changes: [{ name: "demo", status: "active", completedTasks: 0, totalTasks: 1 }] });
    build();

    const final = await service.pollDirectoryGated(tmpCwd);

    // `pollDirectoryGated` broadcasts exactly the transitional pending snapshot
    // (the authoritative payload is the awaited return, broadcast by the wrapper).
    expect(emits).toHaveLength(1);
    expect(emits[0].data).toMatchObject({ initialized: false, pending: true });
    // The pending emit precedes the final return value.
    expect(final.initialized).toBe(true);
  });

  it("2.2 (Scenario 2) discovery poll emits pending then initialized, no straight jump", async () => {
    runOpenSpecListMock.mockResolvedValue({ changes: [{ name: "demo", status: "active", completedTasks: 0, totalTasks: 1 }] });
    build();

    // First poll: changes/ absent → no pending, not initialized.
    const first = await service.pollDirectoryGated(tmpCwd);
    expect(first.initialized).toBe(false);
    expect(emits).toHaveLength(0);

    // Dir appears later (delayed `openspec init` hook).
    mkChangesDir(tmpCwd);
    const second = await service.pollDirectoryGated(tmpCwd);

    // Exactly one transitional pending, then the authoritative return — the
    // section never jumps straight from no-data to initialized.
    expect(emits).toHaveLength(1);
    expect(emits[0].data).toMatchObject({ initialized: false, pending: true });
    expect(second.initialized).toBe(true);
  });

  it("3.1 no pending for a non-openspec directory", async () => {
    runOpenSpecListMock.mockResolvedValue({ changes: [] });
    build();

    const data = await service.pollDirectoryGated(tmpCwd);

    expect(emits.some((e) => e.data.pending === true)).toBe(false);
    expect(data.initialized).toBe(false);
    expect(data.hasOpenspecDir).toBe(false);
  });

  it("3.2 no pending for an init-only directory without a changes/ subdir", async () => {
    fs.mkdirSync(path.join(tmpCwd, "openspec"), { recursive: true });
    runOpenSpecListMock.mockResolvedValue({ changes: [] });
    build();

    const data = await service.pollDirectoryGated(tmpCwd);

    expect(emits.some((e) => e.data.pending === true)).toBe(false);
    expect(data.hasOpenspecDir).toBe(true);
    expect(data.initialized).toBe(false);
  });

  it("3.3 pending clears on a failed terminal poll (CLI returns no usable data)", async () => {
    mkChangesDir(tmpCwd);
    runOpenSpecListMock.mockResolvedValue(null); // CLI error / unusable
    build();

    const final = await service.pollDirectoryGated(tmpCwd);

    // Spinner was shown...
    expect(emits.some((e) => e.data.pending === true)).toBe(true);
    // ...then the terminal payload resolves !initialized && !pending → render nothing.
    expect(final.initialized).toBe(false);
    expect(final.pending).not.toBe(true);
  });

  it("E27: openspec_get polls the gated path — transitional pending + one change-gated final; gate honoured, CLI never re-run (fix-connect-snapshot-frame-loss)", async () => {
    mkChangesDir(tmpCwd);
    runOpenSpecListMock.mockResolvedValue({ changes: [{ name: "demo", status: "active", completedTasks: 0, totalTasks: 1 }] });
    build();

    // Cold get: PENDING placeholder + one poll through `pollDirectoryGated`.
    // The transitional pending:true reaches every browser (via the service's
    // onChangeCallback) exactly as a periodic poll would.
    const first = service.getOrPollOpenSpec(tmpCwd);
    expect(first.hit).toMatchObject({ pending: true, hasOpenspecDir: true });
    const final = await first.poll!;
    expect(final.initialized).toBe(true);

    // The gated-path broadcast discipline: transitional pending, then exactly
    // ONE change-gated final (prevJson was empty → the final always fires).
    expect(emits.map((e) => e.data.pending === true)).toEqual([true, false]);
    expect(emits[1].data).toMatchObject({ initialized: true });
    expect(runOpenSpecListMock).toHaveBeenCalledTimes(1);

    // Gate unchanged (fs untouched): the second get is a cache hit — no poll,
    // no CLI re-run. `openspec_get` never force-polls.
    const second = service.getOrPollOpenSpec(tmpCwd);
    expect(second.poll).toBeUndefined();
    expect(second.hit?.initialized).toBe(true);
    expect(runOpenSpecListMock).toHaveBeenCalledTimes(1);
  });

  it("3.4 repeated empty/failed tick still delivers the terminal clear (diff-guard not suppressed)", async () => {
    vi.useFakeTimers();
    try {
      mkChangesDir(tmpCwd);
      runOpenSpecListMock.mockResolvedValue(null); // persistent CLI failure → { initialized:false }
      service = createDirectoryService(
        createMockPrefs([tmpCwd]),
        createMockSessions(),
        { pollIntervalSeconds: 0.05, jitterSeconds: 0 },
        { changeWatcher: createStubWatcher() as any },
      );
      service.startPolling((cwd, data) => emits.push({ cwd, data }));

      // Two periodic ticks. Each one emits a transitional pending:true; the
      // second tick's final payload equals the first's ({ initialized:false }),
      // so the JSON-diff guard would suppress the clear without the
      // pending-emitted flag — leaving the spinner stuck.
      await vi.advanceTimersByTimeAsync(60);
      await vi.advanceTimersByTimeAsync(60);

      const pendingCount = emits.filter((e) => e.data.pending === true).length;
      const clearCount = emits.filter((e) => e.data.initialized === false && e.data.pending !== true).length;
      expect(pendingCount).toBeGreaterThanOrEqual(2);
      // Every spinner shown is matched by a terminal clear.
      expect(clearCount).toBe(pendingCount);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * E13 — pinned-directory discovery must never resurrect an ARCHIVED id from
 * its `.jsonl`. `discoverAndBroadcastSessions` consults the archive index
 * before restoring, so the archived session stays non-resident and no
 * `session_added` frame is emitted for it.
 *
 * See change: archive-sessions-lazy-load.
 */
describe("discoverAndBroadcastSessions — archived ids stay non-resident (E13)", () => {
  let tmpCwd: string;
  let service: DirectoryService;

  beforeEach(() => {
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-archived-"));
    runOpenSpecListMock.mockResolvedValue({ changes: [] });
  });

  afterEach(async () => {
    service?.stopPolling();
    const { discoverSessionsForCwd } = await import("../session/session-discovery.js");
    vi.mocked(discoverSessionsForCwd).mockReturnValue([]);
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  function jsonl(id: string): string {
    const file = path.join(tmpCwd, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type: "session", id, cwd: tmpCwd })}\n`);
    return file;
  }

  it("restores the un-archived discovery and skips the archived one", async () => {
    const archivedFile = jsonl("disc-archived");
    const residentFile = jsonl("disc-resident");
    const discovered = (id: string, sessionFile: string) => ({
      id, cwd: tmpCwd, startedAt: 1000, modifiedAt: 2000, sessionFile, sessionDir: tmpCwd,
    });
    const { discoverSessionsForCwd } = await import("../session/session-discovery.js");
    vi.mocked(discoverSessionsForCwd).mockReturnValue([
      discovered("disc-archived", archivedFile),
      discovered("disc-resident", residentFile),
    ]);

    service = createDirectoryService(createMockPrefs([tmpCwd]), createMockSessions(), undefined, {
      changeWatcher: createStubWatcher() as any,
    });

    const sessionManager = createMemorySessionManager();
    const added: string[] = [];
    const browserGateway = {
      broadcastSessionAdded: (s: { id: string }) => added.push(s.id),
      broadcastToAll: () => {},
      broadcastOpenSpecUpdate: () => {},
    } as never;

    await discoverAndBroadcastSessions({
      sessionManager,
      browserGateway,
      directoryService: service,
      sessionArchive: { has: (id: string) => id === "disc-archived" } as never,
    });

    expect(sessionManager.get("disc-archived")).toBeUndefined();
    expect(added).toEqual(["disc-resident"]);
    expect(sessionManager.get("disc-resident")).toBeDefined();
  });
});
