/**
 * Worktree predicate + durable log scenarios E13-E18, X1.
 * See change: fix-worktree-server-autostart-leak.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendAutoStartLog,
  isWorktreeCliPath,
  shouldRefuseWorktreeAutoStart,
} from "../autostart-guard.js";

const WORKTREE_CLI = "/repo/.worktrees/os-x/packages/server/src/cli.ts";
const HOST_CLI = "/home/u/.pi-dashboard/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts";
const identity = (p: string) => p;

describe("isWorktreeCliPath", () => {
  it("matches a literal .worktrees path segment", () => {
    expect(isWorktreeCliPath(WORKTREE_CLI, identity)).toBe(true);
  });

  it("E18: sibling directory `.worktrees-backup` does NOT match", () => {
    expect(isWorktreeCliPath("/repo/.worktrees-backup/os-x/packages/server/src/cli.ts", identity)).toBe(false);
  });

  it("E14 (C3): a symlink INTO a worktree matches via the post-realpath limb", () => {
    const linked = "/home/u/link/packages/server/src/cli.ts";
    expect(isWorktreeCliPath(linked, () => WORKTREE_CLI)).toBe(true);
  });

  it("E14 (C3): a worktree reached only via a symlink matches via the pre-realpath limb", () => {
    // realpath strips the `.worktrees` segment — the literal spelling saves it.
    expect(isWorktreeCliPath(WORKTREE_CLI, () => "/real/checkout/packages/server/src/cli.ts")).toBe(true);
  });

  it("does not throw when the path cannot be resolved", () => {
    expect(isWorktreeCliPath(HOST_CLI, () => { throw new Error("ENOENT"); })).toBe(false);
  });
});

describe("shouldRefuseWorktreeAutoStart", () => {
  it("E13: worktree + both ports default → refuse", () => {
    expect(shouldRefuseWorktreeAutoStart({ cliPath: WORKTREE_CLI, port: 8000, piPort: 9999 }, identity)).toBe(true);
  });

  it("E15: worktree + non-default dashboard port but default gateway port → still refuse", () => {
    expect(shouldRefuseWorktreeAutoStart({ cliPath: WORKTREE_CLI, port: 8001, piPort: 9999 }, identity)).toBe(true);
  });

  it("E16: worktree with BOTH ports moved off the defaults → permitted", () => {
    expect(shouldRefuseWorktreeAutoStart({ cliPath: WORKTREE_CLI, port: 18042, piPort: 19042 }, identity)).toBe(false);
  });

  it("E17: host install serving a worktree cwd → permitted (keys on cliPath, not cwd)", () => {
    expect(shouldRefuseWorktreeAutoStart({ cliPath: HOST_CLI, port: 8000, piPort: 9999 }, identity)).toBe(false);
  });
});

describe("appendAutoStartLog", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "autostart-log-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("X1: creates the file and its directory when the launch primitive never ran", () => {
    const logPath = join(dir, "nested", "server.log");
    expect(existsSync(logPath)).toBe(false);

    appendAutoStartLog("refused: something", { logPath });

    expect(readFileSync(logPath, "utf8")).toMatch(/\[auto-start\] refused: something/);
  });

  it("never throws when the log path is unwritable", () => {
    expect(() => appendAutoStartLog("x", { logPath: "/proc/definitely/not/writable/x.log" })).not.toThrow();
  });
});

/**
 * Task 1.4 — ground truth: the extension resolves its server CLI from the
 * copy it was loaded from, so an extension loaded from a worktree really does
 * point at the worktree's `cli.ts`. Asserted on the returned value directly,
 * never inferred from `ps`. This is the input the refusal predicate keys on.
 * See change: fix-worktree-server-autostart-leak.
 */
describe("resolveServerCliPath (ground truth for the predicate's input)", () => {
  it("resolves a server cli.ts path, and this checkout's copy is a worktree", async () => {
    const { resolveServerCliPath } = await import("../server-launcher.js");
    const resolved = resolveServerCliPath();

    expect(resolved).toMatch(/[\\/]server[\\/]src[\\/]cli\.ts$/);
    // This test file itself lives in a worktree checkout when run from one,
    // and the predicate must agree with that reality.
    const inWorktree = resolved.split(/[\\/]/).includes(".worktrees");
    expect(isWorktreeCliPath(resolved, (p) => p)).toBe(inWorktree);
  });
});
