/**
 * Per-turn event-loop attribution on the OpenSpec poll path.
 *
 * The tick's synchronous work is spread across many event-loop turns:
 *   - `tickOpen`     — the `setInterval` fire (tickFolderHeads + reconcile +
 *                      computeKnownDirectories), before the `await Promise.all`.
 *   - `dirPollPre`   — a dir's `setTimeout` fire prefix, INCLUDING `pollOne`'s
 *                      synchronous run before the worker `await`.
 *   - `dirPollPost`  — the continuation after the worker resolves (broadcast).
 *
 * Each turn self-records `{at, ms, turn}` when its OWN synchronous run reaches
 * the floor, and warns (independently of the wall `durationMs` alarm) at the
 * per-turn threshold. Attribution is per single synchronous turn — NEVER summed
 * across the worker await.
 *
 * See change: attribute-openspec-poll-eventloop-stalls.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import { createEventLoopSpikeMetrics } from "../metrics/eventloop-spike-metrics.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";

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

/** Busy-wait to block the event loop synchronously for ~ms milliseconds. */
function blockFor(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

function mkChangesDir(cwd: string): void {
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "demo"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "demo", "tasks.md"), "## Tasks\n- [ ] one\n");
}

describe("DirectoryService — per-turn event-loop attribution", () => {
  let service: DirectoryService;
  let tmpCwd: string;

  beforeEach(() => {
    runOpenSpecListMock.mockReset();
    runOpenSpecStatusMock.mockReset();
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "ds-elturns-"));
  });
  afterEach(() => {
    service?.stopPolling();
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  it("1.4/1.5 self-records + warns a heavy tickOpen turn; the wall alarm stays silent", async () => {
    const spikes = createEventLoopSpikeMetrics(20);
    const warns: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((m?: unknown) => { warns.push(String(m)); });
    // Block once, inside `reconcileWatchers` (attach) — i.e. the tickOpen turn.
    let blocked = false;
    const watcher = { ...createStubWatcher(), attach: (cwd: string) => { if (!blocked) { blocked = true; blockFor(120); } return true; } };
    service = createDirectoryService(
      createMockPrefs([tmpCwd]),
      createMockSessions(),
      { pollIntervalSeconds: 0.05, jitterSeconds: 0, useWorker: false },
      { changeWatcher: watcher as any, eventLoopSpikes: spikes, eventLoopSpikeFloorMs: 50, perTurnWarnMs: 100 },
    );
    service.startPolling(() => { /* no broadcast work */ });
    await new Promise((r) => setTimeout(r, 90));
    service.stopPolling();

    const snap = spikes.snapshot();
    expect(snap.some((s) => s.turn === "tickOpen" && s.ms >= 50)).toBe(true);
    // Per-turn alarm fires and NAMES the turn.
    expect(warns.some((w) => /slow turn: tickOpen/.test(w))).toBe(true);
    // Wall alarm (5000ms) is orthogonal and stays silent for a 120ms turn.
    expect(warns.some((w) => /slow tick:/.test(w))).toBe(false);
    warnSpy.mockRestore();
  });

  it("1.4 self-records a heavy dirPollPost turn (the broadcast)", async () => {
    mkChangesDir(tmpCwd);
    runOpenSpecListMock.mockResolvedValue({ changes: [{ name: "demo", status: "active", completedTasks: 0, totalTasks: 1 }] });
    const spikes = createEventLoopSpikeMetrics(20);
    let blocked = false;
    service = createDirectoryService(
      createMockPrefs([tmpCwd]),
      createMockSessions(),
      { pollIntervalSeconds: 0.05, jitterSeconds: 0, useWorker: false },
      { changeWatcher: createStubWatcher() as any, eventLoopSpikes: spikes, eventLoopSpikeFloorMs: 50, perTurnWarnMs: 1000 },
    );
    // Block only on the authoritative (initialized) broadcast → dirPollPost.
    service.startPolling((_cwd, data) => { if (data.initialized && !blocked) { blocked = true; blockFor(120); } });
    await new Promise((r) => setTimeout(r, 150));
    service.stopPolling();

    const snap = spikes.snapshot();
    expect(snap.some((s) => s.turn === "dirPollPost" && s.ms >= 50)).toBe(true);
  });

  it("1.4 times pre/post as SEPARATE turns split by the worker await, never summed", async () => {
    mkChangesDir(tmpCwd);
    runOpenSpecListMock.mockResolvedValue({ changes: [{ name: "demo", status: "active", completedTasks: 0, totalTasks: 1 }] });
    const spikes = createEventLoopSpikeMetrics(20);
    let preBlocked = false;
    let postBlocked = false;
    service = createDirectoryService(
      createMockPrefs([tmpCwd]),
      createMockSessions(),
      { pollIntervalSeconds: 0.05, jitterSeconds: 0, useWorker: false },
      { changeWatcher: createStubWatcher() as any, eventLoopSpikes: spikes, eventLoopSpikeFloorMs: 50, perTurnWarnMs: 10000 },
    );
    service.startPolling((_cwd, data) => {
      // pending emit runs synchronously inside dirPollPre; the initialized
      // broadcast runs in dirPollPost — block each side once.
      if (data.pending && !preBlocked) { preBlocked = true; blockFor(80); }
      else if (data.initialized && !postBlocked) { postBlocked = true; blockFor(80); }
    });
    await new Promise((r) => setTimeout(r, 150));
    service.stopPolling();

    const snap = spikes.snapshot();
    expect(snap.some((s) => s.turn === "dirPollPre")).toBe(true);
    expect(snap.some((s) => s.turn === "dirPollPost")).toBe(true);
    // Each recorded turn is ~80ms (one side), NOT ~160ms (the summed span
    // across the await) — proof pre/post are not counted as one turn.
    expect(Math.max(...snap.map((s) => s.ms))).toBeLessThan(150);
  });

  it("4.2 a no-op tick produces no per-turn self-record above the floor and no per-turn warn", async () => {
    // Pinned dir with no openspec changes/ → every turn is trivially fast.
    const spikes = createEventLoopSpikeMetrics(20);
    const warns: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((m?: unknown) => { warns.push(String(m)); });
    service = createDirectoryService(
      createMockPrefs([tmpCwd]),
      createMockSessions(),
      { pollIntervalSeconds: 0.05, jitterSeconds: 0, useWorker: false },
      { changeWatcher: createStubWatcher() as any, eventLoopSpikes: spikes, eventLoopSpikeFloorMs: 100, perTurnWarnMs: 250 },
    );
    service.startPolling(() => { /* no work */ });
    await new Promise((r) => setTimeout(r, 130)); // a couple of ticks
    service.stopPolling();

    expect(spikes.snapshot()).toHaveLength(0);
    expect(warns.some((w) => /slow turn:/.test(w))).toBe(false);
    warnSpy.mockRestore();
  });
});
