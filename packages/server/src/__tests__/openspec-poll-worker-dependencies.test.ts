/**
 * Dependency graph inside the poll build: worker/in-process parity (#E19),
 * the warm-rebuild cost budget (#P1) and the per-rebuild debug line (#X14).
 *
 * See change: add-openspec-change-dependencies.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import fsp from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDependencyInputCache, computeDependencies } from "../openspec/openspec-dependency-inputs.js";
import { probeTrackedPaths } from "../openspec/openspec-poll-fs-helpers.js";
import { buildFromStatusAll, type StatusAllBuildRequest } from "../openspec/openspec-poll-worker.js";
import { createOpenSpecPollWorkerPool } from "../openspec/openspec-poll-worker-pool.js";
import { backdate, mkTmpCwd, renderStatusAll, seedChanges, writeFile } from "./helpers/status-all-fixture.js";

let cwd: string;
let openspecDir: string;

beforeEach(() => {
  clearDependencyInputCache();
  cwd = mkTmpCwd("poll-deps");
  openspecDir = path.join(cwd, "openspec");
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function buildRequest(): Promise<StatusAllBuildRequest> {
  const probeReq = { openspecDir, extras: null, capabilityIds: null };
  const pre = await probeTrackedPaths(probeReq);
  return { cwd, openspecDir, hasOpenspecDir: true, raw: renderStatusAll(cwd), probeReq, pre, cachedChanges: {}, groupAssignments: {} };
}

/** Mixed-source fixture: one declared, one inferred-text, one inferred-capability edge. */
function seedMixedEdges(): void {
  seedChanges(cwd, 4);
  writeFile(cwd, "openspec/changes/c000/dependencies.yaml", "blocked_by:\n  - change: c001\n    reason: api\n");
  writeFile(cwd, "openspec/changes/c000/specs/cap/spec.md", "## MODIFIED Requirements\n");
  writeFile(cwd, "openspec/changes/c001/specs/cap/spec.md", "## ADDED Requirements\n");
  writeFile(cwd, "openspec/changes/c002/specs/cap/spec.md", "nothing to see\n");
  writeFile(cwd, "openspec/changes/c002/proposal.md", "# c2\n\n## Dependencies\n\n- Depends on: `c000`\n");
  writeFile(cwd, "openspec/changes/c003/specs/cap/spec.md", "## MODIFIED Requirements\n");
  backdate(openspecDir);
}

describe("#E19 worker / in-process parity", () => {
  it("identical serialized `dependencies` payloads with useWorker true and false", async () => {
    seedMixedEdges();
    const req = await buildRequest();
    const inproc = createOpenSpecPollWorkerPool({ useWorker: false });
    const a = await inproc.build(req);
    await inproc.dispose();
    const worker = createOpenSpecPollWorkerPool({ useWorker: true, size: 1, timeoutMs: 15_000 });
    let b: Awaited<ReturnType<typeof worker.build>>;
    try {
      b = await worker.build(req);
    } finally {
      await worker.dispose();
    }
    if (a.kind !== "ok" || b.kind !== "ok") throw new Error("expected ok");
    const deps = (r: typeof a) => JSON.stringify(r.data.changes.map((c) => [c.name, c.dependencies]));
    expect(deps(b)).toBe(deps(a));
    expect(a.data.changes.every((c) => c.dependencies)).toBe(true);
    expect(a.capabilityIds).toEqual(["cap"]);
  });
});

describe("#X14 per-rebuild debug line", () => {
  it("emits one line with edge counts by source, issue counts by severity and ms", async () => {
    seedMixedEdges();
    vi.stubEnv("DEBUG", "openspec-poll");
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const out = await buildFromStatusAll(await buildRequest());
    expect(out.kind).toBe("ok");
    const lines = spy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[openspec-deps]"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/changes=4 edges declared=1 inferred-text=1 inferred-capability=1 issues error=0 warning=0 ms=\d/);
  });

  it("stays silent without the debug flag", async () => {
    seedMixedEdges();
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    await buildFromStatusAll(await buildRequest());
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("review: change names are single path segments", () => {
  it("a name that is not a single segment is never used to build a path", async () => {
    writeFile(cwd, "openspec/changes/real/proposal.md", "# real\n");
    // `../outside` from openspec/changes resolves to openspec/outside: plant a file there that would name `real` a blocker.
    writeFile(cwd, "openspec/outside/dependencies.yaml", "blocked_by: [real]\n");
    const touched: string[] = [];
    const orig = fsp.lstat.bind(fsp);
    vi.spyOn(fsp, "lstat").mockImplementation(((p: unknown, ...rest: unknown[]) => {
      touched.push(String(p));
      return (orig as (...a: unknown[]) => unknown)(p, ...rest);
    }) as never);
    const out = await computeDependencies(openspecDir, ["real", "../outside", "a/b", "..", "."]);
    expect(touched.filter((p) => p.includes("outside") || p.includes(`${path.sep}a${path.sep}b`))).toEqual([]);
    expect(out.graph["real"]?.blocks ?? []).toEqual([]);
    expect(Object.keys(out.graph)).toContain("real");
  });
});

describe("review: markdown inputs are opened without following or blocking", () => {
  it.skipIf(process.platform === "win32")("a FIFO swapped in for proposal.md after the lstat does not hang the build", async () => {
    writeFile(cwd, "openspec/changes/swapped/.openspec.yaml", "schema: spec-driven\n");
    const fifo = path.join(cwd, "openspec", "changes", "swapped", "proposal.md");
    execFileSync("mkfifo", [fifo]);
    const orig = fsp.lstat.bind(fsp);
    // The check sees a small regular file (as if the swap happened right after it); the read then meets a FIFO.
    vi.spyOn(fsp, "lstat").mockImplementation((async (p: unknown, ...rest: unknown[]) => {
      const st = (await (orig as (...a: unknown[]) => Promise<import("node:fs").Stats>)(p, ...rest)) as import("node:fs").Stats;
      if (String(p) !== fifo) return st;
      return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { isFile: () => true, isSymbolicLink: () => false, size: 10 });
    }) as never);
    const out = await Promise.race([
      computeDependencies(openspecDir, ["swapped"]),
      new Promise<"blocked">((r) => setTimeout(() => r("blocked"), 3000)),
    ]);
    expect(out).not.toBe("blocked"); // a plain readFile of a FIFO waits for a writer forever
  }, 10_000);
});

describe("#P1 warm rebuild budget", () => {
  /** 100 active changes with a labelled proposal and three deltas each. */
  function seed100(): string[] {
    const names: string[] = [];
    for (let i = 0; i < 100; i++) {
      const name = `chg-${String(i).padStart(3, "0")}`;
      names.push(name);
      const dep = i > 0 ? `- Depends on: \`chg-${String(i - 1).padStart(3, "0")}\`\n` : "";
      const prose = Array.from({ length: 30 }, (_, k) => `Paragraph ${k} mentions \`chg-${String((i + k) % 100).padStart(3, "0")}\` in passing.`).join("\n");
      writeFile(cwd, `openspec/changes/${name}/proposal.md`, `# ${name}\n\n## Dependencies\n\n${dep}\n## Why\n\n${prose}\n`);
      for (const cap of ["alpha", "beta", `own-${i}`]) {
        writeFile(cwd, `openspec/changes/${name}/specs/${cap}/spec.md`, "## MODIFIED Requirements\n\n### Requirement: x\n");
      }
    }
    return names;
  }

  it("without probe mtimes (per-file stats only) a recompute stays well bounded", async () => {
    const names = seed100();
    await computeDependencies(openspecDir, names); // cold, fills the cache
    const times: number[] = [];
    for (let run = 0; run < 20; run++) {
      const file = path.join(openspecDir, "changes", names[run * 3 % 100], "proposal.md");
      fs.appendFileSync(file, `edit ${run}\n`);
      const t0 = performance.now();
      const r = await computeDependencies(openspecDir, names);
      times.push(performance.now() - t0);
      expect(Object.keys(r.graph)).toHaveLength(100);
    }
    times.sort((a, b) => a - b);
    // Fallback path only (the poll always passes the probe's mtimes): one lstat/stat per input file.
    expect((times[9] + times[10]) / 2).toBeLessThan(60);
  });

  it("with the probe's per-change mtimes: median under 20 ms, and unchanged changes cost no per-change syscalls", async () => {
    const names = seed100();
    backdate(openspecDir);
    let probe = await probeTrackedPaths({ openspecDir, extras: null });
    await computeDependencies(openspecDir, names, probe.changes);

    // Nothing moved: only the archive listing and main-spec stats remain.
    const lstat = vi.spyOn(fsp, "lstat");
    const readdir = vi.spyOn(fsp, "readdir");
    await computeDependencies(openspecDir, names, probe.changes);
    expect(lstat).not.toHaveBeenCalled();
    expect(readdir.mock.calls.map((c) => String(c[0]))).toEqual([path.join(openspecDir, "changes", "archive")]);
    vi.restoreAllMocks();

    const times: number[] = [];
    for (let run = 0; run < 20; run++) {
      const file = path.join(openspecDir, "changes", names[run * 3 % 100], "proposal.md");
      fs.appendFileSync(file, `edit ${run}\n`);
      probe = await probeTrackedPaths({ openspecDir, extras: null }); // the gate probe, not part of the budget
      const t0 = performance.now();
      await computeDependencies(openspecDir, names, probe.changes);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect((times[9] + times[10]) / 2).toBeLessThan(20);
  });

  it("an edited input invalidates its change (and only its change)", async () => {
    const names = seed100();
    backdate(openspecDir);
    let probe = await probeTrackedPaths({ openspecDir, extras: null });
    const first = await computeDependencies(openspecDir, names, probe.changes);
    expect(first.graph["chg-005"].blockedBy.map((e) => e.change)).toEqual(["chg-004"]);

    const file = path.join(openspecDir, "changes", "chg-005", "proposal.md");
    fs.writeFileSync(file, "# chg-005\n\n## Dependencies\n\n- Depends on: `chg-001`\n");
    probe = await probeTrackedPaths({ openspecDir, extras: null });
    const second = await computeDependencies(openspecDir, names, probe.changes);
    expect(second.graph["chg-005"].blockedBy.map((e) => e.change)).toEqual(["chg-001"]);
    // The edge lists of every other change are untouched (their waves move with the chain, which is the graph's job).
    expect(second.graph["chg-050"].blockedBy).toEqual(first.graph["chg-050"].blockedBy);
  });
});
