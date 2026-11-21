/**
 * Regression tests for the PR-review findings (lock acquisition races, ownership
 * loss, stale observations, signals before the runner exists, halted exit,
 * unsafe worktree reuse, staged local config, archive transport errors).
 *
 * See change: add-ship-batch-orchestrator.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseArgs } from "../args.ts";
import { LockFile, LockRefused } from "../lockfile.ts";
import { teardownPlan, type WorktreeFacts } from "../outcome.ts";
import { installSignalHandlers, type Runner, runMain } from "../runner.ts";
import { setState } from "../scheduler.ts";
import { cleanupFixtures, FakeDashboard, makeFixture, readState, seedGroup, sh } from "./fake-dashboard.ts";

afterEach(cleanupFixtures);

const self = { pid: 4242, hostname: "h" };
const NOW = 1_800_000_000_000;

describe("LockFile", () => {
  const tmpLock = () => {
    const fx = makeFixture();
    fs.mkdirSync(path.join(fx.repo, ".worktrees", ".ship-batch"), { recursive: true });
    return path.join(fx.repo, ".worktrees", ".ship-batch", "lock");
  };

  it("publishes a complete, parseable record", () => {
    const file = tmpLock();
    const lock = new LockFile(file, self, () => NOW);
    lock.acquire("g");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ pid: 4242, hostname: "h", groupId: "g", heartbeatAt: NOW });
    expect(lock.isOurs()).toBe(true);
  });

  it("a recent unreadable lock (another runner mid-start) is refused, never reclaimed", () => {
    const file = tmpLock();
    fs.writeFileSync(file, ""); // as seen between create and write
    const lock = new LockFile(file, self, () => fs.statSync(file).mtimeMs + 1_000);
    expect(() => lock.acquire("g")).toThrow(LockRefused);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("an unreadable lock whose mtime is itself stale is replaced", () => {
    const file = tmpLock();
    fs.writeFileSync(file, "not json");
    const mtime = fs.statSync(file).mtimeMs;
    const lock = new LockFile(file, self, () => mtime + 11 * 60_000);
    lock.acquire("g");
    expect(lock.isOurs()).toBe(true);
  });

  it("a stale takeover is serialised: a fresh takeover mutex makes the contender back off", () => {
    const file = tmpLock();
    fs.writeFileSync(file, JSON.stringify({ pid: 1, hostname: "h", groupId: "g", heartbeatAt: NOW - 3_600_000 }));
    fs.writeFileSync(`${file}.takeover`, "");
    const lock = new LockFile(file, self, () => fs.statSync(`${file}.takeover`).mtimeMs + 1_000, () => false);
    expect(() => lock.acquire("g")).toThrow(/replacing the lock/);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).pid).toBe(1); // untouched
  });

  it("a stale lock is taken over and the mutex is cleaned up", () => {
    const file = tmpLock();
    fs.writeFileSync(file, JSON.stringify({ pid: 1, hostname: "h", groupId: "g", heartbeatAt: NOW - 3_600_000 }));
    const lock = new LockFile(file, self, () => NOW, () => false);
    lock.acquire("g");
    expect(lock.isOurs()).toBe(true);
    expect(fs.existsSync(`${file}.takeover`)).toBe(false);
  });

  it("ownership is positive: a missing or foreign file is not ours and a heartbeat never recreates it", () => {
    const file = tmpLock();
    const lock = new LockFile(file, self, () => NOW);
    lock.acquire("g");
    fs.rmSync(file);
    expect(lock.isOurs()).toBe(false);
    expect(lock.heartbeat("g")).toBe("lost");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("release never removes a successor's lock", () => {
    const file = tmpLock();
    const lock = new LockFile(file, self, () => NOW);
    lock.acquire("g");
    fs.writeFileSync(file, JSON.stringify({ pid: 7, hostname: "h", groupId: "g", heartbeatAt: NOW }));
    lock.release();
    expect(JSON.parse(fs.readFileSync(file, "utf8")).pid).toBe(7);
  });
});

describe("lock lost → stand down", () => {
  it("the old runner stops dispatching and stops writing state once a successor holds the lock", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["x"]);
    const runner = fd.runner();
    await fd.boot(runner);
    const lockPath = path.join(fx.repo, ".worktrees", ".ship-batch", "lock");
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid + 1, hostname: "test-host", groupId: "g", heartbeatAt: fd.now() }));
    await runner.tick(); // dispatches (starts x), then the heartbeat discovers the loss
    expect(runner.stopRequested()).toBe(1);
    const stateBefore = fs.readFileSync(path.join(fx.repo, ".worktrees", ".ship-batch", "g.json"), "utf8");
    fd.tick();
    await runner.tick();
    expect(fs.readFileSync(path.join(fx.repo, ".worktrees", ".ship-batch", "g.json"), "utf8")).toBe(stateBefore);
    expect(fd.spawned).toHaveLength(1); // nothing more dispatched
  });
});

describe("stale observations", () => {
  it("a bus that drops while the questions call is pending decides nothing", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["x"]);
    const runner = fd.runner();
    await fd.boot(runner);
    fd.on("GET /api/questions", () => {
      fd.disconnect();
      return undefined;
    });
    await runner.tick();
    expect(fd.spawned).toHaveLength(0);
    expect(readState(fx).items[0].state).toBe("queued");
  });

  it("a start the bus drop prevented goes back to queued (not stuck in starting)", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["a", "b"]);
    const runner = fd.runner();
    await fd.boot(runner);
    // `a` starts; while its init call blocks the bus drops, so `b` must not start on the old snapshot.
    fd.on("POST /api/git/worktree/init", (body) => {
      if (String(body.cwd).endsWith("os-a")) fd.disconnect();
      return undefined;
    });
    await runner.tick();
    const by = Object.fromEntries(runner.state.items.map((i) => [i.change, i]));
    expect(by.a.state).toBe("running");
    expect(by.b).toMatchObject({ state: "queued" });
    expect(by.b.spawnRequestedAt).toBeUndefined();
    expect(fd.spawned.map((s) => s.attachProposal)).toEqual(["a"]);
  });
});

describe("untrusted init hook halt", () => {
  it("a start already queued behind the halting one is not dispatched and returns to queued", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["a", "b"]);
    fd.on("POST /api/git/worktree/init", (body) =>
      String(body.cwd).endsWith("os-a") ? { status: 200, json: { success: false, code: "init_untrusted" } } : undefined,
    );
    const runner = fd.runner();
    await fd.boot(runner);
    await runner.tick(); // N=2: a and b are scheduled in the same tick
    const by = Object.fromEntries(runner.state.items.map((i) => [i.change, i]));
    expect(by.a.state).toBe("failed");
    expect(by.b.state).toBe("queued");
    expect(by.b.spawnRequestedAt).toBeUndefined();
    expect(fd.spawned).toHaveLength(0);
  });

  it("a halted run whose live items finish exits 2 and reports the trust hint instead of ticking forever", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["a", "b", "c"]);
    fd.on("POST /api/git/worktree/init", (body) =>
      String(body.cwd).endsWith("os-a") ? { status: 200, json: { success: false, code: "init_untrusted" } } : undefined,
    );
    const out: string[] = [];
    expect(await fd.main(["--group", "g", "--parallel", "1"], { out: (l) => void out.push(l) })).toBe(2);
    const text = out.join("\n");
    expect(text).toMatch(/b: skipped — scheduling halted/);
    expect(text).toContain("trust the init hook");
  });
});

describe("worktree reuse and WIP safety", () => {
  it("a registered worktree on another branch is not reused: the item fails, the worktree is untouched", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["x"]);
    sh(fx.repo, "worktree", "add", "-b", "scratch", fd.worktree("x"), "develop");
    const runner = fd.runner();
    await fd.boot(runner);
    await runner.tick();
    const item = runner.state.items[0];
    expect(item.state).toBe("failed");
    expect(item.reason).toMatch(/scratch.*os\/x/);
    expect(fd.spawned).toHaveLength(0);
    expect(fs.existsSync(fd.worktree("x"))).toBe(true);
  });

  it("teardown keeps a worktree whose HEAD is not os/<change>", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["x"]);
    const runner = fd.runner();
    await fd.boot(runner);
    await runner.tick();
    const item = runner.state.items[0];
    sh(fd.worktree("x"), "checkout", "-q", "-b", "scratch");
    fd.setStatus(item.sessionId as string, "ended");
    item.outcome = "incomplete";
    setState(item, "teardown", fd.now());
    fd.tick(31_000);
    await runner.tick();
    expect(item.state).toBe("kept");
    expect(item.reason).toMatch(/scratch/);
    expect(fd.callsTo("POST", "/api/git/worktree/remove")).toHaveLength(0);
  });

  it("an unreadable git status keeps the worktree (plan level)", () => {
    const facts: WorktreeFacts = { registered: true, dirt: [], aheadOfDevelop: 0, midOperation: false, branchExists: true, unsafe: "the worktree state could not be read (git status failed)" };
    for (const o of ["incomplete", "failed", "blocked", "shipped"] as const) {
      expect(teardownPlan(o, facts)).toMatchObject({ result: "kept", steps: [] });
    }
  });

  it("staged .pi/settings.json never enters the WIP commit", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["x"]);
    const runner = fd.runner();
    await fd.boot(runner);
    await runner.tick();
    const item = runner.state.items[0];
    const wt = fd.worktree("x");
    fs.appendFileSync(path.join(wt, "README.md"), "work\n");
    fs.writeFileSync(path.join(wt, ".pi", "settings.json"), '{"local":true}\n');
    sh(wt, "add", ".pi/settings.json"); // the developer staged it
    fd.setStatus(item.sessionId as string, "ended");
    item.outcome = "incomplete";
    setState(item, "teardown", fd.now());
    fd.tick(31_000);
    await runner.tick();
    const files = sh(fx.origin, "diff-tree", "--no-commit-id", "--name-only", "-r", "os/x").split("\n").filter(Boolean);
    expect(files).toEqual(["README.md"]);
  });
});

describe("archive transport errors", () => {
  it("a lost connection on the archive POST is retried within the bound, not kept on the first error", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["x"]);
    const runner = fd.runner();
    await fd.boot(runner);
    await runner.tick();
    const item = runner.state.items[0];
    fd.setStatus(item.sessionId as string, "ended");
    item.outcome = "incomplete";
    setState(item, "teardown", fd.now());
    let first = true;
    fd.on("POST /api/session/", () => {
      if (first) {
        first = false;
        throw new Error("ECONNRESET");
      }
      return undefined;
    });
    fd.tick(31_000);
    await runner.tick();
    expect(item.state).toBe("teardown"); // inconclusive, not terminal
    fd.tick(31_000);
    await runner.tick();
    expect(item.state).toBe("incomplete");
    expect(fd.callsTo("POST", "/api/git/worktree/remove")).toHaveLength(1);
  });
});

describe("signals before the runner exists", () => {
  it("the first early signal is remembered and later ones do not replace it", () => {
    const proc = new EventEmitter() as unknown as NodeJS.Process;
    let runner: Runner | undefined;
    const handle = installSignalHandlers(() => runner, proc);
    proc.emit("SIGTERM");
    proc.emit("SIGINT");
    expect(handle.pending()).toBe(143);
    handle.dispose();
    expect(proc.listenerCount("SIGTERM")).toBe(0);
  });

  it("a stop delivered to the runner during preflight returns its code before any bus connect or state write", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["x"]);
    const parsed = parseArgs(["--group", "g"]);
    if (!parsed.ok) throw new Error(parsed.error);
    const code = await runMain({ ...parsed.args, cwd: fx.repo }, fd.deps(), { onRunner: (r) => r.requestStop(143) });
    expect(code).toBe(143);
    expect(fd.connectAttempts).toBe(0);
    expect(fs.existsSync(path.join(fx.repo, ".worktrees", ".ship-batch"))).toBe(false);
  });
});

describe("resume does not depend on a fresh dependency lookup", () => {
  it("a running run is re-attached even when a dependency lookup would now fail", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["x", "y"]);
    const first = fd.runner();
    await fd.boot(first);
    await first.tick(); // starts x and y, state persisted with running items
    first.releaseLock();
    fd.rest503.set("x", 99); // every dependency lookup would now return 503
    const again = fd.runner();
    await fd.boot(again);
    expect(again.state.items.map((i) => i.state)).toEqual(["running", "running"]);
    expect(fd.spawned).toHaveLength(2);
  });
});
