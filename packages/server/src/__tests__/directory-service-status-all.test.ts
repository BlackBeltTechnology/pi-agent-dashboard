/**
 * `openspec status --all` poll path in DirectoryService.
 *
 * One spawn per directory on the gated and force paths (#E17/#E18), the
 * missing-changes short-circuit (#E11), the cwd-level gate decision table
 * (#E12), CLI → server path mapping (#E14), fallback detection (#E15/#E16),
 * whole-call failure retry (#E2, #X1), TOCTOU around the call (#X2–#X5),
 * the enabled gate (#X7) and pending ordering (#F9).
 *
 * The fake CLI renders its envelope from a REAL tmp tree (see
 * `helpers/status-all-fixture.ts`); only the spawn is mocked.
 *
 * See change: use-openspec-status-all.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_OPENSPEC_POLL } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import {
  backdate,
  createFixtureCli,
  type FixtureCli,
  mkTmpCwd,
  seedChanges,
  touchFuture,
  writeFile,
} from "./helpers/status-all-fixture.js";

const h = vi.hoisted(() => ({ cli: null as null | { run: (cwd: string) => Promise<unknown> } }));

vi.mock("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js")>();
  return {
    ...actual,
    pollOpenSpecAsync: vi.fn(async () => ({ initialized: false, changes: [] })),
    runOpenSpecStatusAll: vi.fn((cwd: string) => h.cli!.run(cwd)),
    runOpenSpecList: vi.fn(async () => null),
    runOpenSpecStatus: vi.fn(async () => null),
  };
});
vi.mock("../pi/pi-resource-scanner.js", () => ({
  scanPiResources: vi.fn(async () => ({ local: { extensions: [], skills: [], prompts: [] }, global: { extensions: [], skills: [], prompts: [] }, packages: [] })),
}));
vi.mock("../session/session-discovery.js", () => ({ discoverSessionsForCwd: vi.fn(() => []) }));

import * as poller from "@blackbelt-technology/pi-dashboard-shared/openspec-poller.js";

const prefs = (pinned: string[] = []) =>
  ({
    getPinnedDirectories: () => pinned,
    getOpenSpecUpdateSignature: vi.fn(() => undefined),
    getWorkspaces: vi.fn(() => []),
    flush: vi.fn(),
    dispose: vi.fn(),
  }) as unknown as PreferencesStore;
const sessions = () =>
  ({
    register: vi.fn(),
    unregister: vi.fn(),
    update: vi.fn(),
    get: () => undefined,
    listActive: () => [],
    listAll: () => [],
  }) as unknown as SessionManager;

const listSpy = () => vi.mocked(poller.runOpenSpecList);
const statusSpy = () => vi.mocked(poller.runOpenSpecStatus);
const allSpy = () => vi.mocked(poller.runOpenSpecStatusAll);
const legacySpy = () => vi.mocked(poller.pollOpenSpecAsync);

describe("DirectoryService — openspec status --all path", () => {
  let cwd: string;
  let cli: FixtureCli;
  let service: DirectoryService;
  let version: string | null;
  const cleanup: string[] = [];

  function make(extra: Partial<typeof DEFAULT_OPENSPEC_POLL> = {}, opts: Record<string, unknown> = {}): DirectoryService {
    service = createDirectoryService(
      prefs(),
      sessions(),
      { ...DEFAULT_OPENSPEC_POLL, useWorker: false, ...extra },
      { openspecVersionResolver: async () => version, ...opts },
    );
    return service;
  }
  const data = (): OpenSpecData => service.getOpenSpecData(cwd) as OpenSpecData;

  beforeEach(() => {
    vi.clearAllMocks();
    version = "1.11.0";
    cwd = mkTmpCwd("ds-all");
    cleanup.push(cwd);
    cli = createFixtureCli();
    h.cli = cli;
  });
  afterEach(() => {
    service?.stopPolling();
    for (const d of cleanup.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  describe("one spawn per directory (#E17, #E18)", () => {
    it("#E18 gated: cold poll = 1 spawn; no-op tick = 0; one edited tasks.md = 1 spawn, 0 list, 0 status", async () => {
      seedChanges(cwd, 102);
      backdate(path.join(cwd, "openspec"));
      make();

      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1);
      expect(data().initialized).toBe(true);
      expect(data().changes).toHaveLength(102);

      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1); // gate hit

      fs.writeFileSync(path.join(cwd, "openspec/changes/c050/tasks.md"), "- [x] a\n- [x] b\n- [x] c\n");
      touchFuture(path.join(cwd, "openspec/changes/c050/tasks.md"));
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(2);
      expect(listSpy()).not.toHaveBeenCalled();
      expect(statusSpy()).not.toHaveBeenCalled();
      const c050 = data().changes.find((c) => c.name === "c050")!;
      expect([c050.completedTasks, c050.totalTasks, c050.status]).toEqual([3, 3, "complete"]);
    });

    it("#E17 force refresh = exactly 1 spawn, bypassing the gate", async () => {
      seedChanges(cwd, 102);
      make();
      await service.pollDirectoryGated(cwd);
      cli.calls = 0;
      await service.refreshOpenSpec(cwd);
      expect(cli.calls).toBe(1);
      expect(statusSpy()).not.toHaveBeenCalled();
      expect(data().changes).toHaveLength(102);
    });

    it("#E17 a failing force refresh spawns once, never a second process, never the legacy fan-out", async () => {
      seedChanges(cwd, 3);
      make();
      await service.pollDirectoryGated(cwd);
      cli.calls = 0;
      cli.failNextWith = {
        stdout: JSON.stringify({ changes: [], root: null, status: [{ severity: "error", code: "invalid_store_pointer", message: "x" }] }),
        stderr: "",
        exitCode: 1,
      };
      const out = await service.refreshOpenSpec(cwd);
      expect(cli.calls).toBe(1);
      expect(out.initialized).toBe(false);
      expect(out.changes).toEqual([]);
      expect(out.readiness).toMatchObject({ state: "BROKEN", reason: "cli-failed" });
      expect(legacySpy()).not.toHaveBeenCalled();
      expect(listSpy()).not.toHaveBeenCalled();
      expect(statusSpy()).not.toHaveBeenCalled();
    });

    it("#E2 whole-call failure retries exactly once more on the next gated tick, then recovers", async () => {
      seedChanges(cwd, 3);
      make();
      cli.failNextWith = { stdout: JSON.stringify({ changes: [], root: null }), stderr: "", exitCode: 1 };
      const first = await service.pollDirectoryGated(cwd);
      expect(first).toMatchObject({ initialized: false, changes: [] });
      expect(cli.calls).toBe(1);
      const second = await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(2);
      expect(second.initialized).toBe(true);
      expect(second.changes).toHaveLength(3);
    });

    it("#E1 a broken change does not blank the directory: error badge data, others intact", async () => {
      seedChanges(cwd, 3);
      writeFile(cwd, "openspec/changes/c001/.openspec.yaml", "schema: [unclosed\n");
      make();
      const out = await service.pollDirectoryGated(cwd);
      expect(out.initialized).toBe(true);
      expect(out.changes).toHaveLength(3);
      const bad = out.changes.find((c) => c.name === "c001")!;
      expect(bad.error).toEqual({ code: "change_error", message: "Invalid YAML in metadata file" });
      expect(bad.artifacts).toEqual([]);
      expect(bad.totalTasks).toBe(2); // top-level tasks.md still counted
      expect(out.changes.filter((c) => c.error)).toHaveLength(1);
    });

    it("artifacts are canonical on both paths (#E9) and changes newest-first (#E10)", async () => {
      seedChanges(cwd, 3);
      backdate(path.join(cwd, "openspec"), 60_000);
      touchFuture(path.join(cwd, "openspec/changes/c001/tasks.md"), 5_000);
      cli.options.extraArtifacts = { dependencies: "dependencies.yaml" };
      make();
      const gated = await service.pollDirectoryGated(cwd);
      expect(gated.changes.map((c) => c.name)).toEqual(["c001", "c000", "c002"]);
      for (const c of gated.changes) {
        expect(c.artifacts.map((a) => a.id)).toEqual(["proposal", "design", "specs", "tasks", "dependencies"]);
      }
      const forced = await service.refreshOpenSpec(cwd);
      expect(forced.changes[0].artifacts.map((a) => a.id)).toEqual(["proposal", "design", "specs", "tasks", "dependencies"]);
    });
  });

  it("#E11 openspec/ without changes/ spawns nothing and reports missing-changes-dir", async () => {
    fs.mkdirSync(path.join(cwd, "openspec"), { recursive: true });
    make();
    const gated = await service.pollDirectoryGated(cwd);
    const forced = await service.refreshOpenSpec(cwd);
    expect(cli.calls).toBe(0);
    expect(listSpy()).not.toHaveBeenCalled();
    for (const d of [gated, forced]) {
      expect(d.readiness).toMatchObject({ state: "BROKEN", reason: "missing-changes-dir" });
    }
  });

  describe("#E12 gate decision table (next gated tick spawn count)", () => {
    type Row = { name: string; setup?: () => void; mutate: () => void; expected: 0 | 1 };
    const rows = (): Row[] => [
      {
        name: "in-place tasks.md edit",
        mutate: () => touchFuture(path.join(cwd, "openspec/changes/c001/tasks.md")),
        expected: 1,
      },
      {
        name: "first creation of dependencies.yaml (non-glob output)",
        mutate: () => writeFile(cwd, "openspec/changes/c001/dependencies.yaml", "deps: []\n"),
        expected: 1,
      },
      {
        name: ".openspec.yaml in-place edit",
        setup: () => writeFile(cwd, "openspec/changes/c001/.openspec.yaml", "schema: spec-driven\n"),
        mutate: () => touchFuture(path.join(cwd, "openspec/changes/c001/.openspec.yaml")),
        expected: 1,
      },
      {
        name: "config.yaml in-place edit",
        setup: () => writeFile(cwd, "openspec/config.yaml", "schema: spec-driven\n"),
        mutate: () => touchFuture(path.join(cwd, "openspec/config.yaml")),
        expected: 1,
      },
      {
        name: "config.yaml delete (not the newest file)",
        setup: () => writeFile(cwd, "openspec/config.yaml", "schema: spec-driven\n"),
        mutate: () => fs.rmSync(path.join(cwd, "openspec/config.yaml")),
        expected: 1,
      },
      {
        name: "schemas/foo → schemas/bar rename",
        setup: () => writeFile(cwd, "openspec/schemas/foo/schema.yaml", "name: foo\n"),
        mutate: () => fs.renameSync(path.join(cwd, "openspec/schemas/foo"), path.join(cwd, "openspec/schemas/bar")),
        expected: 1,
      },
      {
        name: "first file in an empty nested dir under a glob prefix",
        setup: () => fs.mkdirSync(path.join(cwd, "openspec/changes/c001/specs/newcap"), { recursive: true }),
        mutate: () => writeFile(cwd, "openspec/changes/c001/specs/newcap/spec.md", "## ADDED Requirements\n"),
        expected: 1,
      },
      {
        name: "README.md in-place edit (not a tracked output)",
        setup: () => writeFile(cwd, "openspec/changes/c001/README.md", "hi\n"),
        mutate: () => touchFuture(path.join(cwd, "openspec/changes/c001/README.md")),
        expected: 0,
      },
      { name: "no mutation", mutate: () => {}, expected: 0 },
    ];

    it.each(rows().map((r) => r.name))("%s", async (rowName) => {
      const row = rows().find((r) => r.name === rowName)!;
      seedChanges(cwd, 3);
      cli.options.extraArtifacts = { dependencies: "dependencies.yaml" };
      row.setup?.();
      backdate(path.join(cwd, "openspec"));
      make();
      await service.pollDirectoryGated(cwd); // warm
      await service.pollDirectoryGated(cwd); // settle: stamps now over the full tracked set
      cli.calls = 0;
      row.mutate();
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(row.expected);
    });

    it("changeDetection 'always' spawns every tick", async () => {
      seedChanges(cwd, 2);
      make({ changeDetection: "always" });
      await service.pollDirectoryGated(cwd);
      await service.pollDirectoryGated(cwd);
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(3);
    });
  });

  it("#E14 a symlinked server cwd maps CLI paths onto the canonical openspec/ and the gate trips", async () => {
    seedChanges(cwd, 2);
    cli.options.extraArtifacts = { dependencies: "dependencies.yaml" };
    writeFile(cwd, "openspec/changes/c000/dependencies.yaml", "deps: []\n");
    backdate(path.join(cwd, "openspec"));
    const link = `${cwd}-link`;
    fs.symlinkSync(cwd, link);
    cleanup.push(link);
    cwd = link; // the server sees the alias; the fake CLI emits canonical paths
    make();
    await service.pollDirectoryGated(link);
    await service.pollDirectoryGated(link);
    cli.calls = 0;
    // In-place edit of an output that is only in the extras set (dir mtime does not move).
    touchFuture(path.join(fs.realpathSync(link), "openspec/changes/c000/dependencies.yaml"));
    await service.pollDirectoryGated(link);
    expect(cli.calls).toBe(1);
  });

  describe("fallback when --all is unsupported (#E15, #E16)", () => {
    const unsupported = { stdout: "", stderr: "error: unknown option '--all'", exitCode: 1 };

    function oldCli() {
      cli.failNextWith = undefined;
      h.cli = {
        run: async () => {
          cli.calls++;
          return unsupported;
        },
      };
      listSpy().mockResolvedValue({
        changes: ["a", "b", "c"].map((name) => ({ name, status: "in-progress", completedTasks: 0, totalTasks: 1 })),
      } as never);
      statusSpy().mockResolvedValue({ artifacts: [{ id: "proposal", status: "done" }], isComplete: false } as never);
    }

    it("#E16 the first detecting poll continues on the fallback in the same poll and broadcasts data", async () => {
      seedChanges(cwd, 3);
      oldCli();
      // Cold bootstrap path: refreshOpenSpec (session-bootstrap) = force.
      const out = await make().refreshOpenSpec(cwd);
      expect(out.initialized).toBe(true);
      expect(out.changes).toHaveLength(3);
      expect(out.readiness).not.toMatchObject({ reason: "cli-failed" });
      expect(cli.calls).toBe(1); // exactly one `--all` attempt
      expect(listSpy()).toHaveBeenCalledTimes(1);
      expect(statusSpy()).toHaveBeenCalledTimes(3); // force fallback = per-change status

      // Later gated ticks never retry `--all` while the version is unchanged.
      cli.calls = 0;
      const gated = await service.pollDirectoryGated(cwd);
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(0);
      expect(gated.changes).toHaveLength(3); // served from the fallback path's own gate
    });

    it("#E15 a changed package version re-tries --all (upgrade picked up)", async () => {
      seedChanges(cwd, 3);
      oldCli();
      make();
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1);
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1); // unchanged version: no retry

      version = "1.12.0";
      h.cli = cli; // the upgraded CLI supports `--all`
      cli.calls = 0;
      const out = await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1);
      expect(out.initialized).toBe(true);
      expect(out.changes).toHaveLength(3);
    });

    it("#E15 null version: a force refresh that finds `--all` working clears the verdict (no path flip-flop)", async () => {
      seedChanges(cwd, 3);
      version = null;
      oldCli();
      make();
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1); // verdict cached for the process
      h.cli = cli; // the CLI was upgraded in place; force refresh re-evaluates
      cli.calls = 0;
      await service.refreshOpenSpec(cwd);
      expect(cli.calls).toBe(1);
      await service.pollDirectoryGated(cwd); // the next gated tick must stay on `--all`
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1); // gate hit on the `--all` cache, no fallback switch, no retry
      expect(data().changes).toHaveLength(3);
    });

    it("#E15 unresolvable version: cached for the process, retried on force refresh", async () => {
      seedChanges(cwd, 3);
      version = null;
      oldCli();
      make();
      await service.pollDirectoryGated(cwd);
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1);
      await service.refreshOpenSpec(cwd);
      expect(cli.calls).toBe(2); // force re-evaluates
    });
  });

  it("#X1 a timed-out CLI call is a whole-call failure; the next tick spawns once", async () => {
    seedChanges(cwd, 2);
    make();
    cli.failNextWith = { stdout: "", stderr: "", exitCode: null, failure: "timeout" };
    const out = await service.pollDirectoryGated(cwd);
    expect(out).toMatchObject({ initialized: false, changes: [] });
    expect(out.readiness).toMatchObject({ state: "BROKEN", reason: "cli-failed" });
    cli.calls = 0;
    const next = await service.pollDirectoryGated(cwd);
    expect(cli.calls).toBe(1);
    expect(next.initialized).toBe(true);
  });

  describe("TOCTOU around the call (#X2–#X5)", () => {
    beforeEach(() => {
      seedChanges(cwd, 3);
      backdate(path.join(cwd, "openspec"));
    });

    it("#X2 a write during the call is discarded for that change only; the next tick re-polls", async () => {
      make();
      await service.pollDirectoryGated(cwd);
      await service.pollDirectoryGated(cwd);
      const prev = data().changes.find((c) => c.name === "c001")!;
      expect(prev.totalTasks).toBe(2);

      const foo = path.join(cwd, "openspec/changes/c001/tasks.md");
      const bar = path.join(cwd, "openspec/changes/c002/tasks.md");
      for (const f of [foo, bar]) {
        fs.writeFileSync(f, "- [x] a\n- [x] b\n- [x] c\n");
        touchFuture(f, 120_000);
      }
      cli.options.duringCall = () => {
        cli.options.duringCall = undefined;
        touchFuture(foo, 180_000); // written while the CLI runs
      };
      cli.calls = 0;
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1);
      const c001 = data().changes.find((c) => c.name === "c001")!;
      const c002 = data().changes.find((c) => c.name === "c002")!;
      expect(c001.totalTasks).toBe(2); // previous entry preserved
      expect(c002.totalTasks).toBe(3); // others updated
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(2); // racy change re-polled
      expect(data().changes.find((c) => c.name === "c001")!.totalTasks).toBe(3);
    });

    it("#X3 a change deleted during the call is absent from this and later broadcasts", async () => {
      make();
      await service.pollDirectoryGated(cwd);
      cli.options.duringCall = () => {
        cli.options.duringCall = undefined;
        fs.rmSync(path.join(cwd, "openspec/changes/c002"), { recursive: true });
      };
      touchFuture(path.join(cwd, "openspec/changes/c000/tasks.md"));
      const out = await service.pollDirectoryGated(cwd);
      expect(out.changes.map((c) => c.name)).not.toContain("c002");
      const later = await service.pollDirectoryGated(cwd);
      expect(later.changes.map((c) => c.name)).not.toContain("c002");
    });

    it("#X4 a change created between probe and spawn is applied, re-polled once, then stable", async () => {
      make();
      await service.pollDirectoryGated(cwd);
      await service.pollDirectoryGated(cwd);
      touchFuture(path.join(cwd, "openspec/changes/c000/tasks.md"));
      cli.options.beforeRender = () => {
        cli.options.beforeRender = undefined;
        writeFile(cwd, "openspec/changes/new/proposal.md", "# n\n");
      };
      cli.calls = 0;
      const out = await service.pollDirectoryGated(cwd);
      expect(out.changes.map((c) => c.name)).toContain("new");
      expect(cli.calls).toBe(1);
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(2); // exactly one more spawn
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(2); // stabilized
    });

    it("#X5 a cwd-level edit during the call keeps the cwd stamp back; the next tick spawns", async () => {
      make();
      await service.pollDirectoryGated(cwd);
      await service.pollDirectoryGated(cwd);
      touchFuture(path.join(cwd, "openspec/changes/c000/tasks.md"));
      cli.options.duringCall = () => {
        cli.options.duringCall = undefined;
        writeFile(cwd, "openspec/config.yaml", "schema: spec-driven\n");
      };
      cli.calls = 0;
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1);
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(2);
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(2);
    });
  });

  it("#X7 openspec.enabled=false spawns nothing on a tick or on refresh", async () => {
    seedChanges(cwd, 5);
    make({ enabled: false });
    await service.pollDirectoryGated(cwd);
    await service.refreshOpenSpec(cwd);
    expect(await service.refreshOpenSpecGated(cwd)).toBeNull();
    expect(cli.calls).toBe(0);
    expect(listSpy()).not.toHaveBeenCalled();
    expect(statusSpy()).not.toHaveBeenCalled();
    expect(allSpy()).not.toHaveBeenCalled();
  });

  it("#F9 pending:true is broadcast before the probe is dispatched, then the final payload", async () => {
    seedChanges(cwd, 2);
    const order: string[] = [];
    const realReaddir = fs.promises.readdir;
    const readdirSpy = vi.spyOn(fs.promises, "readdir").mockImplementation(((p: unknown, ...rest: unknown[]) => {
      if (String(p).endsWith(`${path.sep}changes`)) order.push("probe");
      return (realReaddir as (...a: unknown[]) => unknown)(p, ...rest);
    }) as never);
    try {
      make();
      service.startPolling((_cwd, d) => order.push(d.pending ? "pending" : d.initialized ? "final" : "other"));
      await service.pollDirectoryGated(cwd);
    } finally {
      readdirSpy.mockRestore();
    }
    expect(order.indexOf("pending")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("pending")).toBeLessThan(order.indexOf("probe"));
  });
});
