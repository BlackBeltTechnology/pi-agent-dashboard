/**
 * Engine integration tests (injected I/O):
 *  - prompt + skill spawn paths (§5.2)
 *  - status transitions + result.md capture (§5.4)
 *  - effective visibility passed on the spawn stamp (§5.x)
 * See change: add-automation-plugin.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionRegistry } from "../server/action-registry.js";
import { buildRunDispatch, buildRunPrompt, createEngine, effectiveVisibility } from "../server/engine.js";
import { listRuns, readChildRuns, startRun as storeStartRun } from "../server/run-store.js";
import type { DiscoveredAutomation, RunRecord } from "../shared/automation-types.js";

/** The single parent occurrence for `name` (fan-out model: one fire = one parent). */
function parentRun(repoBase: string, name: string, runId?: string): RunRecord {
  const runs = listRuns(repoBase, name);
  return (runId ? runs.find((r) => r.runId === runId) : runs[0])!;
}
/** Child records of the parent occurrence for `name`. */
function children(repoBase: string, name: string, runId?: string): RunRecord[] {
  return readChildRuns(repoBase, parentRun(repoBase, name, runId));
}

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "auto-engine-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function promptAutomation(name: string, promptBody: string): DiscoveredAutomation {
  const dir = path.join(repo, ".pi", "automation", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "prompt.md"), promptBody);
  fs.writeFileSync(
    path.join(dir, "automation.yaml"),
    `on: { kind: schedule, cron: "* * * * *" }\naction: { kind: prompt, prompt: ./prompt.md }\nmodel: "@fast"\nmode: local\n`,
  );
  return {
    name,
    scope: "folder",
    dir,
    valid: true,
    config: {
      on: { kind: "schedule", cron: "* * * * *" },
      action: { kind: "prompt", prompt: "./prompt.md" },
      model: "@fast",
      mode: "local",
      sandbox: "workspace-write",
      concurrency: "skip",
    },
  };
}

function skillAutomation(name: string): DiscoveredAutomation {
  const dir = path.join(repo, ".pi", "automation", name);
  fs.mkdirSync(dir, { recursive: true });
  return {
    name,
    scope: "folder",
    dir,
    valid: true,
    config: {
      on: { kind: "schedule", cron: "* * * * *" },
      action: { kind: "skill", skill: "$recent-code-bugfix" },
      model: "anthropic/claude-sonnet-4-5",
      mode: "local",
      sandbox: "workspace-write",
      concurrency: "skip",
      visibility: "shown",
    },
  };
}

function makeEngine(spawnCalls: any[], roles: Record<string, string> = { fast: "anthropic/claude-haiku-4-5" }) {
  return createEngine({
    spawnSession: async (opts) => {
      spawnCalls.push(opts);
      return { success: true, spawnToken: `tok-${spawnCalls.length}` };
    },
    listScopes: () => [{ base: repo, scope: "folder" }],
    config: () => ({
      defaultVisibility: "hidden",
      retention: 100,
      defaultModel: "anthropic/claude-sonnet-4-5",
      scanFolder: true,
      scanGlobal: false,
      maxRunAgeMs: 30 * 60 * 1000,
    }),
    readRoles: () => roles,
    warn: () => {},
  });
}

describe("buildRunPrompt", () => {
  it("reads prompt.md for prompt actions", () => {
    const a = promptAutomation("p", "Audit the changelog for omissions.");
    expect(buildRunPrompt(a)).toBe("Audit the changelog for omissions.");
  });
  it("emits the $skill token for skill actions", () => {
    expect(buildRunPrompt(skillAutomation("s"))).toBe("$recent-code-bugfix");
  });
  it("delegates to a registered plugin action's buildPrompt with the payload", () => {
    const reg = new ActionRegistry();
    reg.register({
      id: "flows.run",
      source: "flows",
      label: "Run",
      buildPrompt: ({ payload }) => `/flows run ${payload.flow as string} :: ${payload.task as string}`,
    });
    const a: DiscoveredAutomation = {
      name: "f",
      scope: "folder",
      dir: "/tmp/x/.pi/automation/f",
      valid: true,
      config: {
        on: { kind: "schedule", cron: "* * * * *" },
        action: { kind: "flows.run", payload: { flow: "nightly", task: "build" } },
        model: "@fast",
        mode: "local",
        sandbox: "workspace-write",
        concurrency: "skip",
      },
    };
    expect(buildRunPrompt(a, reg)).toBe("/flows run nightly :: build");
  });
});

describe("buildRunDispatch", () => {
  function flowAutomation(): DiscoveredAutomation {
    return {
      name: "f", scope: "folder", dir: "/tmp/x/.pi/automation/f", valid: true,
      config: {
        on: { kind: "schedule", cron: "* * * * *" },
        action: { kind: "flows.run", payload: { flow: "test:x", task: "go" } },
        model: "@fast", mode: "local", sandbox: "workspace-write", concurrency: "skip",
      },
    };
  }

  it("resolves an event dispatch for an event action", () => {
    const reg = new ActionRegistry();
    reg.register({
      id: "flows.run", source: "flows", label: "Run",
      buildEvent: ({ payload }) => ({ eventType: "flow:run", data: { flowName: payload.flow, task: payload.task } }),
    });
    expect(buildRunDispatch(flowAutomation(), reg)).toEqual({
      kind: "event", eventType: "flow:run", data: { flowName: "test:x", task: "go" },
    });
  });

  it("resolves a prompt dispatch for a prompt action", () => {
    const a = promptAutomation("p", "do the thing");
    expect(buildRunDispatch(a)).toEqual({ kind: "prompt", text: "do the thing" });
  });

  it("emits nothing (empty prompt) when buildEvent returns null", () => {
    const reg = new ActionRegistry();
    reg.register({ id: "flows.run", source: "flows", label: "Run", buildEvent: () => null });
    expect(buildRunDispatch(flowAutomation(), reg)).toEqual({ kind: "prompt", text: "" });
  });
});

describe("effectiveVisibility", () => {
  it("uses the per-automation override when present", () => {
    expect(effectiveVisibility(skillAutomation("s"), "hidden")).toBe("shown");
  });
  it("falls back to the settings default", () => {
    expect(effectiveVisibility(promptAutomation("p", "x"), "hidden")).toBe("hidden");
  });
});

describe("engine run lifecycle", () => {
  it("prompt path: spawns with resolved model + hidden stamp, writes running record", () => {
    const calls: any[] = [];
    const engine = makeEngine(calls);
    const a = promptAutomation("nightly", "Find regressions.");
    const r = engine.startRunFor(a);
    expect(r).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("anthropic/claude-haiku-4-5"); // @fast resolved
    expect(calls[0].automationRun).toMatchObject({ name: "nightly", visibility: "hidden" });

    const runs = listRuns(repo, "nightly");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("running");
  });

  it("forwards mode + sandbox to the spawn hook", () => {
    const calls: any[] = [];
    const engine = makeEngine(calls);
    // promptAutomation uses mode: local, sandbox: workspace-write.
    engine.startRunFor(promptAutomation("nightly", "x"));
    expect(calls[0].mode).toBe("local");
    expect(calls[0].sandbox).toBe("workspace-write");
    // skill fixture uses worktree by default? no — both use local; assert the
    // value flows through verbatim from config.
    const calls2: any[] = [];
    const engine2 = makeEngine(calls2);
    const base = skillAutomation("wt");
    const wt: DiscoveredAutomation = { ...base, config: { ...base.config!, mode: "worktree", sandbox: "read-only" } };
    engine2.startRunFor(wt);
    expect(calls2[0].mode).toBe("worktree");
    expect(calls2[0].sandbox).toBe("read-only");
  });

  it("skill path: spawns with bare model + shown stamp", () => {
    const calls: any[] = [];
    const engine = makeEngine(calls);
    engine.startRunFor(skillAutomation("bugs"));
    expect(calls[0].model).toBe("anthropic/claude-sonnet-4-5");
    expect(calls[0].automationRun.visibility).toBe("shown");
  });

  it("captures result.md + done status on session end", () => {
    const calls: any[] = [];
    const engine = makeEngine(calls);
    const a = promptAutomation("nightly", "Find regressions.");
    const { runId } = engine.startRunFor(a)!;

    // Simulate the (single) child session registering + ending.
    engine.onSessionRegistered("sess-1", repo);
    engine.onSessionEnded("sess-1", "Found 1 regression in auth.");

    const parent = parentRun(repo, "nightly", runId);
    expect(parent.status).toBe("done");
    const child = readChildRuns(repo, parent)[0]!;
    const md = fs.readFileSync(path.join(child.dir, "result.md"), "utf-8");
    expect(md).toContain("Found 1 regression");
  });

  it("empty findings auto-archive on session end (child archived)", () => {
    const calls: any[] = [];
    const engine = makeEngine(calls);
    engine.startRunFor(promptAutomation("nightly", "x"));
    engine.onSessionRegistered("sess-1", repo);
    engine.onSessionEnded("sess-1", "   ");
    expect(children(repo, "nightly")[0]!.archived).toBe(true);
    expect(parentRun(repo, "nightly").status).toBe("done");
  });

  it("unresolved @role → spawn with default model + run recorded error on end", () => {
    const calls: any[] = [];
    const engine = makeEngine(calls, {}); // no roles → @fast unresolved
    const a = promptAutomation("nightly", "x");
    engine.startRunFor(a);
    expect(calls[0].model).toBe("anthropic/claude-sonnet-4-5"); // fell back to default
    engine.onSessionRegistered("sess-1", repo);
    engine.onSessionEnded("sess-1", "result");
    expect(parentRun(repo, "nightly").status).toBe("error");
    expect(children(repo, "nightly")[0]!.error).toContain("@fast");
  });

  it("isolates concurrent runs in the same cwd (no context overwrite)", () => {
    // Two parallel runs of the same automation share a cwd (mode: local).
    // Each must keep its own pending context so register/end bind correctly.
    const calls: any[] = [];
    const engine = makeEngine(calls);
    const a: DiscoveredAutomation = { ...promptAutomation("par", "p"), config: { ...promptAutomation("par", "p").config!, concurrency: "parallel" } };
    const r1 = engine.startRunFor(a)!;
    const r2 = engine.startRunFor(a)!;
    expect(r1.runId).not.toBe(r2.runId);

    // FIFO register binding: first register → r1's child, second → r2's child.
    engine.onSessionRegistered("sessA", repo);
    engine.onSessionRegistered("sessB", repo);
    // End out of order — results must land on the right child records.
    engine.onSessionEnded("sessB", "findings B");
    engine.onSessionEnded("sessA", "findings A");

    const cA = children(repo, "par", r1.runId)[0]!;
    const cB = children(repo, "par", r2.runId)[0]!;
    expect(fs.readFileSync(path.join(cA.dir, "result.md"), "utf-8")).toContain("findings A");
    expect(fs.readFileSync(path.join(cB.dir, "result.md"), "utf-8")).toContain("findings B");
  });

  it("releases the runner slot when a spawn promise rejects (no deadlock)", async () => {
    const engine = createEngine({
      spawnSession: async () => {
        throw new Error("spawn boom");
      },
      listScopes: () => [{ base: repo, scope: "folder" }],
      config: () => ({ defaultVisibility: "hidden", retention: 100, scanFolder: true, scanGlobal: false, maxRunAgeMs: 30 * 60 * 1000 }),
      readRoles: () => ({ fast: "m" }),
      warn: () => {},
    });
    const a = promptAutomation("nightly", "x"); // concurrency: skip
    // First fire via the runner: spawn rejects → run finishes error + slot frees.
    engine.runner.fire(a);
    await Promise.resolve();
    await Promise.resolve();
    const after1 = listRuns(repo, "nightly");
    expect(after1).toHaveLength(1);
    expect(after1[0]!.status).toBe("error");
    // Slot freed → a subsequent fire is NOT dropped by the skip policy.
    engine.runner.fire(a);
    await Promise.resolve();
    await Promise.resolve();
    expect(listRuns(repo, "nightly")).toHaveLength(2);
  });

  it("pendingForRunId binds the exact run, immune to same-cwd FIFO races", () => {
    // Two parallel runs share a cwd (mode: local). A runId-keyed lookup must
    // return the matching context regardless of enqueue/registration order —
    // this is what lets prompt delivery target the host-stamped session
    // instead of whatever session emits an event first at that cwd.
    const calls: any[] = [];
    const engine = makeEngine(calls);
    const base = promptAutomation("par", "p");
    const a: DiscoveredAutomation = { ...base, config: { ...base.config!, concurrency: "parallel" } };
    const r1 = engine.startRunFor(a)!;
    const r2 = engine.startRunFor(a)!;
    // Correlation is by CHILD run id (children own the session stamp).
    const c1 = children(repo, "par", r1.runId)[0]!.runId;
    const c2 = children(repo, "par", r2.runId)[0]!.runId;

    // Lookup by child runId returns the right pending context.
    expect(engine.pendingForRunId(c1)!.runId).toBe(c1);
    expect(engine.pendingForRunId(c2)!.runId).toBe(c2);

    // Bind sessions to children by runId (order intentionally "wrong" for FIFO:
    // c2 first). Each prompt must still land on its own child.
    engine.onSessionRegisteredForRun("sessB", c2);
    engine.onSessionRegisteredForRun("sessA", c1);
    engine.onSessionEnded("sessA", "findings A");
    engine.onSessionEnded("sessB", "findings B");

    const recA = children(repo, "par", r1.runId)[0]!;
    const recB = children(repo, "par", r2.runId)[0]!;
    expect(fs.readFileSync(path.join(recA.dir, "result.md"), "utf-8")).toContain("findings A");
    expect(fs.readFileSync(path.join(recB.dir, "result.md"), "utf-8")).toContain("findings B");
  });

  it("pendingForRunId returns undefined once a run is delivered", () => {
    const calls: any[] = [];
    const engine = makeEngine(calls);
    const { runId } = engine.startRunFor(promptAutomation("once", "x"))!;
    const child = children(repo, "once", runId)[0]!.runId;
    expect(engine.pendingForRunId(child)).toBeDefined();
    engine.onSessionRegisteredForRun("sess-1", child);
    expect(engine.pendingForRunId(child)).toBeUndefined();
  });

  // Engine with an injected termination hook (records its call args).
  function makeStoppableEngine(terminations: any[], token = "tok-1") {
    const calls: any[] = [];
    const engine = createEngine({
      spawnSession: async (opts) => {
        calls.push(opts);
        return { success: true, spawnToken: token };
      },
      abortSpawnedRun: async (args) => {
        terminations.push(args);
        return true;
      },
      listScopes: () => [{ base: repo, scope: "folder" }],
      config: () => ({ defaultVisibility: "hidden", retention: 100, defaultModel: "m", scanFolder: true, scanGlobal: false, maxRunAgeMs: 30 * 60 * 1000 }),
      readRoles: () => ({ fast: "m" }),
      warn: () => {},
    });
    return { engine, calls };
  }

  // Let the async spawn `.then` run so ctx.spawnToken is captured.
  const flushSpawn = async () => { await Promise.resolve(); await Promise.resolve(); };

  it("stopRun (parent) cascades to the child by sessionId and finalizes once; later end is a no-op", async () => {
    const terminations: any[] = [];
    const { engine } = makeStoppableEngine(terminations);
    const { runId } = engine.startRunFor(promptAutomation("nightly", "x"))!;
    await flushSpawn();
    engine.onSessionRegistered("sess-1", repo);

    expect(await engine.stopRun(runId)).toBe(true);
    expect(terminations).toEqual([{ sessionId: "sess-1", spawnToken: "tok-1" }]);
    const parent = parentRun(repo, "nightly", runId);
    expect(parent.status).toBe("stopped");
    const child = readChildRuns(repo, parent)[0]!;
    expect(child.status).toBe("stopped");
    expect(child.error).toContain("stopped");
    expect(child.archived).toBeUndefined();

    // A later agent_end for that session must NOT re-finalize or duplicate.
    engine.onSessionEnded("sess-1", "late findings");
    expect(parentRun(repo, "nightly", runId).status).toBe("stopped");
    expect(terminations).toHaveLength(1);
  });

  it("stop during the spawn→register window terminates by spawnToken and leaves no zombie", async () => {
    const terminations: any[] = [];
    const { engine } = makeStoppableEngine(terminations, "tok-prereg");
    const { runId } = engine.startRunFor(promptAutomation("nightly", "x"))!;
    await flushSpawn(); // spawn resolved + token captured, but NO session_register yet

    // Stop before register: no sessionId bound, only the spawnToken handle.
    expect(await engine.stopRun(runId)).toBe(true);
    expect(terminations).toEqual([{ spawnToken: "tok-prereg" }]);

    // The late register must find no pending child → no prompt delivery, no zombie.
    const childId = children(repo, "nightly", runId)[0]!.runId;
    engine.onSessionRegisteredForRun("late-sess", childId);
    expect(engine.pendingForRunId(childId)).toBeUndefined();
    engine.onSessionEnded("late-sess", "orphan output");
    const parent = parentRun(repo, "nightly", runId);
    expect(parent.status).toBe("stopped"); // stopped, not overwritten by the orphan
    expect(terminations).toHaveLength(1);
  });

  it("a completed run terminates its persistent session gracefully exactly once", async () => {
    const terminations: any[] = [];
    const { engine } = makeStoppableEngine(terminations, "tok-done");
    const { runId } = engine.startRunFor(promptAutomation("nightly", "x"))!;
    await flushSpawn();
    engine.onSessionRegistered("sess-done", repo);
    engine.onSessionEnded("sess-done", "Found regressions.");

    expect(terminations).toEqual([{ sessionId: "sess-done", spawnToken: "tok-done", graceful: true }]);
    expect(parentRun(repo, "nightly", runId).status).toBe("done");

    // A subsequent end signal must not re-finalize or re-terminate.
    engine.onSessionEnded("sess-done", "duplicate");
    expect(terminations).toHaveLength(1);
  });

  it("stopRun on an unknown/finalized run is a no-op returning false", async () => {
    const engine = makeEngine([]);
    expect(await engine.stopRun("does-not-exist")).toBe(false);
  });

  it("arms valid automations via start()", () => {
    const calls: any[] = [];
    const engine = makeEngine(calls);
    promptAutomation("nightly", "x");
    engine.start();
    expect(engine.scheduler.armedKeys()).toContain("folder:nightly");
    engine.dispose();
  });
});

// See change: finalize-automation-run-on-session-death.
describe("session-death finalize + stale-run reaper", () => {
  const flushSpawn = async () => { await Promise.resolve(); await Promise.resolve(); };

  function makeReaperEngine(nowRef: { v: number }, maxRunAgeMs = 1000) {
    const terminations: any[] = [];
    const engine = createEngine({
      spawnSession: async () => ({ success: true, spawnToken: "tok" }),
      abortSpawnedRun: async (a) => { terminations.push(a); return true; },
      listScopes: () => [{ base: repo, scope: "folder" }],
      config: () => ({ defaultVisibility: "hidden", retention: 100, scanFolder: true, scanGlobal: false, maxRunAgeMs }),
      readRoles: () => ({ fast: "m" }),
      now: () => nowRef.v,
      warn: () => {},
    });
    return { engine, terminations };
  }

  it("3.1/3.5: session death with no buffered result finalizes error + frees the skip slot", async () => {
    const engine = makeEngine([]);
    const a = promptAutomation("pull", "x"); // concurrency: skip
    engine.runner.fire(a);
    await flushSpawn();
    const key = "folder:pull";
    const runId = engine.runner.activeRunId(key)!;
    expect(runId).toBeTruthy();
    engine.onSessionRegistered("sess-1", repo);

    // A second fire is dropped by skip while the run is active.
    engine.runner.fire(a);
    expect(listRuns(repo, "pull")).toHaveLength(1);

    // Session dies before any terminal event crosses the bridge.
    engine.onSessionDeath("sess-1", "");
    const parent = parentRun(repo, "pull", runId);
    expect(parent.status).toBe("error");
    expect(readChildRuns(repo, parent)[0]!.error).toContain("session ended before completion");
    expect(engine.runner.activeRunId(key)).toBeNull();

    // Slot freed → the next fire is no longer wedged.
    engine.runner.fire(a);
    await flushSpawn();
    expect(listRuns(repo, "pull")).toHaveLength(2);
  });

  it("3.1: session death WITH a buffered result finalizes done", () => {
    const engine = makeEngine([]);
    const { runId } = engine.startRunFor(promptAutomation("pull", "x"))!;
    engine.onSessionRegistered("sess-1", repo);
    engine.onSessionDeath("sess-1", "- partial finding before teardown");
    const parent = parentRun(repo, "pull", runId);
    expect(parent.status).toBe("done");
    const child = readChildRuns(repo, parent)[0]!;
    expect(fs.readFileSync(path.join(child.dir, "result.md"), "utf-8")).toContain("partial finding");
  });

  it("3.2: a forwarded completion / agent_end after session-death finalize is a no-op", () => {
    const engine = makeEngine([]);
    const { runId } = engine.startRunFor(promptAutomation("pull", "x"))!;
    engine.onSessionRegistered("sess-1", repo);
    engine.onSessionDeath("sess-1", "");
    expect(listRuns(repo, "pull")).toHaveLength(1);
    expect(parentRun(repo, "pull", runId).status).toBe("error");

    // Late agent_end for that session must not re-finalize or duplicate.
    engine.onSessionEnded("sess-1", "late findings");
    // A second death signal is likewise a no-op.
    engine.onSessionDeath("sess-1", "more late findings");
    expect(parentRun(repo, "pull", runId).status).toBe("error");
  });

  it("onSessionDeath for an unknown/finalized session is a no-op", () => {
    const engine = makeEngine([]);
    engine.onSessionDeath("never-existed", "x");
    expect(listRuns(repo)).toHaveLength(0);
  });

  it("3.4: reaper reaps an overdue running run + frees its slot; healthy untouched; terminal after reap no-op", async () => {
    const nowRef = { v: Date.now() };
    const { engine } = makeReaperEngine(nowRef, 1000);
    const a = promptAutomation("pull", "x");
    engine.runner.fire(a);
    await flushSpawn();
    const key = "folder:pull";
    const runId = engine.runner.activeRunId(key)!;
    engine.onSessionRegistered("sess-1", repo);
    const started = readChildRuns(repo, parentRun(repo, "pull", runId))[0]!.startedAt;

    // Healthy: within maxAge → untouched.
    nowRef.v = started + 500;
    engine.reapStaleRuns();
    expect(parentRun(repo, "pull", runId).status).toBe("running");
    expect(engine.runner.activeRunId(key)).toBe(runId);

    // Overdue: beyond maxAge → the child is reaped → parent error + slot freed.
    nowRef.v = started + 1001;
    engine.reapStaleRuns();
    const parent = parentRun(repo, "pull", runId);
    expect(parent.status).toBe("error");
    expect(readChildRuns(repo, parent)[0]!.error).toContain("max age");
    expect(engine.runner.activeRunId(key)).toBeNull();

    // A terminal signal after reap is a no-op.
    engine.onSessionEnded("sess-1", "late");
    expect(parentRun(repo, "pull", runId).status).toBe("error");
  });

  it("4.1: reaper clears a pre-existing on-disk running orphan with no live context", () => {
    const nowRef = { v: Date.now() };
    const { engine } = makeReaperEngine(nowRef, 1000);
    // Orphan left by a prior process: a running record, no in-memory context.
    const orphan = storeStartRun(repo, "pull");
    nowRef.v = orphan.startedAt + 2000;
    engine.reapStaleRuns();
    const after = listRuns(repo, "pull").find((r) => r.runId === orphan.runId)!;
    expect(after.status).toBe("error");
    expect(after.error).toContain("max age");
  });

  it("reaper is disabled when maxRunAgeMs <= 0", () => {
    const nowRef = { v: Date.now() };
    const { engine } = makeReaperEngine(nowRef, 0);
    const orphan = storeStartRun(repo, "pull");
    nowRef.v = orphan.startedAt + 10_000_000;
    engine.reapStaleRuns();
    expect(listRuns(repo, "pull").find((r) => r.runId === orphan.runId)!.status).toBe("running");
  });
});

// ── Fan-out: parent aggregate, isolation, stop cascade, reaper ──────────────
// See change: add-automation-concurrent-spawn.
describe("engine fan-out", () => {
  const flushSpawn = async () => { await Promise.resolve(); await Promise.resolve(); };

  function fanoutAutomation(name: string, count: number, concurrency: "skip" | "queue" | "parallel" = "skip"): DiscoveredAutomation {
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

  it("4.6: over-bound fire records a truncation warning naming the bound + count not spawned", () => {
    const engine = makeEngine([]); // default bound 4
    const r = engine.startRunFor(fanoutAutomation("wide", 10))!;
    const parent = parentRun(repo, "wide", r.runId);
    expect(parent.children).toHaveLength(4);
    expect(parent.warning).toContain("4");
    expect(parent.warning).toContain("6");
  });

  it("4.7: parent aggregates done with summed findings", () => {
    const engine = makeEngine([]);
    const r = engine.startRunFor(fanoutAutomation("agg", 3))!;
    const kids = children(repo, "agg", r.runId);
    engine.onSessionRegisteredForRun("s0", kids[0]!.runId);
    engine.onSessionRegisteredForRun("s1", kids[1]!.runId);
    engine.onSessionRegisteredForRun("s2", kids[2]!.runId);
    engine.onSessionEnded("s0", "- a\n- b");           // 2
    engine.onSessionEnded("s1", "prose, no bullets");  // 0
    engine.onSessionEnded("s2", "- a\n- b\n- c\n- d\n- e"); // 5
    const parent = parentRun(repo, "agg", r.runId);
    expect(parent.status).toBe("done");
    expect(parent.findings).toBe(7);
  });

  it("4.8: parent aggregates error when any child errors", () => {
    const engine = makeEngine([]);
    const r = engine.startRunFor(fanoutAutomation("anyerr", 3))!;
    const kids = children(repo, "anyerr", r.runId);
    engine.onSessionRegisteredForRun("s0", kids[0]!.runId);
    engine.onSessionRegisteredForRun("s1", kids[1]!.runId);
    engine.onSessionRegisteredForRun("s2", kids[2]!.runId);
    engine.onSessionEnded("s0", "- x");
    engine.onSessionDeath("s1", "");   // error (no buffered result)
    engine.onSessionEnded("s2", "- y");
    expect(parentRun(repo, "anyerr", r.runId).status).toBe("error");
  });

  it("4.9: parent aggregates stopped when every child was stopped", async () => {
    const engine = makeEngine([]);
    const r = engine.startRunFor(fanoutAutomation("allstop", 3))!;
    const kids = children(repo, "allstop", r.runId);
    kids.forEach((k, i) => engine.onSessionRegisteredForRun(`s${i}`, k.runId));
    await engine.stopRun(r.runId); // parent stop cascades to all
    expect(parentRun(repo, "allstop", r.runId).status).toBe("stopped");
  });

  it("4.10: parent aggregates done for mixed stopped/done (no error)", async () => {
    const engine = makeEngine([]);
    const r = engine.startRunFor(fanoutAutomation("mixed", 3))!;
    const kids = children(repo, "mixed", r.runId);
    kids.forEach((k, i) => engine.onSessionRegisteredForRun(`s${i}`, k.runId));
    engine.onSessionEnded("s0", "- x");
    await engine.stopRun(kids[1]!.runId); // one child stopped
    engine.onSessionEnded("s2", "- y");
    expect(parentRun(repo, "mixed", r.runId).status).toBe("done");
  });

  it("4.11: parent stays running until the last child finalizes", () => {
    const engine = makeEngine([]);
    const r = engine.startRunFor(fanoutAutomation("last", 3))!;
    const kids = children(repo, "last", r.runId);
    kids.forEach((k, i) => engine.onSessionRegisteredForRun(`s${i}`, k.runId));
    engine.onSessionEnded("s0", "- x");
    engine.onSessionEnded("s1", "- y");
    expect(parentRun(repo, "last", r.runId).status).toBe("running");
    engine.onSessionEnded("s2", "- z");
    expect(parentRun(repo, "last", r.runId).status).toBe("done");
  });

  it("4.12: a child spawn failure is isolated from its siblings", async () => {
    let n = 0;
    const engine = createEngine({
      spawnSession: async () => {
        n++;
        return n === 2 ? { success: false, message: "spawn boom" } : { success: true, spawnToken: `t${n}` };
      },
      listScopes: () => [{ base: repo, scope: "folder" }],
      config: () => ({ defaultVisibility: "hidden", retention: 100, defaultModel: "m", scanFolder: true, scanGlobal: false, maxRunAgeMs: 30 * 60 * 1000 }),
      readRoles: () => ({ fast: "m" }),
      warn: () => {},
    });
    const r = engine.startRunFor(fanoutAutomation("iso", 3))!;
    const kidIds = children(repo, "iso", r.runId).map((k) => k.runId);
    await flushSpawn();
    const after = children(repo, "iso", r.runId);
    expect(after[1]!.status).toBe("error"); // 2nd spawn failed
    expect(after[0]!.status).toBe("running");
    expect(after[2]!.status).toBe("running");
    // Siblings finalize on their own signals; parent errors (one child errored).
    engine.onSessionRegisteredForRun("s0", kidIds[0]!);
    engine.onSessionRegisteredForRun("s2", kidIds[2]!);
    engine.onSessionEnded("s0", "- x");
    engine.onSessionEnded("s2", "- y");
    expect(parentRun(repo, "iso", r.runId).status).toBe("error");
  });

  it("4.14: a child session death finalizes only that child", () => {
    const engine = makeEngine([]);
    const r = engine.startRunFor(fanoutAutomation("death", 3))!;
    const kids = children(repo, "death", r.runId);
    kids.forEach((k, i) => engine.onSessionRegisteredForRun(`s${i}`, k.runId));
    engine.onSessionDeath("s1", "- buffered"); // done via buffered
    const after = children(repo, "death", r.runId);
    expect(after[1]!.status).toBe("done");
    expect(after[0]!.status).toBe("running");
    expect(after[2]!.status).toBe("running");
    expect(parentRun(repo, "death", r.runId).status).toBe("running");
  });

  it("4.15: parent finalization is idempotent against a late child signal", () => {
    const engine = makeEngine([]);
    const r = engine.startRunFor(fanoutAutomation("idem", 2))!;
    const kids = children(repo, "idem", r.runId);
    engine.onSessionRegisteredForRun("s0", kids[0]!.runId);
    engine.onSessionRegisteredForRun("s1", kids[1]!.runId);
    engine.onSessionEnded("s0", "- a");
    engine.onSessionEnded("s1", "- b");
    const before = JSON.stringify(parentRun(repo, "idem", r.runId));
    engine.onSessionEnded("s1", "late duplicate");
    expect(JSON.stringify(parentRun(repo, "idem", r.runId))).toBe(before);
  });

  it("F3: every child of a fire is stamped with one effective visibility", () => {
    const calls: any[] = [];
    const engine = makeEngine(calls);
    const base = fanoutAutomation("vis", 3);
    const withVis: DiscoveredAutomation = { ...base, config: { ...base.config!, visibility: "shown" } };
    engine.startRunFor(withVis);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.automationRun.visibility === "shown")).toBe(true);
  });

  it("4.17: all children spawn regardless of concurrency policy", async () => {
    const calls: any[] = [];
    const engine = makeEngine(calls);
    const r = engine.startRunFor(fanoutAutomation("wide4", 4, "skip"))!;
    const kids = children(repo, "wide4", r.runId);
    expect(kids).toHaveLength(4);
    expect(kids.every((k) => k.status === "running")).toBe(true);
    await flushSpawn();
    expect(calls).toHaveLength(4);
  });

  it("5.5/X10: a stop inside the spawn window aborts on token arrival", async () => {
    const terminations: any[] = [];
    let resolveSpawn!: (v: { success: boolean; spawnToken?: string }) => void;
    const engine = createEngine({
      spawnSession: () => new Promise((res) => { resolveSpawn = res; }),
      abortSpawnedRun: async (a) => { terminations.push(a); return true; },
      listScopes: () => [{ base: repo, scope: "folder" }],
      config: () => ({ defaultVisibility: "hidden", retention: 100, defaultModel: "m", scanFolder: true, scanGlobal: false, maxRunAgeMs: 30 * 60 * 1000 }),
      readRoles: () => ({ fast: "m" }),
      warn: () => {},
    });
    const r = engine.startRunFor(fanoutAutomation("win", 1))!;
    // spawn has NOT resolved: no sessionId, no spawnToken yet.
    expect(await engine.stopRun(r.runId)).toBe(true);
    resolveSpawn({ success: true, spawnToken: "tok-w" });
    await flushSpawn();
    expect(terminations).toContainEqual({ spawnToken: "tok-w" });
    expect(parentRun(repo, "win", r.runId).status).toBe("stopped");
  });

  it("5.6/X11: a stop racing a child's session-end finalizes each once", async () => {
    const engine = makeEngine([]);
    const r = engine.startRunFor(fanoutAutomation("race", 2))!;
    const kids = children(repo, "race", r.runId);
    engine.onSessionRegisteredForRun("s0", kids[0]!.runId);
    engine.onSessionRegisteredForRun("s1", kids[1]!.runId);
    engine.onSessionEnded("s0", "- a");        // child0 done
    await engine.stopRun(r.runId);             // cascades to the live child1 only
    engine.onSessionEnded("s1", "late");       // no-op, already stopped
    const parent = parentRun(repo, "race", r.runId);
    expect(parent.status).toBe("done");        // [done, stopped] → done
    expect(typeof parent.endedAt).toBe("number");
    const after = children(repo, "race", r.runId);
    expect(after[0]!.status).toBe("done");
    expect(after[1]!.status).toBe("stopped");
  });
});

// ── Fan-out reaper (child-aware) ────────────────────────────────────────────
// See change: add-automation-concurrent-spawn.
describe("engine fan-out reaper", () => {
  function fanoutAutomation(name: string, count: number): DiscoveredAutomation {
    const dir = path.join(repo, ".pi", "automation", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "prompt.md"), "do it");
    return {
      name, scope: "folder", dir, valid: true,
      config: {
        on: { kind: "schedule", cron: "* * * * *" },
        action: { kind: "prompt", prompt: "./prompt.md", count },
        model: "@fast", mode: "local", sandbox: "workspace-write", concurrency: "skip",
      },
    };
  }
  function ageRecordOnDisk(dir: string, startedAt: number): void {
    const file = path.join(dir, "run.json");
    const rec = JSON.parse(fs.readFileSync(file, "utf-8"));
    rec.startedAt = startedAt;
    fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
  }
  function reaperEngine(nowRef: { v: number }, maxRunAgeMs = 1000) {
    return createEngine({
      spawnSession: async () => ({ success: true, spawnToken: "tok" }),
      abortSpawnedRun: async () => true,
      listScopes: () => [{ base: repo, scope: "folder" }],
      config: () => ({ defaultVisibility: "hidden", retention: 100, scanFolder: true, scanGlobal: false, maxRunAgeMs }),
      readRoles: () => ({ fast: "m" }),
      now: () => nowRef.v,
      warn: () => {},
    });
  }

  it("4.19/X12: a stale child is reaped without touching a live sibling", () => {
    const nowRef = { v: Date.now() };
    const engine = reaperEngine(nowRef, 1000);
    const r = engine.startRunFor(fanoutAutomation("reap2", 2))!;
    const kids = children(repo, "reap2", r.runId);
    engine.onSessionRegisteredForRun("s0", kids[0]!.runId);
    engine.onSessionRegisteredForRun("s1", kids[1]!.runId);
    // Age only child A on disk.
    ageRecordOnDisk(kids[0]!.dir, nowRef.v - 10_000);
    engine.reapStaleRuns();
    const after = children(repo, "reap2", r.runId);
    expect(after[0]!.status).toBe("error"); // reaped
    expect(after[1]!.status).toBe("running");
    expect(parentRun(repo, "reap2", r.runId).status).toBe("running");
    // Sibling terminates → parent finalizes.
    engine.onSessionEnded("s1", "- x");
    expect(parentRun(repo, "reap2", r.runId).status).toBe("error");
  });

  it("4.20/X13: the reaper never orphan-finalizes a live parent", () => {
    const nowRef = { v: Date.now() };
    const engine = reaperEngine(nowRef, 1000);
    const r = engine.startRunFor(fanoutAutomation("liveparent", 2))!;
    const kids = children(repo, "liveparent", r.runId);
    engine.onSessionRegisteredForRun("s0", kids[0]!.runId);
    engine.onSessionRegisteredForRun("s1", kids[1]!.runId);
    // Age the PARENT record; children stay fresh.
    ageRecordOnDisk(parentRun(repo, "liveparent", r.runId).dir, nowRef.v - 10_000);
    engine.reapStaleRuns();
    expect(parentRun(repo, "liveparent", r.runId).status).toBe("running");
  });
});
