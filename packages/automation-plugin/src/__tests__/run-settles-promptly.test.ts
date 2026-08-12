/**
 * Run-lifecycle settling regressions (real engine, real run-store, injected I/O).
 *
 * The defect these lock down: a run whose action was never delivered stayed
 * `running` until the 30-minute max-age reaper, holding the automation's
 * `concurrency: skip` slot the whole time, so the schedule starved and runs
 * accumulated. Assertions are on the on-disk run records the engine wrote.
 * See change: fix-automation-stamp-correlation.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../server/engine.js";
import { listRuns } from "../server/run-store.js";
import type { DiscoveredAutomation } from "../shared/automation-types.js";

const UNDELIVERED_MS = 60_000;
const MAX_AGE_MS = 30 * 60 * 1000;

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "auto-settle-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

/** A prompt automation with `concurrency: skip` — the shape that starves. */
function automation(name: string): DiscoveredAutomation {
  const dir = path.join(repo, ".pi", "automation", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "prompt.md"), "do the thing");
  return {
    name,
    scope: "folder",
    dir,
    valid: true,
    config: {
      on: { kind: "schedule", cron: "* * * * *" },
      action: { kind: "prompt", prompt: "./prompt.md" },
      model: "anthropic/claude-haiku-4-5",
      mode: "local",
      sandbox: "workspace-write",
      concurrency: "skip",
    },
  };
}

function makeEngine() {
  let now = 1_000_000;
  const aborted: Array<{ sessionId?: string; spawnToken?: string }> = [];
  let spawns = 0;
  const engine = createEngine({
    spawnSession: async () => {
      spawns += 1;
      return { success: true, spawnToken: `tok-${spawns}` };
    },
    abortSpawnedRun: async (args) => {
      aborted.push(args);
      return true;
    },
    listScopes: () => [{ base: repo, scope: "folder" }],
    config: () => ({
      defaultVisibility: "hidden",
      retention: 100,
      defaultModel: "anthropic/claude-haiku-4-5",
      scanFolder: true,
      scanGlobal: false,
      maxRunAgeMs: MAX_AGE_MS,
      undeliveredRunTimeoutMs: UNDELIVERED_MS,
    }),
    now: () => now,
    warn: () => {},
  });
  return {
    engine,
    aborted,
    advance: (ms: number) => {
      now += ms;
    },
    spawnCount: () => spawns,
  };
}

const runs = () => listRuns(repo);
const byId = (runId: string) => runs().find((r) => r.runId === runId);

describe("a completed run settles without waiting for max age", () => {
  it("reaches done on its terminal signal and is never touched by a later sweep", async () => {
    const h = makeEngine();
    const a = automation("nightly");

    const started = h.engine.startRunFor(a)!;
    await Promise.resolve();
    expect(byId(started.runId)?.status).toBe("running");

    // Session registers with the run's own stamp, then ends.
    h.engine.onSessionRegisteredForRun("sess-1", started.runId);
    h.engine.onSessionEnded("sess-1", "- found 3 things");

    const rec = byId(started.runId)!;
    expect(rec.status).toBe("done");
    expect(rec.error).toBeUndefined();

    // Well past BOTH bounds: an already-settled run must stay settled.
    h.advance(MAX_AGE_MS + UNDELIVERED_MS + 1);
    h.engine.reapStaleRuns();

    expect(byId(started.runId)?.status).toBe("done");
    expect(byId(started.runId)?.error).toBeUndefined();
  });
});

describe("two consecutive idle runs both settle", () => {
  it("the first never blocks the second under concurrency: skip", async () => {
    const h = makeEngine();
    const a = automation("nightly");

    h.engine.runner.fire(a);
    await Promise.resolve();
    const first = runs()[0]!;
    expect(h.engine.runner.activeRunId("folder:nightly")).toBe(first.runId);

    h.engine.onSessionRegisteredForRun("sess-1", first.runId);
    h.engine.onSessionEnded("sess-1", "- first result");
    expect(byId(first.runId)?.status).toBe("done");
    // Slot released by the finalize, not by a reaper.
    expect(h.engine.runner.activeRunId("folder:nightly")).toBeNull();

    h.advance(1_000);
    h.engine.runner.fire(a);
    await Promise.resolve();
    const second = runs().find((r) => r.runId !== first.runId)!;
    expect(second).toBeDefined();

    h.engine.onSessionRegisteredForRun("sess-2", second.runId);
    h.engine.onSessionEnded("sess-2", "- second result");

    expect(runs().map((r) => r.status)).toEqual(["done", "done"]);
    expect(runs().every((r) => r.error === undefined)).toBe(true);
    expect(h.spawnCount()).toBe(2);
  });
});

describe("a cold-start run that loses its lifecycle race cannot starve the schedule", () => {
  it("is reaped on the short undelivered bound, freeing the slot for the next fire", async () => {
    const h = makeEngine();
    const a = automation("nightly");

    h.engine.runner.fire(a);
    await Promise.resolve();
    const wedged = runs()[0]!;
    expect(wedged.status).toBe("running");

    // Its stamped session never registers — nothing will ever name this run.
    h.advance(UNDELIVERED_MS - 1);
    h.engine.reapStaleRuns();
    expect(byId(wedged.runId)?.status).toBe("running");

    h.advance(2);
    h.engine.reapStaleRuns();

    const reaped = byId(wedged.runId)!;
    expect(reaped.status).toBe("error");
    expect(reaped.error).toBe("run action never delivered");
    // Reaped well inside the max-age backstop.
    expect(reaped.endedAt! - reaped.startedAt).toBeLessThan(MAX_AGE_MS);
    // The orphaned rpc session is terminated, not left running.
    expect(h.aborted).toEqual([{ spawnToken: "tok-1" }]);

    // The slot is free: the next scheduled tick starts a real run.
    expect(h.engine.runner.activeRunId("folder:nightly")).toBeNull();
    h.engine.runner.fire(a);
    await Promise.resolve();
    const next = runs().find((r) => r.runId !== wedged.runId)!;
    expect(next.status).toBe("running");

    h.engine.onSessionRegisteredForRun("sess-2", next.runId);
    h.engine.onSessionEnded("sess-2", "- recovered");
    expect(byId(next.runId)?.status).toBe("done");
  });

  it("leaves a DELIVERED long-running run alone past the undelivered bound", async () => {
    const h = makeEngine();
    const a = automation("nightly");

    const started = h.engine.startRunFor(a)!;
    await Promise.resolve();
    h.engine.onSessionRegisteredForRun("sess-1", started.runId);

    h.advance(UNDELIVERED_MS * 5);
    h.engine.reapStaleRuns();

    expect(byId(started.runId)?.status).toBe("running");
    expect(h.aborted).toEqual([]);
  });
});
