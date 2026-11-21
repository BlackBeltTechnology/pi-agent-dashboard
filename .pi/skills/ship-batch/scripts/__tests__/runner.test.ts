import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isDone } from "../scheduler.ts";
import { cleanupFixtures, FakeDashboard, type Fixture, makeFixture, readState, seedGroup, shipOnOrigin } from "./fake-dashboard.ts";

afterEach(cleanupFixtures);

/**
 * Simulates ship-it: a session streams for 20 s, then goes idle having shipped
 * (archive dir lands on origin/develop) or blocked (hand-back file) or stopped.
 */
function simulate(fd: FakeDashboard, fx: Fixture, fate: Record<string, "ship" | "block" | "stop">): void {
  const done = new Set<string>();
  fd.autoArchive = true;
  fd.onSleep = () => {
    for (const s of fd.sessions.values()) {
      const change = path.basename(s.cwd).replace(/^os-/, "");
      if (s.status === "streaming" && fd.now() - s.startedAt >= 20_000 && !done.has(s.id)) {
        done.add(s.id);
        s.status = "idle";
        if (fate[change] === "ship") shipOnOrigin(fx, change);
        if (fate[change] === "block") {
          const f = path.join(s.cwd, "openspec", "changes", change, "SHIP_IT_BLOCKED.md");
          fs.mkdirSync(path.dirname(f), { recursive: true });
          fs.writeFileSync(f, "blocked\n");
        }
      }
    }
  };
}

const world = (changes: string[], fate: Record<string, "ship" | "block" | "stop">) => {
  const fx = makeFixture();
  const fd = new FakeDashboard(fx);
  seedGroup(fd, changes);
  simulate(fd, fx, fate);
  return { fx, fd };
};

describe("#E21 exit codes", () => {
  it("every change shipped -> 0", async () => {
    const { fd } = world(["a", "b"], { a: "ship", b: "ship" });
    expect(await fd.main(["--group", "g"])).toBe(0);
  });

  it("one change kept (blocked) -> 2, and the report names the kept worktree", async () => {
    const { fd } = world(["a", "b"], { a: "ship", b: "block" });
    const out: string[] = [];
    expect(await fd.main(["--group", "g"], { out: (l) => void out.push(l) })).toBe(2);
    expect(out.join("\n")).toContain(fd.worktree("b"));
    expect(out.join("\n")).toMatch(/a: shipped/);
  });

  it("an incomplete change (stopped, nudge budget used) -> 2", async () => {
    const { fd } = world(["a"], { a: "stop" });
    expect(await fd.main(["--group", "g"])).toBe(2);
    expect(fd.prompts).toHaveLength(1); // one bounded nudge, then teardown
    expect(fd.prompts[0].text).toBe("Continue /skill:ship-it for a from where you stopped.");
  });

  it("a preflight failure -> 1", async () => {
    const { fd } = world(["a"], {});
    fd.config = { spawnStrategy: "tmux" };
    expect(await fd.main(["--group", "g"])).toBe(1);
  });
});

describe("#E22 persistence per transition", () => {
  it("state always parses, no .tmp is left, events == transitions + actions", async () => {
    const { fx, fd } = world(["a", "b"], { a: "ship", b: "ship" });
    const runner = fd.runner();
    await fd.boot(runner);
    const dir = path.join(fx.repo, ".worktrees", ".ship-batch");
    let guard = 0;
    while (!isDone(runner.state) && guard++ < 200) {
      await runner.tick();
      expect(() => readState(fx)).not.toThrow();
      expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
      await fd.sleep(10_000);
    }
    expect(isDone(runner.state)).toBe(true);
    expect(await runner.runLoop()).toBe(0);

    const events = fs
      .readFileSync(path.join(dir, "g.events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { ev: string });
    const transitions = readState(fx).items.reduce((n, i) => n + i.history.length, 0);
    expect(events.filter((e) => e.ev === "transition")).toHaveLength(transitions);
    expect(events.filter((e) => e.ev === "action")).toHaveLength(runner.actionsExecuted);
    expect(transitions).toBeGreaterThan(8);
  });
});

describe("#X13 signal handling", () => {
  it("SIGTERM: exit 143, both items still running, lock removed, no archive/remove calls", async () => {
    const fx = makeFixture();
    const child = spawn(process.execPath, ["--import", "tsx", path.join(import.meta.dirname, "signal-child.ts")], {
      cwd: path.resolve(import.meta.dirname, "../../../../.."),
      env: { ...process.env, FIXTURE_ROOT: fx.root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let errOut = "";
    child.stderr.on("data", (d) => void (errOut += String(d)));
    const ready = new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (d) => {
        out += String(d);
        if (out.includes("READY")) resolve();
      });
      child.on("exit", () => reject(new Error(`child exited before READY\n${out}\n${errOut}`)));
    });
    await ready;
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
    child.kill("SIGTERM");
    expect(await exited, errOut).toBe(143);
    const st = readState(fx);
    expect(st.items.map((i) => i.state)).toEqual(["running", "running"]);
    expect(fs.existsSync(path.join(fx.repo, ".worktrees", ".ship-batch", "lock"))).toBe(false);
    expect(out).toContain("CALLS_BAD 0");
  }, 60_000);
});

describe("#X17 dry run", () => {
  it("prints order, waits, skips and will-ask; leaves no trace", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["a", "b", "c", "d", "e"]);
    fd.edges = {
      b: [{ change: "a", state: "open" }], // wait
      c: [{ change: "d", state: "open" }], // cycle c <-> d
      d: [{ change: "c", state: "open" }],
      e: [{ change: "outside", state: "open" }], // will ask
    };
    const out: string[] = [];
    expect(await fd.main(["--group", "g", "--dry-run"], { out: (l) => void out.push(l) })).toBe(0);
    const text = out.join("\n");
    expect(text).toMatch(/1\. a/);
    expect(text).toMatch(/b.*waits for a/);
    expect(text).toMatch(/c.*skipped: cycle/);
    expect(text).toMatch(/d.*skipped: cycle/);
    expect(text).toMatch(/e.*will ask.*outside/);
    const wts = path.join(fx.repo, ".worktrees");
    expect(fs.existsSync(wts)).toBe(false);
    expect(fd.callsTo("POST", "")).toHaveLength(0);
    expect(fd.connectAttempts).toBe(0);
    expect(fd.spawned).toHaveLength(0);
  });
});
