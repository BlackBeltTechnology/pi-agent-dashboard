/**
 * Electron runtime-overlay core: cold-launch planning (pending / attempts /
 * bad), local-folder pick, activation watcher, and switchRuntime().
 *
 * All I/O except the state files (real temp dir) is injected.
 * test-plan: E3, E11, E12, E13, P1, X4, X5, X6, X7, X9.
 * See change: electron-runtime-overlay-updates (D2, D3).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  localRuntimeId,
  patchRuntimeRequest,
  patchRuntimeState,
  readRuntimeRequest,
  readRuntimeState,
  selectRuntimeSource,
} from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/state.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activationTarget,
  beginAttempt,
  type ColdSpawnDeps,
  createSwitchQueue,
  pickLocalFolder,
  planColdLaunch,
  recordColdFailure,
  SWITCH_OLD_EXIT_DEADLINE_MS,
  type SwitchRuntimeDeps,
  shouldCountAttempt,
  spawnColdCandidate,
  switchRuntime,
  watchActivationRequests,
} from "../runtime-overlay.js";
import { releaseRuntimeSwitchOwnership } from "../server-lifecycle.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-overlay-"));
  releaseRuntimeSwitchOwnership();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Cold launch: handled pending / attempts / bad ───────────────────────────

/** Simulate one cold launch where every overlay/local candidate spawn fails health. */
function coldLaunchFailing(): string | null {
  const plan = planColdLaunch(dir);
  const first = plan.inputs.effectiveSource === "local" ? plan.inputs.local : plan.inputs.overlays?.[0];
  if (!first) return null;
  const state = readRuntimeState(dir);
  if (shouldCountAttempt(state, first.runtimeId)) beginAttempt(dir, first.runtimeId);
  recordColdFailure(dir, first.runtimeId, "health timeout");
  return first.runtimeId;
}

describe("planColdLaunch (E11, E12, E13a)", () => {
  it("E11: a committed pending X runs as current without counting an attempt", () => {
    selectRuntimeSource(dir, { source: "npm" });
    patchRuntimeRequest(dir, { pending: "0.9.1" });
    patchRuntimeState(dir, { current: "0.9.1", previous: "0.9.0" });

    const plan = planColdLaunch(dir);
    expect(plan.inputs.overlays?.map((c) => c.runtimeId)).toEqual(["0.9.1", "0.9.0"]);
    const state = readRuntimeState(dir);
    expect(shouldCountAttempt(state, "0.9.1")).toBe(false);
    expect(state.attempts?.["0.9.1"]).toBeUndefined();
    expect(plan.activating).toBeNull();
  });

  it("E12: an unhealthy pending X is tried twice, marked bad after the 2nd, never a 3rd time", () => {
    selectRuntimeSource(dir, { source: "npm" });
    patchRuntimeRequest(dir, { pending: "0.9.1" });
    patchRuntimeState(dir, { current: "0.9.0" });

    expect(coldLaunchFailing()).toBe("0.9.1");
    expect(readRuntimeState(dir).attempts?.["0.9.1"]).toBe(1);
    expect(readRuntimeState(dir).bad?.["0.9.1"]).toBeUndefined();

    expect(coldLaunchFailing()).toBe("0.9.1");
    expect(readRuntimeState(dir).bad?.["0.9.1"]?.reason).toBe("health timeout");

    // 3rd launch: X is not attempted; current is the first candidate.
    const plan = planColdLaunch(dir);
    expect(plan.inputs.overlays?.map((c) => c.runtimeId)).toEqual(["0.9.0"]);
  });

  it("E12: a crash between spawn and commit (no failure recorded) still exhausts after 2 attempts", () => {
    selectRuntimeSource(dir, { source: "github" });
    patchRuntimeRequest(dir, { pending: "0.9.1" });
    beginAttempt(dir, "0.9.1");
    beginAttempt(dir, "0.9.1"); // app died twice mid-activation
    const plan = planColdLaunch(dir);
    expect(plan.inputs.overlays?.map((c) => c.runtimeId) ?? []).not.toContain("0.9.1");
    expect(readRuntimeState(dir).bad?.["0.9.1"]?.reason).toBe("crashed_before_commit");
  });

  it("an explicit Update (fresh pendingNonce) clears bad[X] + attempts once, so X is attempted again", () => {
    selectRuntimeSource(dir, { source: "npm" });
    patchRuntimeState(dir, { current: "0.9.0", bad: { "0.9.1": { reason: "health timeout" } }, attempts: { "0.9.1": 2 } });
    patchRuntimeRequest(dir, { pending: "0.9.1" });
    expect(planColdLaunch(dir).inputs.overlays?.map((c) => c.runtimeId)).toEqual(["0.9.0"]);

    patchRuntimeRequest(dir, { pending: "0.9.1", pendingNonce: "3f1c0e7a-1111-4222-8333-944455556666" });
    expect(planColdLaunch(dir).inputs.overlays?.map((c) => c.runtimeId)).toEqual(["0.9.1", "0.9.0"]);
    expect(readRuntimeState(dir).bad?.["0.9.1"]).toBeUndefined();
    expect(readRuntimeState(dir).attempts?.["0.9.1"]).toBeUndefined();

    // consumed once: a later failure marks it bad again and the SAME nonce does not re-clear it
    patchRuntimeState(dir, (s) => ({ bad: { ...s.bad, "0.9.1": { reason: "again" } } }));
    expect(planColdLaunch(dir).inputs.overlays?.map((c) => c.runtimeId)).toEqual(["0.9.0"]);
  });

  it("E13a: a bad local checkout is not attempted on cold launch", () => {
    const co = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "co-")));
    const req = selectRuntimeSource(dir, { source: "bundled" });
    const id = localRuntimeId(co);
    patchRuntimeState(dir, {
      localPath: co,
      localBinding: { epoch: req.sourceEpoch as string, seq: req.sourceSeq as number },
      bad: { [id]: { reason: "health timeout" } },
    });
    const plan = planColdLaunch(dir);
    expect(plan.inputs.effectiveSource).toBe("local");
    expect(plan.inputs.local).toBeUndefined();
    fs.rmSync(co, { recursive: true, force: true });
  });

  it("X9: a request rewritten without sourceEpoch never yields a localLink candidate", () => {
    const req = selectRuntimeSource(dir, { source: "npm" });
    selectRuntimeSource(dir, { source: "npm" }); // seq 2
    patchRuntimeState(dir, {
      localPath: "/r/co",
      localBinding: { epoch: req.sourceEpoch as string, seq: 2 },
    });
    expect(planColdLaunch(dir).inputs.effectiveSource).toBe("local");
    // "older server" rewrites request.json without the epoch
    fs.writeFileSync(path.join(dir, "request.json"), JSON.stringify({ source: "npm", sourceSeq: 2 }));
    const plan = planColdLaunch(dir);
    expect(plan.inputs.effectiveSource).toBe("npm");
    expect(plan.inputs.local).toBeUndefined();
  });
});

// ── App-menu local pick (E3, E13b) ──────────────────────────────────────────

function makeCheckout(): string {
  const co = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "co-")));
  fs.mkdirSync(path.join(co, "packages", "server", "src"), { recursive: true });
  fs.writeFileSync(path.join(co, "packages", "server", "src", "cli.ts"), "");
  return co;
}

describe("pickLocalFolder (E3, E13b)", () => {
  it.each([
    ["missing", null],
    ["corrupt", "{not json"],
  ])("E3: refuses with request_unreadable when request.json is %s", (_label, content) => {
    if (content !== null) fs.writeFileSync(path.join(dir, "request.json"), content);
    const co = makeCheckout();
    const res = pickLocalFolder(dir, co);
    expect(res).toEqual({ ok: false, error: "request_unreadable" });
    const state = readRuntimeState(dir);
    expect(state.localPath).toBeUndefined();
    expect(state.localBinding).toBeUndefined();
    fs.rmSync(co, { recursive: true, force: true });
  });

  it("refuses a folder that is not a dashboard checkout", () => {
    selectRuntimeSource(dir, { source: "bundled" });
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "plain-"));
    expect(pickLocalFolder(dir, plain)).toMatchObject({ ok: false, error: "invalid_folder" });
    expect(readRuntimeState(dir).localPath).toBeUndefined();
    fs.rmSync(plain, { recursive: true, force: true });
  });

  it("binds to the current {epoch, seq} as a realpath; effective source becomes local", () => {
    const req = selectRuntimeSource(dir, { source: "npm" });
    const co = makeCheckout();
    const link = path.join(dir, "link");
    fs.symlinkSync(co, link);
    const res = pickLocalFolder(dir, link);
    expect(res).toEqual({ ok: true, runtimeId: localRuntimeId(co) });
    const state = readRuntimeState(dir);
    expect(state.localPath).toBe(co);
    expect(state.localBinding).toEqual({ epoch: req.sourceEpoch, seq: req.sourceSeq });
    expect(planColdLaunch(dir).inputs.local?.runtimeId).toBe(localRuntimeId(co));
    fs.rmSync(co, { recursive: true, force: true });
  });

  it("E13b: re-selecting a bad checkout clears bad + attempts so it is attempted again", () => {
    selectRuntimeSource(dir, { source: "bundled" });
    const co = makeCheckout();
    const id = localRuntimeId(co);
    patchRuntimeState(dir, { bad: { [id]: { reason: "health timeout" } }, attempts: { [id]: 2 } });
    expect(pickLocalFolder(dir, co)).toEqual({ ok: true, runtimeId: id });
    const state = readRuntimeState(dir);
    expect(state.bad?.[id]).toBeUndefined();
    expect(state.attempts?.[id]).toBeUndefined();
    expect(planColdLaunch(dir).inputs.local?.runtimeId).toBe(id);
    fs.rmSync(co, { recursive: true, force: true });
  });
});

// ── Activation watcher (P1) ─────────────────────────────────────────────────

describe("watchActivationRequests (P1)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes the handler within one 2 s poll (+100 ms) of a new activateNonce", async () => {
    vi.useFakeTimers();
    selectRuntimeSource(dir, { source: "npm" });
    const onActivate = vi.fn();
    const stop = watchActivationRequests({ dir, onActivate });

    await vi.advanceTimersByTimeAsync(2_100);
    expect(onActivate).not.toHaveBeenCalled(); // no nonce yet

    patchRuntimeRequest(dir, { pending: "0.9.1", activateNonce: "n1" });
    await vi.advanceTimersByTimeAsync(2_100);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0][0]).toMatchObject({ activateNonce: "n1" });

    // Same nonce is not re-delivered; a handled nonce is ignored.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(onActivate).toHaveBeenCalledTimes(1);
    stop();
  });

  it("ignores a nonce already recorded as handled in state.json (restart after activation)", async () => {
    vi.useFakeTimers();
    selectRuntimeSource(dir, { source: "npm" });
    patchRuntimeRequest(dir, { activateNonce: "old" });
    patchRuntimeState(dir, { handledNonce: "old" });
    const onActivate = vi.fn();
    const stop = watchActivationRequests({ dir, onActivate });
    await vi.advanceTimersByTimeAsync(4_100);
    expect(onActivate).not.toHaveBeenCalled();
    stop();
  });
});

describe("activationTarget", () => {
  it("maps effective source to the runtime to activate", () => {
    selectRuntimeSource(dir, { source: "bundled" });
    expect(activationTarget(dir)).toBe("bundled");
    selectRuntimeSource(dir, { source: "npm" });
    patchRuntimeRequest(dir, { pending: "0.9.1" });
    expect(activationTarget(dir)).toBe("0.9.1");
    patchRuntimeRequest(dir, { pending: undefined });
    patchRuntimeState(dir, { current: "0.9.0" });
    expect(activationTarget(dir)).toBe("0.9.0");
  });
});

// ── switchRuntime (X4–X7) ───────────────────────────────────────────────────

interface FakeWorld {
  clock: number;
  oldPid: number;
  oldExitsAt: number;
  nextPid: number;
  /** Per-runtime-id spawn behaviour. */
  behaviour: Record<string, "healthy" | "unhealthy" | "port_in_use" | "old_answers">;
  events: string[];
  alive: Set<number>;
  serving: { pid: number; runtimeId: string } | null;
}

function makeDeps(world: FakeWorld, over: Partial<SwitchRuntimeDeps> = {}): SwitchRuntimeDeps {
  class PortConflict extends Error {}
  return {
    dir,
    log: () => {},
    now: () => world.clock,
    sleep: async (ms) => {
      world.clock += ms;
      if (world.alive.has(world.oldPid) && world.clock >= world.oldExitsAt) {
        world.alive.delete(world.oldPid);
        if (world.serving?.pid === world.oldPid) world.serving = null;
      }
    },
    probeHealth: async () => (world.serving ? { pid: world.serving.pid, runtimeId: world.serving.runtimeId } : null),
    storedPid: () => world.oldPid,
    ownsServer: () => true,
    stopServer: async () => {
      world.events.push("stop");
    },
    isPidAlive: (pid) => world.alive.has(pid),
    isPortFree: async () => world.serving === null,
    gateCandidate: (id) =>
      id === "0.9.9-incompatible"
        ? { ok: false, reason: "requires_app >=9.0.0" }
        : { ok: true, source: { kind: id === "bundled" ? "bundled" : "overlay", cliPath: `/${id}/cli.ts`, cwd: `/${id}`, runtimeId: id } as never },
    extensionPathFor: (id) => `/ext/${id}`,
    registerExtension: (p) => {
      world.events.push(`register:${p}`);
    },
    spawn: async (source, hooks) => {
      const id = (source as { runtimeId?: string }).runtimeId ?? "bundled";
      const pid = world.nextPid++;
      world.events.push(`spawn:${id}`);
      hooks.onSpawned(pid);
      const b = world.behaviour[id] ?? "healthy";
      if (b === "port_in_use") {
        hooks.onExit(98, null);
        throw new PortConflict("port in use");
      }
      if (b === "unhealthy") throw new Error("readiness timeout");
      world.alive.add(pid);
      if (b === "old_answers") {
        // readiness saw *a* dashboard — the old one, still serving
        world.serving = { pid: world.oldPid, runtimeId: "0.9.0" };
        return { reportedPid: world.oldPid };
      }
      world.serving = { pid, runtimeId: id };
      return { reportedPid: pid };
    },
    kill: async (pid) => {
      world.events.push(`kill:${pid}`);
      world.alive.delete(pid);
    },
    isPortConflict: (err) => err instanceof PortConflict,
    pruneVersions: () => {},
    onCommittedExit: () => {},
    ...over,
  };
}

function freshWorld(over: Partial<FakeWorld> = {}): FakeWorld {
  return {
    clock: 0,
    oldPid: 100,
    oldExitsAt: 1_000,
    nextPid: 200,
    behaviour: {},
    events: [],
    alive: new Set([100]),
    serving: { pid: 100, runtimeId: "0.9.0" },
    ...over,
  };
}

describe("switchRuntime", () => {
  beforeEach(() => {
    selectRuntimeSource(dir, { source: "npm" });
    patchRuntimeState(dir, { current: "0.9.0" });
  });

  it("healthy: commits X, previous = old, attempts cleared", async () => {
    const world = freshWorld();
    const res = await switchRuntime("0.9.1", makeDeps(world));
    expect(res).toEqual({ kind: "committed", runtimeId: "0.9.1" });
    const state = readRuntimeState(dir);
    expect(state.current).toBe("0.9.1");
    expect(state.previous).toBe("0.9.0");
    expect(state.attempts?.["0.9.1"]).toBeUndefined();
    // extension re-pointed BEFORE the spawn
    expect(world.events.indexOf("register:/ext/0.9.1")).toBeLessThan(world.events.indexOf("spawn:0.9.1"));
  });

  it("X4: unhealthy candidate → bad + lastFailure; previous re-pointed before its spawn; previous stays current", async () => {
    const world = freshWorld({ behaviour: { "0.9.1": "unhealthy" } });
    const res = await switchRuntime("0.9.1", makeDeps(world));
    expect(res).toMatchObject({ kind: "rolledBack", failedId: "0.9.1", runtimeId: "0.9.0" });
    const state = readRuntimeState(dir);
    expect(state.bad?.["0.9.1"]?.reason).toContain("readiness timeout");
    expect(state.lastFailure).toMatchObject({ id: "0.9.1" });
    expect(state.current).toBe("0.9.0");
    const iReg = world.events.lastIndexOf("register:/ext/0.9.0");
    const iSpawn = world.events.lastIndexOf("spawn:0.9.0");
    expect(iReg).toBeGreaterThan(-1);
    expect(iReg).toBeLessThan(iSpawn);
    // the failed candidate is killed, never left running
    expect(world.events.some((e) => e === "kill:200")).toBe(true);
  });

  it("X4: the failed candidate is fully terminated BEFORE the rollback target spawns", async () => {
    const world = freshWorld({ behaviour: { "0.9.1": "unhealthy" } });
    let killDone = false;
    const deps = makeDeps(world, {
      kill: async (pid) => {
        world.events.push(`kill-start:${pid}`);
        await new Promise((r) => setTimeout(r, 20)); // slow termination
        killDone = true;
        world.events.push(`kill-done:${pid}`);
      },
    });
    const baseSpawn = deps.spawn;
    deps.spawn = async (source, hooks) => {
      if ((source as { runtimeId?: string }).runtimeId === "0.9.0") expect(killDone).toBe(true);
      return baseSpawn(source, hooks);
    };
    const res = await switchRuntime("0.9.1", deps);
    expect(res).toMatchObject({ kind: "rolledBack", runtimeId: "0.9.0" });
    expect(world.events.indexOf("kill-done:200")).toBeLessThan(world.events.lastIndexOf("spawn:0.9.0"));
  });

  it("X4: a candidate refused by the gate is marked bad and never spawned", async () => {
    const world = freshWorld();
    const res = await switchRuntime("0.9.9-incompatible", makeDeps(world));
    expect(res).toMatchObject({ kind: "rolledBack", failedId: "0.9.9-incompatible" });
    expect(world.events).not.toContain("spawn:0.9.9-incompatible");
    expect(readRuntimeState(dir).bad?.["0.9.9-incompatible"]?.reason).toBe("requires_app >=9.0.0");
  });

  it("X4: previous also fails → falls back to the bundle", async () => {
    const world = freshWorld({ behaviour: { "0.9.1": "unhealthy", "0.9.0": "unhealthy" } });
    const res = await switchRuntime("0.9.1", makeDeps(world));
    expect(res).toMatchObject({ kind: "rolledBack", runtimeId: "bundled" });
    expect(readRuntimeState(dir).current).toBe("bundled");
    expect(world.events.lastIndexOf("register:/ext/bundled")).toBeLessThan(world.events.lastIndexOf("spawn:bundled"));
  });

  it.each([
    [59_000, "committed"],
    [61_000, "aborted"],
  ] as const)("X5: old PID exits at %d ms → %s", async (exitAt, kind) => {
    const world = freshWorld({ oldExitsAt: exitAt });
    const res = await switchRuntime("0.9.1", makeDeps(world));
    expect(res.kind).toBe(kind);
    const state = readRuntimeState(dir);
    if (kind === "aborted") {
      expect(res).toMatchObject({ reason: "old_server_alive" });
      expect(state.current).toBe("0.9.0");
      expect(state.bad?.["0.9.1"]).toBeUndefined();
      expect(world.events).not.toContain("spawn:0.9.1");
    } else {
      expect(state.current).toBe("0.9.1");
    }
    expect(SWITCH_OLD_EXIT_DEADLINE_MS).toBe(60_000);
  });

  it("X6: the old server answering health never commits the candidate", async () => {
    const world = freshWorld({ behaviour: { "0.9.1": "old_answers" } });
    const res = await switchRuntime("0.9.1", makeDeps(world));
    expect(res.kind).not.toBe("committed");
    expect(readRuntimeState(dir).current).not.toBe("0.9.1");
  });

  it("X7: candidate exits EADDRINUSE → aborted, X not bad, old runtime current", async () => {
    const world = freshWorld({ behaviour: { "0.9.1": "port_in_use" } });
    const res = await switchRuntime("0.9.1", makeDeps(world));
    expect(res).toMatchObject({ kind: "aborted", reason: "port_in_use" });
    const state = readRuntimeState(dir);
    expect(state.bad?.["0.9.1"]).toBeUndefined();
    expect(state.current).toBe("0.9.0");
    expect(state.attempts?.["0.9.1"]).toBeUndefined();
  });

  it("X6: a server reporting the candidate id but the OLD pid is not committed", async () => {
    const world = freshWorld();
    const deps = makeDeps(world, {
      spawn: async (_source, hooks) => {
        hooks.onSpawned(300);
        world.serving = { pid: world.oldPid, runtimeId: "0.9.1" };
        return { reportedPid: world.oldPid };
      },
    });
    const res = await switchRuntime("0.9.1", deps);
    expect(res.kind).not.toBe("committed");
    expect(readRuntimeState(dir).current).not.toBe("0.9.1");
  });

  it("ownership is decided on the live health (owner token), so a restarted server (new PID) stays switchable", async () => {
    const world = freshWorld({ oldPid: 150, alive: new Set([150]), serving: { pid: 150, runtimeId: "0.9.0" } });
    const seen: Array<{ pid: number; owner?: string }> = [];
    const deps = makeDeps(world, {
      probeHealth: async () => (world.serving ? { pid: world.serving.pid, runtimeId: world.serving.runtimeId, owner: "tok" } : null),
      storedPid: () => 100, // stale: /api/restart replaced the server
      ownsServer: (h) => {
        seen.push(h);
        return h.owner === "tok" || h.pid === 100;
      },
    });
    const res = await switchRuntime("0.9.1", deps);
    expect(seen[0]).toMatchObject({ pid: 150, owner: "tok" });
    expect(res).toEqual({ kind: "committed", runtimeId: "0.9.1" });
  });

  it("never stops a server this app does not own (attached Standalone/Bridge/foreign)", async () => {
    const world = freshWorld();
    const res = await switchRuntime("0.9.1", makeDeps(world, { ownsServer: () => false }));
    expect(res).toEqual({ kind: "aborted", reason: "not_owned" });
    expect(world.events).toEqual([]);
    expect(readRuntimeState(dir).current).toBe("0.9.0");
  });

  it("a failed extension re-point aborts environmentally: no spawn with the wrong extension, X not bad", async () => {
    const world = freshWorld();
    const res = await switchRuntime(
      "0.9.1",
      makeDeps(world, {
        registerExtension: (p) => {
          if (p === "/ext/0.9.1") throw new Error("EACCES settings.json");
          world.events.push(`register:${p}`);
        },
      }),
    );
    expect(res).toMatchObject({ kind: "aborted", reason: "extension_register_failed" });
    expect(world.events).not.toContain("spawn:0.9.1");
    expect(readRuntimeState(dir).bad?.["0.9.1"]).toBeUndefined();
    expect(readRuntimeState(dir).attempts?.["0.9.1"]).toBeUndefined();
  });

  it("request.json is never written by Electron", async () => {
    const before = fs.readFileSync(path.join(dir, "request.json"), "utf8");
    await switchRuntime("0.9.1", makeDeps(freshWorld({ behaviour: { "0.9.1": "unhealthy" } })));
    expect(fs.readFileSync(path.join(dir, "request.json"), "utf8")).toBe(before);
    expect(readRuntimeRequest(dir)).not.toBeNull();
  });
});

describe("createSwitchQueue", () => {
  it("runs requests one at a time, each with its own target and result", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const run = vi.fn(async (target: string) => {
      order.push(`start:${target}`);
      if (target === "A") await gate;
      order.push(`end:${target}`);
      return { kind: "committed", runtimeId: target } as const;
    });
    const enqueue = createSwitchQueue(run);
    const a = enqueue("A");
    const b = enqueue("B");
    await Promise.resolve();
    expect(order).toEqual(["start:A"]);
    release();
    expect(await a).toEqual({ kind: "committed", runtimeId: "A" });
    expect(await b).toEqual({ kind: "committed", runtimeId: "B" });
    expect(order).toEqual(["start:A", "end:A", "start:B", "end:B"]);
  });

  it("a rejected switch does not wedge the queue", async () => {
    const enqueue = createSwitchQueue(async (t) => {
      if (t === "boom") throw new Error("boom");
      return { kind: "committed", runtimeId: t };
    });
    await expect(enqueue("boom")).rejects.toThrow("boom");
    expect(await enqueue("ok")).toEqual({ kind: "committed", runtimeId: "ok" });
  });
});

// ── Cold-launch candidate spawn (exit gating, identity, port conflict) ──────

describe("spawnColdCandidate", () => {
  const source = { kind: "overlay", cliPath: "/x/cli.ts", cwd: "/x", runtimeId: "0.9.1" } as const;
  class PortConflict extends Error {}

  function deps(over: Partial<ColdSpawnDeps> = {}): ColdSpawnDeps & { killed: number[]; exits: Array<[number | null, number]> } {
    const killed: number[] = [];
    const exits: Array<[number | null, number]> = [];
    return {
      killed,
      exits,
      spawn: async (_s, hooks) => {
        hooks.onSpawned(500);
        return { reportedPid: 500 };
      },
      probeHealth: async () => ({ pid: 500, runtimeId: "0.9.1" }),
      kill: async (pid) => {
        killed.push(pid);
      },
      isPortConflict: (err) => err instanceof PortConflict || (err as { cause?: unknown })?.cause instanceof PortConflict,
      onAcceptedExit: (code, _sig, pid) => exits.push([code, pid]),
      ...over,
    };
  }

  it("a candidate exiting before readiness never reaches the watchdog, and is reported failed", async () => {
    const d = deps({
      spawn: async (_s, hooks) => {
        hooks.onSpawned(501);
        hooks.onExit(1, null); // died during the health wait
        throw new Error("early exit");
      },
    });
    const res = await spawnColdCandidate(source, "0.9.1", d);
    expect(res).toMatchObject({ ok: false, portConflict: false });
    expect(d.exits).toEqual([]);
    expect(d.killed).toEqual([501]);
  });

  it("an accepted server's later exit reaches the watchdog WITH its pid (PID-scoped ownership)", async () => {
    let exit!: (code: number | null, signal: NodeJS.Signals | null) => void;
    const d = deps({
      spawn: async (_s, hooks) => {
        hooks.onSpawned(500);
        exit = hooks.onExit;
        return { reportedPid: 500 };
      },
    });
    expect(await spawnColdCandidate(source, "0.9.1", d)).toEqual({ ok: true, pid: 500 });
    exit(null, "SIGSEGV");
    expect(d.exits).toEqual([[null, 500]]);
  });

  it("no false commit: another server answering (wrong pid or runtime id) fails and kills the candidate", async () => {
    const wrongPid = deps({ probeHealth: async () => ({ pid: 42, runtimeId: "0.9.1" }) });
    expect(await spawnColdCandidate(source, "0.9.1", wrongPid)).toMatchObject({ ok: false });
    expect(wrongPid.killed).toEqual([500]);
    const wrongId = deps({ probeHealth: async () => ({ pid: 500, runtimeId: "bundled" }) });
    expect(await spawnColdCandidate(source, "0.9.1", wrongId)).toMatchObject({ ok: false });
  });

  it("a wrapped PortConflictError (spawnFromSource keeps it as cause) is classified environmental", async () => {
    const d = deps({
      spawn: async () => {
        throw new Error('Failed to spawn server from source "overlay": Port 8000 is occupied', { cause: new PortConflict() });
      },
    });
    expect(await spawnColdCandidate(source, "0.9.1", d)).toMatchObject({ ok: false, portConflict: true });
  });

  it("without identity verification (bundled/devMonorepo) readiness alone accepts", async () => {
    const d = deps({ probeHealth: async () => null });
    expect(await spawnColdCandidate({ kind: "bundled", cliPath: "/b", cwd: "/b" }, null, d)).toEqual({ ok: true, pid: 500 });
  });
});
