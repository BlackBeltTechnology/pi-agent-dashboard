/**
 * Tests for getGitStatus / getChangedFiles / commitFiles / assertPathsInside.
 * Uses real git fixture repos (no mocks) so the porcelain parse + argv
 * staging + stdin-message pipeline is exercised end-to-end.
 *
 * See change: add-session-uncommitted-indicator-and-commit.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertPathsInside,
  commitFiles,
  GitCommitError,
  getChangedFiles,
  getGitStatus,
} from "../git-worktree/git-operations.js";

function git(cmd: string, cwd: string) {
  execSync(`git ${cmd}`, { cwd, stdio: "pipe" });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "git-commit-test-"));
  git("-c init.defaultBranch=main init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);
  writeFileSync(join(dir, "README.md"), "init\n");
  git("add .", dir);
  git("commit -m init", dir);
  return dir;
}

describe("getGitStatus", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("clean tree → all zeros", () => {
    expect(getGitStatus(repo)).toEqual({
      dirtyCount: 0, staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0,
    });
  });

  it("counts staged, unstaged and untracked", () => {
    writeFileSync(join(repo, "README.md"), "changed\n"); // unstaged
    writeFileSync(join(repo, "staged.ts"), "x\n");
    git("add staged.ts", repo); // staged (new file)
    writeFileSync(join(repo, "untracked.ts"), "y\n"); // untracked
    const s = getGitStatus(repo);
    expect(s?.dirtyCount).toBe(3);
    expect(s?.staged).toBe(1);
    expect(s?.unstaged).toBe(1);
    expect(s?.untracked).toBe(1);
  });

  it("non-repo → undefined", () => {
    const plain = mkdtempSync(join(tmpdir(), "plain-"));
    try {
      expect(getGitStatus(plain)).toBeUndefined();
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("assertPathsInside", () => {
  it("accepts paths inside cwd", () => {
    expect(assertPathsInside("/repo", ["a.ts", "sub/b.ts"])).toEqual(["a.ts", "sub/b.ts"]);
  });
  it("rejects .. traversal", () => {
    expect(() => assertPathsInside("/repo", ["../evil.ts"])).toThrow(GitCommitError);
  });
  it("rejects absolute path outside cwd", () => {
    expect(() => assertPathsInside("/repo", ["/etc/passwd"])).toThrow(/path-escape|escapes/);
  });
  it("rejects root-equivalent inputs ('' and '.') that would stage the whole tree", () => {
    expect(() => assertPathsInside("/repo", [""])).toThrow(GitCommitError);
    expect(() => assertPathsInside("/repo", ["."])).toThrow(GitCommitError);
    expect(() => assertPathsInside("/repo", ["a.ts", "."])).toThrow(/repo root|path-escape|resolves/);
  });
});

describe("commitFiles", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("commits only the selected files", async () => {
    writeFileSync(join(repo, "a.ts"), "a\n");
    writeFileSync(join(repo, "b.ts"), "b\n");
    const res = await commitFiles({ cwd: repo, message: "add a only", files: ["a.ts"] });
    expect(res.commitHash).toMatch(/^[0-9a-f]{40}$/);
    expect(res.subject).toBe("add a only");
    // b.ts remains untracked
    const s = getGitStatus(repo);
    expect(s?.untracked).toBe(1);
    expect(s?.dirtyCount).toBe(1);
  });

  it("commit message with shell metacharacters is committed verbatim (injection)", async () => {
    const sentinel = join(repo, "PWNED");
    const evil = 'subject $(touch "' + sentinel + '") `touch ' + sentinel + '`\n\nbody with "quotes" and newlines';
    writeFileSync(join(repo, "a.ts"), "a\n");
    const res = await commitFiles({ cwd: repo, message: evil, files: ["a.ts"] });
    // No shell executed → sentinel file must not exist.
    expect(() => readFileSync(sentinel)).toThrow();
    // Full message committed verbatim.
    const body = execSync("git log -1 --pretty=%B", { cwd: repo, encoding: "utf-8" });
    expect(body).toContain("$(touch");
    expect(body).toContain("body with \"quotes\" and newlines");
    expect(res.subject).toContain("subject $(touch");
  });

  it("rejects a file path escaping cwd", async () => {
    await expect(
      commitFiles({ cwd: repo, message: "m", files: ["../escape.ts"] }),
    ).rejects.toThrow(/path-escape|escapes/);
  });

  it("empty message → empty-message error", async () => {
    writeFileSync(join(repo, "a.ts"), "a\n");
    await expect(
      commitFiles({ cwd: repo, message: "   ", files: ["a.ts"] }),
    ).rejects.toThrow(GitCommitError);
  });

  it("no files → no-files error", async () => {
    await expect(
      commitFiles({ cwd: repo, message: "m", files: [] }),
    ).rejects.toThrow(GitCommitError);
  });
});

describe("getChangedFiles", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("lists staged, unstaged, untracked with diffstat", async () => {
    writeFileSync(join(repo, "README.md"), "init\nmore\n"); // unstaged, +1
    writeFileSync(join(repo, "new.ts"), "x\n");
    git("add new.ts", repo); // staged
    writeFileSync(join(repo, "untracked.ts"), "y\n"); // untracked
    const files = await getChangedFiles(repo);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(byPath["README.md"].state).toBe("unstaged");
    expect(byPath["new.ts"].state).toBe("staged");
    expect(byPath["untracked.ts"].state).toBe("untracked");
  });
});
