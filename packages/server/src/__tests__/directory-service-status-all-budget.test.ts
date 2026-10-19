/**
 * Per-turn budget of the `status --all` poll path (#P1, #P2): with 107
 * unchanged changes, no instrumented turn (`dirPollPre/Gate/Cli/Post`)
 * self-records above the floor over 3 ticks, and the in-process mode issues
 * no per-change synchronous `statSync`.
 * See change: use-openspec-status-all.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_OPENSPEC_POLL } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import { createEventLoopSpikeMetrics } from "../metrics/eventloop-spike-metrics.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import { backdate, createFixtureCli, mkTmpCwd, seedChanges } from "./helpers/status-all-fixture.js";

const h = vi.hoisted(() => ({ cli: null as null | { run: (cwd: string) => Promise<unknown> } }));

vi.mock("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js")>();
  return {
    ...actual,
    runOpenSpecStatusAll: vi.fn((cwd: string) => h.cli!.run(cwd)),
    runOpenSpecList: vi.fn(async () => null),
    runOpenSpecStatus: vi.fn(async () => null),
  };
});
vi.mock("../pi/pi-resource-scanner.js", () => ({
  scanPiResources: vi.fn(async () => ({ local: { extensions: [], skills: [], prompts: [] }, global: { extensions: [], skills: [], prompts: [] }, packages: [] })),
}));
vi.mock("../session/session-discovery.js", () => ({ discoverSessionsForCwd: vi.fn(() => []) }));
// Records (and calls through) every synchronous stat so P2 can assert none is per-change.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, statSync: vi.fn((...args: Parameters<typeof actual.statSync>) => actual.statSync(...args)) };
});

const prefs = () =>
  ({ getPinnedDirectories: () => [], getOpenSpecUpdateSignature: vi.fn(() => undefined), getWorkspaces: vi.fn(() => []), flush: vi.fn(), dispose: vi.fn() }) as unknown as PreferencesStore;
const sessions = () =>
  ({ register: vi.fn(), unregister: vi.fn(), update: vi.fn(), get: () => undefined, listActive: () => [], listAll: () => [] }) as unknown as SessionManager;

const POLL_TURNS = ["dirPollPre", "dirPollGate", "dirPollCli", "dirPollPost"];

describe("status --all per-turn budget", () => {
  let cwd: string;
  let service: DirectoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    cwd = mkTmpCwd("ds-budget");
    seedChanges(cwd, 107);
    backdate(path.join(cwd, "openspec"));
    h.cli = createFixtureCli();
  });
  afterEach(() => {
    service?.stopPolling();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  async function run(useWorker: boolean) {
    const spikes = createEventLoopSpikeMetrics(50);
    service = createDirectoryService(
      prefs(),
      sessions(),
      { ...DEFAULT_OPENSPEC_POLL, useWorker },
      { eventLoopSpikes: spikes, eventLoopSpikeFloorMs: DEFAULT_FLOOR, openspecVersionResolver: async () => "1.14.3" },
    );
    await service.pollDirectoryGated(cwd); // cold poll (builds the cache)
    vi.mocked(fs.statSync).mockClear();
    for (let i = 0; i < 3; i++) await service.pollDirectoryGated(cwd); // no-op ticks
    return spikes.snapshot().filter((s) => s.turn !== null && POLL_TURNS.includes(s.turn));
  }
  const DEFAULT_FLOOR = 100;

  it("#P1 worker mode: no instrumented poll turn above the floor over 3 no-op ticks", async () => {
    expect(await run(true)).toEqual([]);
  });

  it("#P2 in-process mode: no turn above the floor and no per-change synchronous stat", async () => {
    expect(await run(false)).toEqual([]);
    const perChange = vi
      .mocked(fs.statSync)
      .mock.calls.map((c) => String(c[0]))
      .filter((p) => p.includes(`${path.sep}changes${path.sep}c`));
    expect(perChange).toEqual([]);
  });
});
