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
