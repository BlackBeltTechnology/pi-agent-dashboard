import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupFixtures, FakeDashboard, makeFixture, readState, seedGroup, sh } from "./fake-dashboard.ts";

afterEach(cleanupFixtures);

const setup = (changes: string[], argv?: string[]) => {
  const fx = makeFixture();
  const fd = new FakeDashboard(fx);
  seedGroup(fd, changes);
  const runner = fd.runner(argv);
  return { fx, fd, runner };
};

const created = (fd: FakeDashboard) => fd.callsTo("POST", "/api/git/worktree").filter((c) => c.path === "/api/git/worktree");

describe("#E19 worktree selection", () => {
  it("(a) a registered .worktrees/os-x is reused: no create call", async () => {
    const { fx, fd, runner } = setup(["x"]);
    sh(fx.repo, "worktree", "add", "-b", "os/x", path.join(fx.repo, ".worktrees", "os-x"), "develop");
    await fd.boot(runner);
    await runner.tick();
    expect(created(fd)).toHaveLength(0);
    expect(fd.spawned).toHaveLength(1);
    expect(fd.spawned[0]).toMatchObject({ cwd: fd.worktree("x"), attachProposal: "x", model: "@coding", initialPrompt: "/skill:ship-it" });
  });

  it("(b) an existing local branch os/x is checked out (no newBranch)", async () => {
    const { fx, fd, runner } = setup(["x"]);
    sh(fx.repo, "branch", "os/x", "develop");
    await fd.boot(runner);
    await runner.tick();
    expect(created(fd).map((c) => c.body)).toEqual([{ cwd: fx.repo, base: "os/x" }]);
  });

  it("(c) only origin/os/x -> base origin/os/x", async () => {
    const { fx, fd, runner } = setup(["x"]);
    sh(fx.repo, "branch", "os/x", "develop");
    sh(fx.repo, "push", "-q", "origin", "os/x");
    sh(fx.repo, "branch", "-D", "os/x");
    sh(fx.repo, "fetch", "-q", "origin");
    await fd.boot(runner);
    await runner.tick();
    expect(created(fd).map((c) => c.body)).toEqual([{ cwd: fx.repo, base: "origin/os/x" }]);
  });

  it("(d) nothing exists -> fork from develop", async () => {
    const { fx, fd, runner } = setup(["x"]);
    await fd.boot(runner);
    await runner.tick();
    expect(created(fd).map((c) => c.body)).toEqual([{ cwd: fx.repo, base: "develop", newBranch: "os/x" }]);
    expect(readState(fx).items[0]).toMatchObject({ state: "running", sessionId: "s-1" });
  });
});

describe("#X3 untrusted init halts scheduling", () => {
  it("fails the item, tears it down, starts nothing else, keeps the first running", async () => {
    const { fx, fd, runner } = setup(["a", "b", "c", "d"]);
    fd.on("POST /api/git/worktree/init", (body) =>
      String(body.cwd).endsWith("os-b") ? { status: 200, json: { success: false, code: "init_untrusted", data: { hash: "h" } } } : undefined,
    );
    await fd.boot(runner);
    await runner.tick(); // starts a and b (N=2)
    const st = readState(fx);
    const by = Object.fromEntries(st.items.map((i) => [i.change, i]));
    expect(by.a.state).toBe("running");
    expect(by.b).toMatchObject({ state: "failed", reason: "init_untrusted" });
    expect(fs.existsSync(fd.worktree("b"))).toBe(false); // torn down
    expect(st.halted).toMatch(/untrusted/);
    expect(st.notes.join(" ")).toContain("trust the init hook");
    fd.tick();
    await runner.tick();
    expect(fd.spawned).toHaveLength(1); // no further start after the halt
    expect(readState(fx).items.filter((i) => i.state === "queued").map((i) => i.change)).toEqual(["c", "d"]);
  });
});

describe("#X4 init_failed / spawn failure", () => {
  it("(a) init_failed: item failed, fresh worktree + branch removed, next item starts", async () => {
    const { fx, fd, runner } = setup(["a", "b", "c"], ["--group", "g", "--parallel", "1"]);
    fd.on("POST /api/git/worktree/init", (body) => (String(body.cwd).endsWith("os-a") ? { status: 500, json: { success: false, code: "init_failed" } } : undefined));
    await fd.boot(runner);
    await runner.tick();
    const st = readState(fx);
    expect(st.items.find((i) => i.change === "a")).toMatchObject({ state: "failed", reason: "init_failed" });
    expect(fs.existsSync(fd.worktree("a"))).toBe(false);
    expect(() => sh(fx.repo, "rev-parse", "--verify", "--quiet", "refs/heads/os/a")).toThrow();
    fd.tick();
    await runner.tick();
    expect(fd.spawned.map((s) => s.attachProposal)).toEqual(["b"]); // scheduling continued
  });

  it("(b) spawn_result failure behaves the same", async () => {
    const { fx, fd, runner } = setup(["a", "b"], ["--group", "g", "--parallel", "1"]);
    await fd.boot(runner);
    fd.spawnError = new Error("session start failed: boom");
    await runner.tick();
    expect(readState(fx).items[0]).toMatchObject({ state: "failed" });
    expect(fs.existsSync(fd.worktree("a"))).toBe(false);
    expect(() => sh(fx.repo, "rev-parse", "--verify", "--quiet", "refs/heads/os/a")).toThrow();
    fd.spawnError = null;
    fd.tick();
    await runner.tick();
    expect(fd.spawned.map((s) => s.attachProposal)).toEqual(["b"]);
  });

  it("a spawn timeout adopts the one matching resident session", async () => {
    const { fx, fd, runner } = setup(["a"]);
    await fd.boot(runner);
    fd.spawnError = new Error("timed out after 60000ms waiting for spawn(x)");
    fd.spawnTimeoutAdopts = true;
    await runner.tick();
    expect(readState(fx).items[0]).toMatchObject({ state: "running", sessionId: "s-1" });
  });

  it("a spawn timeout with no matching session fails the item", async () => {
    const { fx, fd, runner } = setup(["a"]);
    await fd.boot(runner);
    fd.spawnError = new Error("timed out after 60000ms waiting for spawn(x)");
    await runner.tick();
    expect(readState(fx).items[0].state).toBe("failed");
  });
});

describe("#X19 husk / branch_in_use on create", () => {
  it("(a) path_exists with an unregistered dir: orphan-cleanup, retry once, success", async () => {
    const { fx, fd, runner } = setup(["x"]);
    fs.mkdirSync(fd.worktree("x"), { recursive: true });
    fs.writeFileSync(path.join(fd.worktree("x"), "junk"), "x");
    await fd.boot(runner);
    await runner.tick();
    expect(fd.callsTo("POST", "/api/git/worktree/orphan-cleanup")).toHaveLength(1);
    expect(created(fd)).toHaveLength(2);
    expect(fd.spawned).toHaveLength(1);
    expect(readState(fx).items[0].state).toBe("running");
    expect(fs.existsSync(path.join(fx.repo, ".worktrees", "os-x", ".git"))).toBe(true);
  });

  it("(b) branch_in_use: item failed with that reason, nothing spawned", async () => {
    const { fx, fd, runner } = setup(["x"]);
    fd.on("POST /api/git/worktree", (body) => (body.base === "develop" ? { status: 409, json: { success: false, code: "branch_in_use" } } : undefined));
    await fd.boot(runner);
    await runner.tick();
    expect(readState(fx).items[0]).toMatchObject({ state: "failed", reason: "branch_in_use" });
    expect(fd.spawned).toHaveLength(0);
  });
});
