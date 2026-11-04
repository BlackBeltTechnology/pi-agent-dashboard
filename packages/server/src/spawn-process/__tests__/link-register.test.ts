/**
 * Registry linking by pid target: tier 1 (token) always; tiers 2–3 skipped for
 * a non-local register; an `unknown` register links by pid only within its own
 * cwd. Link-time resolution never uses own-entry evidence (no circularity).
 * Test-plan rows E76–E83. See change: scope-pids-to-namespace.
 */
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type PidTarget, resolvePidTarget } from "../../session/pid-target.js";
import { createHeadlessPidRegistry } from "../headless-pid-registry.js";
import { linkRegisterToSpawn } from "../link-register.js";

const proc = () => new EventEmitter() as unknown as ChildProcess;
const registry = () => createHeadlessPidRegistry({ pidFilePath: join(mkdtempSync(join(tmpdir(), "link-reg-")), "pids.json") });
const quiet = () => {};
const NON_LOCAL: PidTarget[] = [{ kind: "foreign" }, { kind: "wsl", distro: "U" }, { kind: "legacy-wsl" }];

describe("linkRegisterToSpawn — pid target gates tiers 2–3", () => {
  it("E76: the pid tier is skipped for every non-local target", () => {
    for (const t of NON_LOCAL) {
      const r = registry();
      r.register(4242, "/a", proc());
      expect(linkRegisterToSpawn(r, { sessionId: "S", pid: 4242, cwd: "/a" }, t, quiet)).toBe("none");
      expect(r.getPid("S")).toBeUndefined();
    }
  });

  it("E77: the cwd-FIFO tier is skipped for a non-local target", () => {
    const r = registry();
    r.register(7001, "/a", proc());
    expect(linkRegisterToSpawn(r, { sessionId: "S", pid: 4242, cwd: "/a" }, { kind: "foreign" }, quiet)).toBe("none");
    expect(r.getPid("S")).toBeUndefined();
  });

  it("E78: an `unknown` target links by pid only in its own cwd", () => {
    const same = registry();
    same.register(4242, "/a", proc());
    expect(linkRegisterToSpawn(same, { sessionId: "S", pid: 4242, cwd: "/a" }, { kind: "unknown" }, quiet)).toBe("pid");
    const other = registry();
    other.register(4242, "/a", proc());
    expect(linkRegisterToSpawn(other, { sessionId: "S", pid: 4242, cwd: "/b" }, { kind: "unknown" }, quiet)).not.toBe("pid");
    expect(other.getPid("S")).toBeUndefined();
  });

  it("E79: an `unknown` target may still link by cwd-FIFO", () => {
    const r = registry();
    r.register(7001, "/a", proc());
    expect(linkRegisterToSpawn(r, { sessionId: "S", pid: 4242, cwd: "/a" }, { kind: "unknown" }, quiet)).toBe("cwd");
    expect(r.getPid("S")).toBe(7001);
  });

  it("E80: the token tier is unchanged for a non-local target", () => {
    const r = registry();
    r.register(100, "/a", proc(), "T1");
    expect(linkRegisterToSpawn(r, { sessionId: "S", spawnToken: "T1", pid: 4242, cwd: "/a" }, { kind: "foreign" }, quiet)).toBe(
      "token",
    );
    expect(r.getPid("S")).toBeDefined();
  });

  it("E81: a stale token falls through, and tiers 2–3 stay skipped for wsl", () => {
    const r = registry();
    r.register(4242, "/a", proc(), "REAL");
    const t: PidTarget = { kind: "wsl", distro: "U" };
    expect(linkRegisterToSpawn(r, { sessionId: "S", spawnToken: "STALE", pid: 4242, cwd: "/a" }, t, quiet)).toBe("none");
    expect(r.getPid("S")).toBeUndefined();
  });

  it("E82: link time never uses own-entry evidence — a legacy win32 POSIX-cwd register is not linked", () => {
    const r = registry();
    r.register(4242, "/home/u/p", proc());
    const target = resolvePidTarget({ pid: 4242, cwd: "/home/u/p" }, { platform: "win32", hostId: "WINBOX" });
    expect(target.kind).toBe("legacy-wsl");
    expect(linkRegisterToSpawn(r, { sessionId: "S", pid: 4242, cwd: "/home/u/p" }, target, quiet)).toBe("none");
    expect(r.getPid("S")).toBeUndefined();
  });

  it("E83: a host target links by pid across cwds, as before", () => {
    const r = registry();
    r.register(4242, "/x", proc());
    expect(linkRegisterToSpawn(r, { sessionId: "S", pid: 4242, cwd: "/y" }, { kind: "host" }, quiet)).toBe("pid");
    expect(r.getPid("S")).toBe(4242);
  });
});
