/**
 * Decision table for the shared folder-admission guard. This module was
 * extracted from `kb-plugin/src/server/kb-routes.ts` so kb-plugin and
 * mcp-client share ONE implementation; the kb routes keep exercising it
 * through the re-export in their own suite.
 * See change: extract-mcp-client-plugin.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { canonPath, isAllowedCwd } from "../cwd-guard.js";

const cleanup: string[] = [];
afterAll(() => {
  for (const p of cleanup) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

function makeDir(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanup.push(d);
  return d;
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", ["-c", "user.email=t@t.com", "-c", "user.name=T", ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function makeRepoWithWorktree(): { main: string; worktree: string } {
  const main = makeDir("cwd-guard-main-");
  git(main, ["-c", "init.defaultBranch=main", "init"]);
  git(main, ["commit", "--allow-empty", "-m", "init"]);
  const worktree = join(realpathSync(tmpdir()), `cwd-guard-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
  cleanup.push(worktree);
  git(main, ["worktree", "add", "-b", "wt", worktree]);
  return { main, worktree };
}

describe("isAllowedCwd", () => {
  it("refuses an undefined or empty cwd", () => {
    expect(isAllowedCwd(undefined, () => [makeDir("cwd-guard-")])).toBe(false);
    expect(isAllowedCwd("", () => [makeDir("cwd-guard-")])).toBe(false);
  });

  it("admits a known folder and refuses an unknown one", () => {
    const known = makeDir("cwd-guard-known-");
    const other = makeDir("cwd-guard-other-");
    expect(isAllowedCwd(known, () => [known])).toBe(true);
    expect(isAllowedCwd(other, () => [known])).toBe(false);
  });

  it("canonicalizes both sides (trailing slash, symlink to known)", () => {
    const known = makeDir("cwd-guard-known-");
    expect(isAllowedCwd(`${known}/`, () => [known])).toBe(true);
    const link = join(realpathSync(tmpdir()), `cwd-guard-link-${process.pid}-${Math.random().toString(36).slice(2)}`);
    symlinkSync(known, link, "dir");
    cleanup.push(link);
    expect(isAllowedCwd(link, () => [known])).toBe(true);
  });

  it("refuses a git-internal path even when its parent is known", () => {
    const known = makeDir("cwd-guard-known-");
    mkdirSync(join(known, ".git"), { recursive: true });
    expect(isAllowedCwd(join(known, ".git"), () => [known])).toBe(false);
  });

  it("refuses a traversal alias escaping a known folder", () => {
    const known = makeDir("cwd-guard-known-");
    const other = makeDir("cwd-guard-other-");
    expect(isAllowedCwd(join(known, "..", other.split("/").pop()!), () => [known])).toBe(false);
  });

  it("refuses a subdirectory that is not itself a known folder", () => {
    const known = makeDir("cwd-guard-known-");
    const sub = join(known, "sub");
    mkdirSync(sub, { recursive: true });
    expect(isAllowedCwd(sub, () => [known])).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "admits a worktree whose MAIN checkout is a known folder",
    () => {
      const { main, worktree } = makeRepoWithWorktree();
      expect(isAllowedCwd(worktree, () => [main])).toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a worktree whose main checkout is NOT known",
    () => {
      const { worktree } = makeRepoWithWorktree();
      expect(isAllowedCwd(worktree, () => [makeDir("cwd-guard-unrelated-")])).toBe(false);
    },
  );
});

describe("canonPath", () => {
  it("resolves relative segments and keeps a non-existent path resolved", () => {
    const known = makeDir("cwd-guard-known-");
    expect(canonPath(join(known, "a", "..", "b"))).toBe(join(known, "b"));
  });
});
