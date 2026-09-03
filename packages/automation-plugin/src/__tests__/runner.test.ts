/**
 * Runner concurrency-policy tests: skip-drop, queue-defer, parallel.
 * See change: add-automation-plugin.
 */
import { describe, expect, it } from "vitest";
import { createRunner } from "../server/runner.js";
import type { Concurrency, DiscoveredAutomation } from "../shared/automation-types.js";

let counter = 0;
function automation(concurrency: Concurrency, name = "nightly"): DiscoveredAutomation {
  return {
    name,
    scope: "folder",
    dir: `/repo/.pi/automation/${name}`,
    valid: true,
    config: {
      on: { kind: "schedule", cron: "* * * * *" },
      action: { kind: "prompt", prompt: "./prompt.md" },
      model: "@fast",
      mode: "worktree",
      sandbox: "workspace-write",
      concurrency,
    },
  };
}

function makeRunner() {
  const started: string[] = [];
  const runner = createRunner({
    startRun: (a) => {
      const runId = `run-${++counter}-${a.name}`;
      started.push(runId);
      return { runId };
    },
  });
  return { runner, started };
}

describe("runner concurrency", () => {
  it("skip drops an overlapping fire while a run is active", () => {
    const { runner, started } = makeRunner();
    const a = automation("skip");
    runner.fire(a); // starts run 1
    runner.fire(a); // active → dropped
    expect(started).toHaveLength(1);
    expect(runner.queuedCount("folder:nightly")).toBe(0);

    // After the active run completes, a new fire starts again.
    runner.completeRun("folder:nightly");
    runner.fire(a);
    expect(started).toHaveLength(2);
  });

  it("queue defers an overlapping fire and starts it when the active run ends", () => {
    const { runner, started } = makeRunner();
    const a = automation("queue");
    runner.fire(a); // starts run 1
    runner.fire(a); // queued
    expect(started).toHaveLength(1);
    expect(runner.queuedCount("folder:nightly")).toBe(1);

    runner.completeRun("folder:nightly"); // drains queue → starts run 2
    expect(started).toHaveLength(2);
    expect(runner.queuedCount("folder:nightly")).toBe(0);
  });

  it("queue preserves multiple deferred fires in FIFO order", () => {
    const { runner, started } = makeRunner();
    const a = automation("queue");
    runner.fire(a); // run active
    runner.fire(a); // q1
    runner.fire(a); // q2
    expect(runner.queuedCount("folder:nightly")).toBe(2);
    runner.completeRun("folder:nightly"); // start q1
    expect(runner.queuedCount("folder:nightly")).toBe(1);
    runner.completeRun("folder:nightly"); // start q2
    expect(runner.queuedCount("folder:nightly")).toBe(0);
    expect(started).toHaveLength(3);
  });

  it("parallel starts immediately alongside the active run", () => {
    const { runner, started } = makeRunner();
    const a = automation("parallel");
    runner.fire(a);
    runner.fire(a);
    expect(started).toHaveLength(2);
    expect(runner.queuedCount("folder:nightly")).toBe(0);
  });

  it("queued fires retain their own per-fire ctx value (no collapse)", () => {
    const values: unknown[] = [];
    const runner = createRunner({
      startRun: (_a, ctx) => {
        values.push(ctx?.value);
        return { runId: `run-${values.length}` };
      },
    });
    const a = automation("queue");
    runner.fire(a, { firedAt: 1, value: "/spool/a.pdf" }); // starts run 1 (a.pdf)
    runner.fire(a, { firedAt: 2, value: "/spool/b.pdf" }); // queued (b.pdf)
    runner.fire(a, { firedAt: 3, value: "/spool/c.pdf" }); // queued (c.pdf)
    runner.completeRun("folder:nightly"); // drains → run 2 (b.pdf)
    runner.completeRun("folder:nightly"); // drains → run 3 (c.pdf)
    expect(values).toEqual(["/spool/a.pdf", "/spool/b.pdf", "/spool/c.pdf"]);
  });
});

// ── Fire-slot ownership under fan-out (parent releases, not first child) ─────
// See change: add-automation-concurrent-spawn.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { createEngine } from "../server/engine.js";
import { listRuns, readChildRuns } from "../server/run-store.js";

describe("runner fire-slot ownership (fan-out)", () => {
  let repo: string;
  beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), "auto-runner-")); });
  afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });
  const flushSpawn = async () => { await Promise.resolve(); await Promise.resolve(); };

  function fanout(name: string, count: number, concurrency: Concurrency): DiscoveredAutomation {
    const dir = path.join(repo, ".pi", "automation", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "prompt.md"), "do it");
    return {
      name, scope: "folder", dir, valid: true,
      config: {
        on: { kind: "schedule", cron: "* * * * *" },
        action: { kind: "prompt", prompt: "./prompt.md", count },
        model: "@fast", mode: "local", sandbox: "workspace-write", concurrency,
      },
    };
  }
  function makeEngine(calls: any[]) {
    return createEngine({
      spawnSession: async (o) => { calls.push(o); return { success: true, spawnToken: `tok-${calls.length}` }; },
      listScopes: () => [{ base: repo, scope: "folder" }],
      config: () => ({ defaultVisibility: "hidden", retention: 100, defaultModel: "m", scanFolder: true, scanGlobal: false, maxRunAgeMs: 30 * 60 * 1000 }),
      readRoles: () => ({ fast: "m" }),
      warn: () => {},
    });
  }
  const parents = (name: string) => listRuns(repo, name);

  it("X5: a queued fire starts only after the whole occurrence is terminal", () => {
    const engine = makeEngine([]);
    const key = "folder:q";
    const a = fanout("q", 3, "queue");
    engine.runner.fire(a); // parent1 + 3 children
    const p1 = engine.runner.activeRunId(key)!;
    const kids1 = readChildRuns(repo, parents("q").find((r) => r.runId === p1)!);
    kids1.forEach((k, i) => engine.onSessionRegisteredForRun(`a${i}`, k.runId));

    engine.runner.fire(a); // queued while parent1 runs
    expect(engine.runner.queuedCount(key)).toBe(1);
    expect(parents("q")).toHaveLength(1);

    engine.onSessionEnded("a0", "- x"); // first child done — must NOT release the slot
    expect(parents("q")).toHaveLength(1);
    expect(engine.runner.queuedCount(key)).toBe(1);

    engine.onSessionEnded("a1", "- y");
    engine.onSessionEnded("a2", "- z"); // last child → parent1 finalizes → queued starts
    expect(parents("q")).toHaveLength(2);
  });

  it("X7: an overlapping skip fire is dropped and spawns no extra children", async () => {
    const calls: any[] = [];
    const engine = makeEngine(calls);
    const a = fanout("s", 3, "skip");
    engine.runner.fire(a);
    await flushSpawn();
    expect(calls).toHaveLength(3);
    expect(parents("s")).toHaveLength(1);

    engine.runner.fire(a); // parent still running → dropped
    await flushSpawn();
    expect(calls).toHaveLength(3); // no additional spawns
    expect(parents("s")).toHaveLength(1);
  });
});
