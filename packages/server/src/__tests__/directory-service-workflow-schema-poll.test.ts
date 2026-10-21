/**
 * Workflow-schema status computed by the poll worker's `schemaStatus` request on
 * EVERY tick (gate hit included): #P1 CLI upgrade, #P2 config.yml, #P3 fallback
 * list path, #P6 user-schema dir, #P8 worker vs in-process, #P11 worker error,
 * #P12 no resurrection + log re-arm, #P13 main-thread validate, #P14 enqueue
 * order, #P16 event-loop turn budget.
 * See change: move-workflow-schema-status-to-poll-worker.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_OPENSPEC_POLL } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService, type DirectoryServiceOptions } from "../directory-service.js";
import { createEventLoopSpikeMetrics } from "../metrics/eventloop-spike-metrics.js";
import { computeSchemaStatusFor } from "../openspec/openspec-poll-worker.js";
import {
  createOpenSpecPollWorkerPool,
  type PollWorkerPool,
  type PollWorkerPoolOptions,
} from "../openspec/openspec-poll-worker-pool.js";
import type { CliCall } from "../openspec/workflow-schema.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import { backdate, createFixtureCli, mkTmpCwd, seedChanges, touchFuture, writeFile } from "./helpers/status-all-fixture.js";

const h = vi.hoisted(() => ({
  statusAll: null as null | ((cwd: string) => Promise<unknown>),
  list: null as null | ((cwd: string) => Promise<unknown>),
}));
vi.mock("../git-worktree/git-operations.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../git-worktree/git-operations.js")>()),
  resolveConfigRoot: (cwd: string) => cwd,
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js")>()),
  runOpenSpecStatusAll: vi.fn((cwd: string) => h.statusAll!(cwd)),
  runOpenSpecList: vi.fn((cwd: string) => h.list!(cwd)),
  runOpenSpecStatus: vi.fn(async () => null),
}));
vi.mock("../pi/pi-resource-scanner.js", () => ({
  scanPiResources: vi.fn(async () => ({ local: { extensions: [], skills: [], prompts: [] }, global: { extensions: [], skills: [], prompts: [] }, packages: [] })),
}));
vi.mock("../session/session-discovery.js", () => ({ discoverSessionsForCwd: vi.fn(() => []) }));

const prefs = () =>
  ({ getPinnedDirectories: () => [], getOpenSpecUpdateSignature: () => undefined, getWorkspaces: () => [], flush: vi.fn(), dispose: vi.fn() }) as unknown as PreferencesStore;
const sessions = () =>
  ({ register: vi.fn(), unregister: vi.fn(), update: vi.fn(), get: () => undefined, listActive: () => [], listAll: () => [] }) as unknown as SessionManager;

const UNSUPPORTED = { stdout: "", stderr: "error: unknown option '--all'", exitCode: 1 };
const FIXTURE_WORKER = pathToFileURL(path.resolve(__dirname, "fixtures/reject-schema-status-worker.mjs")).href;
const tick = (s: DirectoryService, cwd: string) => s.pollDirectoryGated(cwd);

let roots: string[];
let userDir: string;
let pkgDir: string;
let version: string;
let service: DirectoryService | undefined;
let statusAllCalls: number;

function mkCwd(opts: { changes?: number; config?: string; configFile?: string } = {}): string {
  const cwd = mkTmpCwd("ds-wfs-poll");
  roots.push(cwd);
  seedChanges(cwd, opts.changes ?? 1);
  fs.mkdirSync(path.join(cwd, ".pi", "skills", "openspec-explore"), { recursive: true });
  writeFile(cwd, `openspec/${opts.configFile ?? "config.yaml"}`, opts.config ?? "schema: pi-spec-driven\n");
  return cwd;
}
function stamp(cwd: string, base: string, patch = 1): void {
  writeFile(
    cwd,
    "openspec/schemas/pi-spec-driven/schema.yaml",
    `name: pi-spec-driven\nx-pi-dashboard:\n  derivedFrom: spec-driven@${base}\n  patch: ${patch}\n  previousDefault: spec-driven\n`,
  );
}
function make(cfg: Record<string, unknown> = {}, opts: DirectoryServiceOptions = {}): DirectoryService {
  service = createDirectoryService(
    prefs(),
    sessions(),
    { ...DEFAULT_OPENSPEC_POLL, useWorker: false, ...cfg },
    {
      openspecVersionResolver: async () => version,
      workflowSchema: { packageSchemasDir: async () => pkgDir, userSchemasDirPath: userDir, ...opts.workflowSchema },
      ...opts,
    },
  );
  return service;
}
/** Backdate so the next tick's gate sees no racy "just written" mtimes. */
const settle = (cwd: string): void => backdate(path.join(cwd, "openspec"));

beforeEach(() => {
  roots = [];
  version = "1.11.0";
  statusAllCalls = 0;
  const root = mkTmpCwd("ds-wfs-dirs");
  roots.push(root);
  userDir = path.join(root, "user-schemas");
  pkgDir = path.join(root, "pkg-schemas");
  writeFile(root, "pkg-schemas/spec-driven/schema.yaml", "name: spec-driven\n");
  fs.mkdirSync(userDir, { recursive: true });
  const cli = createFixtureCli();
  h.statusAll = async (cwd) => {
    statusAllCalls++;
    return cli.run(cwd);
  };
  h.list = async () => ({ changes: [{ name: "c000", status: "in-progress", completedTasks: 0, totalTasks: 0 }] });
});
afterEach(() => {
  vi.restoreAllMocks();
  service?.stopPolling();
  service = undefined;
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

describe("status is fresh on gate-hit ticks", () => {
  it("#P1 a CLI upgrade between ticks reports outdated without spawning status --all", async () => {
    const cwd = mkCwd();
    stamp(cwd, "1.11.0");
    settle(cwd);
    make();
    expect((await tick(service!, cwd)).workflowSchema?.generated).toBe("current");
    expect(statusAllCalls).toBe(1);
    version = "1.12.0";
    const out = await tick(service!, cwd);
    expect(out.workflowSchema?.generated).toBe("outdated");
    expect(statusAllCalls).toBe(1); // gate hit: no new spawn
  });

  it("#P2 a config.yml-only default rewrite is seen on a gate-hit tick", async () => {
    const cwd = mkCwd({ config: "schema: spec-driven\n", configFile: "config.yml" });
    settle(cwd);
    make();
    expect((await tick(service!, cwd)).workflowSchema?.configured).toBe("spec-driven");
    fs.writeFileSync(path.join(cwd, "openspec", "config.yml"), "schema: pi-spec-driven\n");
    const out = await tick(service!, cwd);
    expect(out.workflowSchema?.configured).toBe("pi-spec-driven");
    expect(statusAllCalls).toBe(1);
  });

  it("#P6 removing the schema from the user schema dir flips missing on a gate-hit tick", async () => {
    const cwd = mkCwd({ config: "schema: custom\n" });
    writeFile(userDir, "custom/schema.yaml", "name: custom\n");
    settle(cwd);
    make();
    expect((await tick(service!, cwd)).workflowSchema?.missing).toBe(false);
    fs.rmSync(path.join(userDir, "custom"), { recursive: true });
    const out = await tick(service!, cwd);
    expect(out.workflowSchema?.missing).toBe(true);
    expect(statusAllCalls).toBe(1);
  });
});

describe("one path for every poll route", () => {
  it("#P3 the fallback list path carries the same status as the status-all path", async () => {
    const cwd = mkCwd();
    stamp(cwd, "1.10.0");
    settle(cwd);
    const viaAll = await tick(make(), cwd);
    service!.stopPolling();

    const cwd2 = mkCwd();
    stamp(cwd2, "1.10.0");
    settle(cwd2);
    h.statusAll = async () => UNSUPPORTED;
    const viaList = await tick(make(), cwd2);
    expect(viaList.workflowSchema?.unpinnedChanges).toEqual(["c000"]);
    expect(viaList.workflowSchema).toEqual(viaAll.workflowSchema);
  });

  it("#P8 useWorker false and true produce deeply equal workflowSchema", async () => {
    const cwd = mkCwd({ changes: 2 });
    stamp(cwd, "1.10.0");
    settle(cwd);
    const inProcess = (await tick(make({ useWorker: false }), cwd)).workflowSchema;
    service!.stopPolling();
    const withWorker = (await tick(make({ useWorker: true }), cwd)).workflowSchema;
    expect(inProcess).toMatchObject({ generated: "outdated", unpinnedChanges: ["c000", "c001"] });
    expect(withWorker).toEqual(inProcess);
  });
});

describe("failure handling", () => {
  const rejectingWorker = (opts: PollWorkerPoolOptions): PollWorkerPool =>
    createOpenSpecPollWorkerPool({ ...opts, useWorker: true, size: 1, workerUrlOverride: FIXTURE_WORKER });

  it("#P11 a worker error is covered by the in-process fallback; the tick still broadcasts", async () => {
    const cwd = mkCwd();
    stamp(cwd, "1.10.0");
    settle(cwd);
    make({}, { pollWorkerPoolFactory: rejectingWorker });
    const out = await tick(service!, cwd);
    expect(out.initialized).toBe(true);
    expect(out.workflowSchema).toMatchObject({ generated: "outdated", configured: "pi-spec-driven" });
  });

  it("#P12 a failed computation omits the key (no resurrection), serves none on demand, logs once per failure run", async () => {
    const cwd = mkCwd();
    stamp(cwd, "1.11.0");
    settle(cwd);
    let fail = false;
    const computeStatus = vi.fn(async (req: Parameters<typeof computeSchemaStatusFor>[0]) => {
      if (fail) throw new Error("status boom");
      return computeSchemaStatusFor(req);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    make({}, { pollWorkerPoolFactory: rejectingWorker, workflowSchema: { computeStatus } });

    expect((await tick(service!, cwd)).workflowSchema?.generated).toBe("current"); // previous tick carried it
    fail = true;
    const o1 = await tick(service!, cwd);
    expect("workflowSchema" in o1).toBe(false);
    expect(o1.readiness?.state).toBe("READY");
    expect("workflowSchema" in (service!.getOpenSpecData(cwd) ?? {})).toBe(false); // on-demand state = last broadcast
    for (let i = 2; i <= 4; i++) expect("workflowSchema" in (await tick(service!, cwd))).toBe(false);
    fail = false;
    expect((await tick(service!, cwd)).workflowSchema?.generated).toBe("current"); // tick 5 recovers
    fail = true;
    expect("workflowSchema" in (await tick(service!, cwd))).toBe(false); // tick 6

    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("workflow-schema status failed") && l.includes(cwd));
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).toMatch(/in-process fallback/);
  });

  it("an input-resolution failure (package schemas dir) omits the key and never fails the poll", async () => {
    const cwd = mkCwd();
    stamp(cwd, "1.11.0");
    settle(cwd);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    make({}, {
      workflowSchema: {
        packageSchemasDir: async () => {
          throw new Error("resolver boom");
        },
        userSchemasDirPath: userDir,
      },
    });
    for (let i = 0; i < 2; i++) {
      const out = await tick(service!, cwd);
      expect(out.initialized).toBe(true);
      expect("workflowSchema" in out).toBe(false);
    }
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("workflow-schema status failed"))).toHaveLength(1);
  });

  it("#P13 a newer stamp validates once on the main thread through the shared semaphore", async () => {
    const cwd = mkCwd();
    stamp(cwd, "1.12.0");
    settle(cwd);
    const validates: number[] = [];
    let sem!: DirectoryService["semaphore"];
    const cli = vi.fn(async (call: CliCall) => {
      if (call.op === "validate") validates.push(sem.size()); // size() counts active + queued: > 0 inside a semaphore slot
      return { ok: false as const, stdout: JSON.stringify({ valid: false }), stderr: "", message: "exit 1" };
    });
    make({}, { workflowSchema: { deps: { cli, validateMemo: new Map() } } });
    sem = service!.semaphore;
    for (let i = 0; i < 3; i++) expect((await tick(service!, cwd)).workflowSchema?.generated).toBe("incompatible");
    expect(validates).toHaveLength(1);
    expect(validates[0]).toBeGreaterThan(0);
  });
});

describe("#P14 enqueue order, once per tick, build not gated on the status", () => {
  type Held = { release: () => void; pending: () => boolean };
  function recordingFactory(order: string[], hold: { on: boolean }, held: Held[]) {
    return (opts: PollWorkerPoolOptions): PollWorkerPool => {
      const inner = createOpenSpecPollWorkerPool({ ...opts, useWorker: false });
      return {
        ...inner,
        probe: (r) => (order.push("probe"), inner.probe(r)),
        build: (r) => (order.push("build"), inner.build(r)),
        schemaStatus: (r) => {
          order.push("schemaStatus");
          const p = inner.schemaStatus(r);
          if (!hold.on) return p;
          let open = true;
          const gate = new Promise<void>((res) => {
            held.push({ release: () => ((open = false), res()), pending: () => open });
          });
          return gate.then(() => p);
        },
      };
    };
  }
  const flush = () => new Promise((r) => setTimeout(r, 30));

  it("(a) gate-hit tick: probe before schemaStatus; finalize waits for the held status", async () => {
    const cwd = mkCwd();
    stamp(cwd, "1.11.0");
    settle(cwd);
    const order: string[] = [];
    const hold = { on: false };
    const held: Held[] = [];
    make({ maxConcurrentSpawns: 1 }, { pollWorkerPoolFactory: recordingFactory(order, hold, held) });
    await tick(service!, cwd); // cold
    order.length = 0;
    hold.on = true;
    let done = false;
    const p = tick(service!, cwd).then((o) => ((done = true), o));
    await flush();
    expect(order).toEqual(["probe", "schemaStatus"]);
    expect(done).toBe(false);
    held[0]!.release();
    expect((await p).workflowSchema?.generated).toBe("current");
  });

  it("(b) miss tick: build is enqueued while the status is still pending; finalize completes after release", async () => {
    const cwd = mkCwd();
    stamp(cwd, "1.11.0");
    settle(cwd);
    const order: string[] = [];
    const hold = { on: false };
    const held: Held[] = [];
    make({ maxConcurrentSpawns: 1 }, { pollWorkerPoolFactory: recordingFactory(order, hold, held) });
    await tick(service!, cwd); // cold
    order.length = 0;
    hold.on = true;
    touchFuture(path.join(cwd, "openspec/changes/c000/tasks.md")); // gate miss
    let release!: () => void;
    const cliGate = new Promise<void>((r) => (release = r));
    const base = h.statusAll!;
    h.statusAll = async (c) => {
      await cliGate;
      return base(c);
    };
    let done = false;
    const p = tick(service!, cwd).then((o) => ((done = true), o));
    await flush();
    expect(order).toEqual(["probe", "schemaStatus"]);
    release(); // CLI resolves while the status is still held
    await flush();
    expect(order).toEqual(["probe", "schemaStatus", "build"]);
    expect(held[0]!.pending()).toBe(true);
    expect(done).toBe(false);
    held[0]!.release();
    expect((await p).workflowSchema?.generated).toBe("current");
  });

  it("(c)+(d) the tick detecting --all unsupported enqueues one request; a known-unsupported tick enqueues it before the list spawn", async () => {
    const order: string[] = [];
    const cwd = mkCwd();
    stamp(cwd, "1.11.0");
    settle(cwd);
    h.statusAll = async () => UNSUPPORTED;
    h.list = async () => (order.push("list"), { changes: [{ name: "c000", status: "in-progress", completedTasks: 0, totalTasks: 0 }] });
    make({}, { pollWorkerPoolFactory: recordingFactory(order, { on: false }, []) });
    await tick(service!, cwd);
    expect(order.filter((o) => o === "schemaStatus")).toHaveLength(1); // (c)
    expect(order.indexOf("probe")).toBeLessThan(order.indexOf("schemaStatus"));

    const cwd2 = mkCwd();
    stamp(cwd2, "1.11.0");
    settle(cwd2);
    order.length = 0;
    await tick(service!, cwd2); // `--all` now known unsupported for this CLI version
    expect(order.indexOf("schemaStatus")).toBeGreaterThanOrEqual(0); // (d)
    expect(order.indexOf("schemaStatus")).toBeLessThan(order.indexOf("list"));
    expect(order).not.toContain("probe");
  });
});

describe("#P16 event-loop turn budget", () => {
  it("two 104-change cwds, 20 gate-hit ticks: no poll turn reaches 150 ms and every tick carries workflowSchema", async () => {
    const a = mkCwd({ changes: 104 });
    const b = mkCwd({ changes: 104 });
    for (const c of [a, b]) {
      stamp(c, "1.11.0");
      settle(c);
    }
    const spikes = createEventLoopSpikeMetrics(50);
    make({ maxConcurrentSpawns: 1 }, { eventLoopSpikes: spikes, eventLoopSpikeFloorMs: 150 });
    await Promise.all([tick(service!, a), tick(service!, b)]); // cold
    for (let i = 0; i < 20; i++) {
      for (const out of await Promise.all([tick(service!, a), tick(service!, b)])) {
        expect(out.workflowSchema?.generated).toBe("current");
      }
    }
    const turns = ["dirPollPre", "dirPollGate", "dirPollCli", "dirPollPost"];
    expect(spikes.snapshot().filter((s) => s.turn !== null && turns.includes(s.turn))).toEqual([]);
  });
});
