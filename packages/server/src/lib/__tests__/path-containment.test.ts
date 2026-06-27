/**
 * Unit tests for the shared path-containment helper. Exercises the layered
 * isAllowed rule directly: cwd-inside allow, worktree→parent allow, /etc/passwd
 * reject, git-absent → cwd-only, symlink-escape reject, plus a Windows-style
 * mixed-separator `within` case (G2). See change: git-root-file-containment.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { within, gitRoot, isAllowed } from "../path-containment.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

describe("within", () => {
  it("matches equality and subtree, rejects siblings", () => {
    expect(within("/a/b", "/a/b")).toBe(true);
    expect(within(`/a/b${path.sep}c`, "/a/b")).toBe(true);
    expect(within("/a/bc", "/a/b")).toBe(false); // prefix but not subtree
    expect(within("/a", "/a/b")).toBe(false); // ancestor
  });

  it("matches a child once both sides are path.resolve-normalized (G2)", () => {
    // gitRoot normalizes via path.resolve; emulate the same on both sides so a
    // mixed-separator git root compares equal to a native-separator resolved.
    const root = path.resolve("/repo/.git/..");
    const child = path.resolve(root, "node_modules/vitest/package.json");
    expect(within(child, root)).toBe(true);
  });
});

describe("isAllowed", () => {
  let repo: string;
  let worktree: string;
  let plain: string;

  beforeEach(async () => {
    repo = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "pc-repo-")));
    await git(repo, "init", "-q");
    await git(repo, "config", "user.email", "t@t.t");
    await git(repo, "config", "user.name", "t");
    await fsp.writeFile(path.join(repo, "root.txt"), "root\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-q", "-m", "init");

    // git worktree under the repo
    worktree = path.join(repo, ".worktrees", "wt");
    await git(repo, "worktree", "add", "-q", worktree);

    plain = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "pc-plain-")));
  });

  afterEach(async () => {
    await fsp.rm(repo, { recursive: true, force: true });
    await fsp.rm(plain, { recursive: true, force: true });
  });

  it("allows a path inside the anchor cwd (layer ①)", async () => {
    const target = path.join(repo, "root.txt");
    expect(await isAllowed(target, { anchors: [repo] })).toBe(true);
  });

  it("allows a worktree session reading a parent-root file (layer ②)", async () => {
    const target = path.join(repo, "root.txt"); // above worktree, under common root
    expect(await isAllowed(target, { anchors: [worktree] })).toBe(true);
  });

  it("rejects /etc/passwd (outside cwd and git root)", async () => {
    expect(await isAllowed("/etc/passwd", { anchors: [worktree] })).toBe(false);
  });

  it("degrades to cwd-only when cwd is not a git repo", async () => {
    const inside = path.join(plain, "a.txt");
    const outside = path.join(path.dirname(plain), "b.txt");
    expect(await isAllowed(inside, { anchors: [plain] })).toBe(true);
    expect(await isAllowed(outside, { anchors: [plain] })).toBe(false);
  });

  it("rejects a symlink whose real target escapes the git root (layer ②)", async () => {
    // Symlink under the repo root (outside the worktree cwd) pointing outside
    // the git root. Layer ① misses (not under worktree); layer ② realpath'd the
    // escape and rejects.
    const link = path.join(repo, "escape");
    await fsp.symlink(plain, link);
    const target = path.join(link, "secret.txt");
    expect(await isAllowed(target, { anchors: [worktree] })).toBe(false);
  });
});

describe("gitRoot", () => {
  it("returns cwd for a non-repo directory (fail closed)", async () => {
    const plain = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "pc-ng-")));
    try {
      expect(await gitRoot(plain)).toBe(plain);
    } finally {
      await fsp.rm(plain, { recursive: true, force: true });
    }
  });

  it("fails closed for a bare repo (no `.git` common dir → no parent widening)", async () => {
    // Bare repo: --git-common-dir is the bare dir itself (basename ≠ `.git`).
    // dirname would widen to the parent of unrelated files; must degrade to cwd.
    const base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "pc-bare-")));
    const bare = path.join(base, "repo.git");
    try {
      await git(base, "init", "--bare", "-q", bare);
      expect(await gitRoot(bare)).toBe(bare);
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });
});
