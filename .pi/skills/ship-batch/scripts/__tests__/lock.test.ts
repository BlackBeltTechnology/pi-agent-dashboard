import { describe, expect, it } from "vitest";
import { LOCK_STALE_MS, type LockInfo, lockDecision } from "../lock.ts";
import { T0 } from "./helpers.ts";

const self = { hostname: "h1", pid: 100 };
const lock = (over: Partial<LockInfo> = {}): LockInfo => ({ pid: 200, hostname: "h1", groupId: "g", heartbeatAt: T0, ...over });

describe("#E18 lock decision", () => {
  const alive = () => true;
  const dead = () => false;
  it("none -> acquire", () => expect(lockDecision(null, self, T0, alive)).toEqual({ action: "acquire" }));
  it("other host -> refuse", () => {
    expect(lockDecision(lock({ hostname: "h2" }), self, T0, dead).action).toBe("refuse");
  });
  it("alive + heartbeat 9:59 -> refuse naming the pid", () => {
    const d = lockDecision(lock(), self, T0 + LOCK_STALE_MS - 1000, alive);
    expect(d.action).toBe("refuse");
    expect(d.action === "refuse" ? d.reason : "").toContain("200");
  });
  it("alive + heartbeat 10:00 -> takeover", () => {
    expect(lockDecision(lock(), self, T0 + LOCK_STALE_MS, alive)).toEqual({ action: "takeover" });
  });
  it("dead pid -> takeover", () => {
    expect(lockDecision(lock(), self, T0 + 1000, dead)).toEqual({ action: "takeover" });
  });
});

describe("#X16 single runner across worktrees", () => {
  it("a runner started inside a worktree resolves the same lock and is refused, naming the holder", async () => {
    const { cleanupFixtures, FakeDashboard, makeFixture, seedGroup, sh } = await import("./fake-dashboard.ts");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const fx = makeFixture();
    try {
      const fd = new FakeDashboard(fx);
      seedGroup(fd, ["a"]);
      const runner1 = fd.runner(["--group", "g"], { isAlive: () => true });
      await fd.boot(runner1);
      const lockPath = path.join(fx.repo, ".worktrees", ".ship-batch", "lock");
      const held = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { pid: number };

      const wtY = path.join(fx.repo, ".worktrees", "os-y");
      sh(fx.repo, "worktree", "add", "-b", "os/y", wtY, "develop");
      const errs: string[] = [];
      const code = await fd.main(["--group", "g", "--cwd", wtY], { isAlive: () => true, err: (l) => void errs.push(l) });
      expect(code).toBe(1);
      expect(errs.join("\n")).toContain(String(held.pid));
      expect(fs.existsSync(lockPath)).toBe(true); // runner 1's lock untouched
    } finally {
      cleanupFixtures();
    }
  });
});

describe("#B1 the lock heartbeat survives a long-blocking action", () => {
  it("an interval refreshes heartbeatAt while an init call blocks, so a second runner is still refused", async () => {
    const { cleanupFixtures, FakeDashboard, makeFixture, seedGroup } = await import("./fake-dashboard.ts");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const fx = makeFixture();
    try {
      const fd = new FakeDashboard(fx);
      seedGroup(fd, ["x"]);
      let release: () => void = () => {};
      let entered: () => void = () => {};
      const inInit = new Promise<void>((r) => (entered = r));
      fd.on("POST /api/git/worktree/init", async () => {
        entered();
        await new Promise<void>((r) => (release = r));
        return undefined;
      });
      const runner = fd.runner(["--group", "g"], { isAlive: () => true }, { heartbeatMs: 15 });
      await fd.boot(runner);
      const lockPath = path.join(fx.repo, ".worktrees", ".ship-batch", "lock");
      const started = (JSON.parse(fs.readFileSync(lockPath, "utf8")) as { heartbeatAt: number }).heartbeatAt;
      const loop = runner.runLoop();
      await inInit;
      fd.t += LOCK_STALE_MS + 60_000; // the init call has been blocking for over 10 minutes
      await new Promise((r) => setTimeout(r, 120));
      const beat = (JSON.parse(fs.readFileSync(lockPath, "utf8")) as { heartbeatAt: number }).heartbeatAt;
      expect(beat).toBeGreaterThan(started + LOCK_STALE_MS);
      const errs: string[] = [];
      expect(await fd.main(["--group", "g"], { isAlive: () => true, err: (l) => void errs.push(l) })).toBe(1);
      runner.requestStop(143);
      release();
      expect(await loop).toBe(143);
      expect(fs.existsSync(lockPath)).toBe(false); // released, interval cleared
    } finally {
      cleanupFixtures();
    }
  });

  it("a heartbeat never overwrites a lock a successor now holds", async () => {
    const { cleanupFixtures, FakeDashboard, makeFixture, seedGroup } = await import("./fake-dashboard.ts");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const fx = makeFixture();
    try {
      const fd = new FakeDashboard(fx);
      seedGroup(fd, ["x"]);
      const runner = fd.runner();
      await fd.boot(runner);
      const lockPath = path.join(fx.repo, ".worktrees", ".ship-batch", "lock");
      const foreign = { pid: process.pid + 1, hostname: "test-host", groupId: "g", heartbeatAt: fd.now() };
      fs.writeFileSync(lockPath, JSON.stringify(foreign));
      await runner.tick();
      expect(JSON.parse(fs.readFileSync(lockPath, "utf8"))).toEqual(foreign);
    } finally {
      cleanupFixtures();
    }
  });
});

describe("#B1b the lock is released when the run throws", () => {
  it("a throw out of the loop still removes the lock", async () => {
    const { cleanupFixtures, FakeDashboard, makeFixture, seedGroup } = await import("./fake-dashboard.ts");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const fx = makeFixture();
    try {
      const fd = new FakeDashboard(fx);
      seedGroup(fd, ["x"]);
      const code = await fd.main(["--group", "g"], {
        sleep: async () => {
          throw new Error("boom");
        },
      });
      expect(code).toBe(1);
      expect(fs.existsSync(path.join(fx.repo, ".worktrees", ".ship-batch", "lock"))).toBe(false);
    } finally {
      cleanupFixtures();
    }
  });
});
