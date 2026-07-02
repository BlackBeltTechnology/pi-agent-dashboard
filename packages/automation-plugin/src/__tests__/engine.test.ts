/**
 * Engine integration tests (injected I/O):
 *  - prompt + skill spawn paths (§5.2)
 *  - status transitions + result.md capture (§5.4)
 *  - effective visibility passed on the spawn stamp (§5.x)
 * See change: add-automation-plugin.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEngine, buildRunPrompt, buildRunDispatch, effectiveVisibility } from "../server/engine.js";
import { ActionRegistry } from "../server/action-registry.js";
import { listRuns } from "../server/run-store.js";
import type { DiscoveredAutomation } from "../shared/automation-types.js";

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

    // Simulate the run session registering + ending.
    engine.onSessionRegistered("sess-1", repo);
    engine.onSessionEnded("sess-1", "Found 1 regression in auth.");

    const runs = listRuns(repo, "nightly");
    const done = runs.find((x) => x.runId === runId)!;
    expect(done.status).toBe("done");
    const md = fs.readFileSync(path.join(done.dir, "result.md"), "utf-8");
    expect(md).toContain("Found 1 regression");
  });

  it("empty findings auto-archive on session end", () => {
    const calls: any[] = [];
    const engine = makeEngine(calls);
    engine.startRunFor(promptAutomation("nightly", "x"));
    engine.onSessionRegistered("sess-1", repo);
    engine.onSessionEnded("sess-1", "   ");
    const runs = listRuns(repo, "nightly");
    expect(runs[0]!.archived).toBe(true);
  });

  it("unresolved @role → spawn with default model + run recorded error on end", () => {
    const calls: any[] = [];
    const engine = makeEngine(calls, {}); // no roles → @fast unresolved
    const a = promptAutomation("nightly", "x");
    engine.startRunFor(a);
    expect(calls[0].model).toBe("anthropic/claude-sonnet-4-5"); // fell back to default
    engine.onSessionRegistered("sess-1", repo);
    engine.onSessionEnded("sess-1", "result");
    const runs = listRuns(repo, "nightly");
    expect(runs[0]!.status).toBe("error");
    expect(runs[0]!.error).toContain("@fast");
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

    // FIFO register binding: first register → r1, second → r2.
    engine.onSessionRegistered("sessA", repo);
    engine.onSessionRegistered("sessB", repo);
    // End out of order — results must land on the right run records.
    engine.onSessionEnded("sessB", "findings B");
    engine.onSessionEnded("sessA", "findings A");

    const runs = listRuns(repo, "par");
    const recA = runs.find((x) => x.runId === r1.runId)!;
    const recB = runs.find((x) => x.runId === r2.runId)!;
    expect(fs.readFileSync(path.join(recA.dir, "result.md"), "utf-8")).toContain("findings A");
    expect(fs.readFileSync(path.join(recB.dir, "result.md"), "utf-8")).toContain("findings B");
  });

  it("releases the runner slot when a spawn promise rejects (no deadlock)", async () => {
    const engine = createEngine({
      spawnSession: async () => {
        throw new Error("spawn boom");
      },
      listScopes: () => [{ base: repo, scope: "folder" }],
      config: () => ({ defaultVisibility: "hidden", retention: 100, scanFolder: true, scanGlobal: false }),
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

    // Lookup by runId returns the right pending context.
    expect(engine.pendingForRunId(r1.runId)!.runId).toBe(r1.runId);
    expect(engine.pendingForRunId(r2.runId)!.runId).toBe(r2.runId);

    // Bind sessions to runs by runId (the order is intentionally "wrong" for
    // FIFO: r2 first). Each prompt must still land on its own run.
    engine.onSessionRegisteredForRun("sessB", r2.runId);
    engine.onSessionRegisteredForRun("sessA", r1.runId);
    engine.onSessionEnded("sessA", "findings A");
    engine.onSessionEnded("sessB", "findings B");

    const runs = listRuns(repo, "par");
    const recA = runs.find((x) => x.runId === r1.runId)!;
    const recB = runs.find((x) => x.runId === r2.runId)!;
    expect(fs.readFileSync(path.join(recA.dir, "result.md"), "utf-8")).toContain("findings A");
    expect(fs.readFileSync(path.join(recB.dir, "result.md"), "utf-8")).toContain("findings B");
  });

  it("pendingForRunId returns undefined once a run is delivered", () => {
    const calls: any[] = [];
    const engine = makeEngine(calls);
    const { runId } = engine.startRunFor(promptAutomation("once", "x"))!;
    expect(engine.pendingForRunId(runId)).toBeDefined();
    engine.onSessionRegisteredForRun("sess-1", runId);
    expect(engine.pendingForRunId(runId)).toBeUndefined();
  });

  it("stopRun aborts the session and finalizes once; later end is a no-op", () => {
    const calls: any[] = [];
    const aborts: string[] = [];
    const engine = createEngine({
      spawnSession: async (opts) => {
        calls.push(opts);
        return { success: true };
      },
      abortSession: (id) => {
        aborts.push(id);
        return true;
      },
      listScopes: () => [{ base: repo, scope: "folder" }],
      config: () => ({ defaultVisibility: "hidden", retention: 100, defaultModel: "m", scanFolder: true, scanGlobal: false }),
      readRoles: () => ({ fast: "m" }),
      warn: () => {},
    });
    const { runId } = engine.startRunFor(promptAutomation("nightly", "x"))!;
    engine.onSessionRegisteredForRun("sess-1", runId);

    expect(engine.stopRun(runId)).toBe(true);
    expect(aborts).toEqual(["sess-1"]);
    const runs = listRuns(repo, "nightly");
    const rec = runs.find((r) => r.runId === runId)!;
    expect(rec.status).toBe("error");
    expect(rec.error).toContain("stopped");
    expect(rec.archived).toBeUndefined();

    // A later agent_end for that session must NOT re-finalize or duplicate.
    engine.onSessionEnded("sess-1", "late findings");
    const after = listRuns(repo, "nightly");
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe("error");
  });

  it("stopRun on an unknown/finalized run is a no-op returning false", () => {
    const engine = makeEngine([]);
    expect(engine.stopRun("does-not-exist")).toBe(false);
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
