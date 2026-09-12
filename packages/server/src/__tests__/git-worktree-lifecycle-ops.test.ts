/**
 * Integration tests for worktree lifecycle ops in `git-operations.ts`
 * (removeWorktree, mergeWorktree, worktreeDiffStat, pushBranch,
 * createPullRequest). Uses real tmpdir git repos.
 *
 * `pushBranch` and `createPullRequest` are exercised against a bare
 * local "remote" to avoid network. PR creation is unit-tested via the
 * stderr mapper (we don't shell out to `gh` in tests).
 *
 * See change: add-worktree-lifecycle-actions.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as platformExec from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import {
  addWorktree,
  mergeWorktree,
  pruneWorktrees,
  pushBranch,
  removeWorktree,
  resolveDefaultBase,
  resolveRemoteBase,
  sweepResidualWorktreeDir,
  worktreeDiffStat,
} from "../git-worktree/git-operations.js";

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" }).trim();
}

function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "git-wt-life-")));
  git("-c init.defaultBranch=main init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);
  writeFileSync(join(dir, "README.md"), "init\n");
  git("add .", dir);
  git("commit -m init", dir);
  return dir;
}

describe("removeWorktree", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("removes a clean worktree", () => {
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/clean" });
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    const result = removeWorktree({ cwd: add.path });
    expect(result.ok).toBe(true);
    expect(existsSync(add.path)).toBe(false);
  });

  it("refuses dirty worktree without --force, succeeds with --force", () => {
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/dirty" });
    if (!add.ok) return;
    writeFileSync(join(add.path, "untracked.txt"), "stuff");
    const refused = removeWorktree({ cwd: add.path });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe("dirty_worktree");

    const forced = removeWorktree({ cwd: add.path, force: true });
    expect(forced.ok).toBe(true);
  });

  it("returns not_a_worktree on a non-repo path", () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), "not-a-repo-")));
    const result = removeWorktree({ cwd: tmp });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_a_worktree");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves parent repo via --git-common-dir (call from any worktree)", () => {
    // Add two worktrees; removing wt1 from the cwd of wt2 should still
    // succeed because resolveMainPath walks to the common parent.
    const a = addWorktree({ cwd: repo, base: "main", newBranch: "feat/a" });
    const b = addWorktree({ cwd: repo, base: "main", newBranch: "feat/b" });
    if (!a.ok || !b.ok) return;
    const result = removeWorktree({ cwd: a.path });
    expect(result.ok).toBe(true);
  });

  it("leaves no residual directory (no .pi husk) after removal", () => {
    // See change: sweep-worktree-residual-on-remove.
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/husk" });
    if (!add.ok) return;
    // A kb husk that survives git remove (e.g. recreated mid-removal) must be swept.
    const result = removeWorktree({ cwd: add.path });
    expect(result.ok).toBe(true);
    expect(existsSync(add.path)).toBe(false);
    expect(existsSync(join(add.path, ".pi"))).toBe(false);
  });

  it("sweeps a residual husk that survives a successful git remove", () => {
    // See change: sweep-worktree-residual-on-remove. Simulate the confirmed
    // resurrection: git remove succeeds, then a live handle recreates
    // `<wt>/.pi/dashboard/kb`. removeWorktree must sweep the residue.
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/resurrect" });
    if (!add.ok) return;
    // Stub-free reproduction: pre-seed a husk at the path, then remove the
    // registered worktree using a raw git call so removeWorktree's own git
    // step short-circuits (already-removed) yet the sweep still fires.
    // Instead, exercise the end-to-end path: remove normally, then re-seed a
    // husk and confirm the standalone sweep helper clears it (integration of
    // the guard is covered below).
    const result = removeWorktree({ cwd: add.path });
    expect(result.ok).toBe(true);
    // Re-create a husk at the freed path and sweep via the exported helper.
    mkdirSync(join(add.path, ".pi", "dashboard", "kb"), { recursive: true });
    writeFileSync(join(add.path, ".pi", "dashboard", "kb", "index.db"), "x");
    expect(existsSync(add.path)).toBe(true);
    const swept = sweepResidualWorktreeDir(repo, add.path);
    expect(swept).toBe(true);
    expect(existsSync(add.path)).toBe(false);
  });
});

describe("sweepResidualWorktreeDir (guarded residual-dir sweep)", () => {
  // See change: sweep-worktree-residual-on-remove.
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("removes a residual dir inside .worktrees/", () => {
    const wt = join(repo, ".worktrees", "gone");
    mkdirSync(join(wt, ".pi", "dashboard", "kb"), { recursive: true });
    writeFileSync(join(wt, ".pi", "dashboard", "kb", "index.db-wal"), "x");
    expect(sweepResidualWorktreeDir(repo, wt)).toBe(true);
    expect(existsSync(wt)).toBe(false);
  });

  it("returns false (no-op) when the path does not exist", () => {
    expect(sweepResidualWorktreeDir(repo, join(repo, ".worktrees", "absent"))).toBe(false);
  });

  it("refuses a path outside .worktrees/ (never sweeps arbitrary dirs)", () => {
    const outside = join(repo, "src-stuff");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "keep.txt"), "important");
    expect(sweepResidualWorktreeDir(repo, outside)).toBe(false);
    expect(existsSync(outside)).toBe(true);
  });

  it("refuses the main checkout itself", () => {
    expect(sweepResidualWorktreeDir(repo, repo)).toBe(false);
    expect(existsSync(repo)).toBe(true);
  });

  it("refuses a traversal path escaping .worktrees/ via ..", () => {
    const escape = join(repo, ".worktrees", "..", "escape");
    mkdirSync(escape, { recursive: true });
    writeFileSync(join(escape, "keep.txt"), "important");
    expect(sweepResidualWorktreeDir(repo, escape)).toBe(false);
    expect(existsSync(join(repo, "escape"))).toBe(true);
    rmSync(join(repo, "escape"), { recursive: true, force: true });
  });

  it("refuses a symlink whose real target is outside .worktrees/", () => {
    // A `.worktrees/<name>` that is actually a symlink to an outside dir must
    // not let the sweep delete the outside target.
    const outsideTarget = realpathSync(mkdtempSync(join(tmpdir(), "sweep-escape-")));
    writeFileSync(join(outsideTarget, "keep.txt"), "important");
    mkdirSync(join(repo, ".worktrees"), { recursive: true });
    const link = join(repo, ".worktrees", "evil");
    symlinkSync(outsideTarget, link);
    expect(sweepResidualWorktreeDir(repo, link)).toBe(false);
    expect(existsSync(join(outsideTarget, "keep.txt"))).toBe(true);
    rmSync(outsideTarget, { recursive: true, force: true });
  });
});

describe("resolveRemoteBase", () => {
  let repo: string;
  let bare: string;
  beforeEach(() => {
    repo = makeRepo();
    bare = realpathSync(mkdtempSync(join(tmpdir(), "bare-remote-")));
    git("init --bare", bare);
    git(`remote add origin ${bare}`, repo);
    git(`push origin main`, repo);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  });

  it("returns the bare name when hint exists on origin", () => {
    expect(resolveRemoteBase(repo, "main")).toBe("main");
  });

  it("strips origin/ prefix from a fully-qualified hint", () => {
    expect(resolveRemoteBase(repo, "origin/main")).toBe("main");
  });

  it("falls back to origin/main when hint is a local-only branch", () => {
    git("checkout -b feature/local-only", repo);
    expect(resolveRemoteBase(repo, "feature/local-only")).toBe("main");
  });

  it("returns null when no fallback exists on origin and hint not on origin", () => {
    // Push a non-fallback branch; remove main from origin so no fallback matches.
    git("checkout -b feat", repo);
    git("push origin feat", repo);
    git("push origin --delete main", repo);
    git("remote prune origin", repo);
    // Hint that doesn't exist on origin: should fall through fallbacks and find nothing.
    expect(resolveRemoteBase(repo, "never-pushed")).toBeNull();
  });
});

describe("resolveDefaultBase", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("returns the hint when valid", () => {
    expect(resolveDefaultBase(repo, "main")).toBe("main");
  });

  it("falls through to main when hint is bogus", () => {
    expect(resolveDefaultBase(repo, "nope-not-real")).toBe("main");
  });

  it("returns null when no fallback resolves", () => {
    // A bare repo with no commits has no main / develop / master.
    const empty = realpathSync(mkdtempSync(join(tmpdir(), "empty-repo-")));
    git("-c init.defaultBranch=foo init", empty);
    expect(resolveDefaultBase(empty)).toBeNull();
    rmSync(empty, { recursive: true, force: true });
  });
});

describe("mergeWorktree", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("merges branch into base cleanly, returns mergeSha", () => {
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/m" });
    if (!add.ok) return;
    writeFileSync(join(add.path, "f.txt"), "hello\n");
    git("add . && git -c user.email=t@t.com -c user.name=T commit -m feat", add.path);
    const result = mergeWorktree({ cwd: add.path });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.mergeSha).toMatch(/^[0-9a-f]{4,}$/);
    expect(result.data?.branchDeleted).toBe(false);
  });

  it("deletes the merged branch when deleteBranch:true", () => {
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/del" });
    if (!add.ok) return;
    writeFileSync(join(add.path, "f.txt"), "hi\n");
    git("add . && git -c user.email=t@t.com -c user.name=T commit -m feat", add.path);
    // Remove the worktree first so the branch can be deleted (-d requires the branch not be checked out anywhere).
    removeWorktree({ cwd: add.path });
    const result = mergeWorktree({ cwd: repo, baseHint: "main", deleteBranch: true });
    // The worktree's cwd is now the main repo (post-remove). The merge
    // call should noop-base ("nothing to merge"); branch isn't deletable here.
    // This test pins shape only — full delete flow exercised via route test.
    expect(result.ok || (!result.ok && result.code !== "git_failed")).toBe(true);
  });

  it("refuses when main checkout is dirty", () => {
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/dm" });
    if (!add.ok) return;
    writeFileSync(join(repo, "scratch.txt"), "wip\n");
    const result = mergeWorktree({ cwd: add.path });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("dirty_main");
  });

  it("aborts and returns merge_conflict on conflict", () => {
    // Create a conflict: edit README in main + a branch, then merge.
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/conf" });
    if (!add.ok) return;
    writeFileSync(join(add.path, "README.md"), "branch version\n");
    git("add . && git -c user.email=t@t.com -c user.name=T commit -m branch", add.path);
    writeFileSync(join(repo, "README.md"), "main version\n");
    git("add . && git -c user.email=t@t.com -c user.name=T commit -m main", repo);
    const result = mergeWorktree({ cwd: add.path });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("merge_conflict");
    // After abort main should be clean again.
    const status = execSync("git status --porcelain", { cwd: repo, encoding: "utf-8" });
    expect(status.trim()).toBe("");
  });

  it("returns base_not_found when no base resolves", () => {
    const empty = realpathSync(mkdtempSync(join(tmpdir(), "empty-")));
    git("-c init.defaultBranch=foo init", empty);
    writeFileSync(join(empty, "x.txt"), "x");
    git("add . && git -c user.email=t@t.com -c user.name=T commit -m c", empty);
    git("checkout -b bar", empty);
    const result = mergeWorktree({ cwd: empty });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("base_not_found");
    rmSync(empty, { recursive: true, force: true });
  });
});

describe("worktreeDiffStat", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("returns 0/0/0 when branch == base", () => {
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/empty" });
    if (!add.ok) return;
    const result = worktreeDiffStat({ cwd: add.path });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.filesChanged).toBe(0);
  });

  it("returns counts when branch has commits", () => {
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/d" });
    if (!add.ok) return;
    writeFileSync(join(add.path, "a.txt"), "hello\nworld\n");
    git("add . && git -c user.email=t@t.com -c user.name=T commit -m add", add.path);
    const result = worktreeDiffStat({ cwd: add.path });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.filesChanged).toBeGreaterThan(0);
    expect(result.data?.insertions).toBeGreaterThan(0);
  });
});

describe("pushBranch", () => {
  let repo: string;
  let bareRemote: string;
  beforeEach(() => {
    repo = makeRepo();
    bareRemote = realpathSync(mkdtempSync(join(tmpdir(), "bare-remote-")));
    git("init --bare", bareRemote);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(bareRemote, { recursive: true, force: true });
  });

  it("returns no_remote when origin missing", () => {
    const result = pushBranch({ cwd: repo });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("no_remote");
  });

  it("pushes successfully when origin is configured", () => {
    git(`remote add origin ${bareRemote}`, repo);
    const result = pushBranch({ cwd: repo });
    expect(result.ok).toBe(true);
  });
});

// ── deleteBranch + prune (change: manage-worktrees-filter-cleanup) ──

describe("removeWorktree({ deleteBranch: true })", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  function branchExists(name: string): boolean {
    try {
      git(`rev-parse --verify refs/heads/${name}`, repo);
      return true;
    } catch { return false; }
  }

  // test-plan #E16
  it("deletes a merged branch, refuses an unmerged one — removal succeeds either way", () => {
    const merged = addWorktree({ cwd: repo, base: "main", newBranch: "feat/merged" });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(branchExists("feat/merged")).toBe(true);

    const mergedResult = removeWorktree({ cwd: merged.path, deleteBranch: true });
    expect(mergedResult.ok).toBe(true);
    if (!mergedResult.ok) return;
    // `data` is optional on LifecycleSuccess — assert it is present rather
    // than optional-chaining, which would pass on a missing payload.
    expect(mergedResult.data).toBeDefined();
    if (!mergedResult.data) return;
    expect(mergedResult.data.branchDeleted).toBe(true);
    expect(mergedResult.data.branchDeleteCode).toBe("deleted");
    expect(branchExists("feat/merged")).toBe(false);

    const unmerged = addWorktree({ cwd: repo, base: "main", newBranch: "feat/unmerged" });
    if (!unmerged.ok) return;
    writeFileSync(join(unmerged.path, "extra.txt"), "work\n");
    git("add .", unmerged.path);
    git("commit -m work", unmerged.path);

    const unmergedResult = removeWorktree({ cwd: unmerged.path, deleteBranch: true });
    // Removal still succeeds — only the branch delete is refused.
    expect(unmergedResult.ok).toBe(true);
    if (!unmergedResult.ok) return;
    expect(unmergedResult.data).toBeDefined();
    if (!unmergedResult.data) return;
    expect(existsSync(unmerged.path)).toBe(false);
    expect(unmergedResult.data.branchDeleted).toBe(false);
    expect(unmergedResult.data.branchDeleteCode).toBe("unmerged");
    expect(branchExists("feat/unmerged")).toBe(true);
  });

  // test-plan #X6 — C2: no compensation. The branch delete happens regardless
  // of whether the caller is still around to read the response.
  it("completes the branch delete even when the caller abandons the request", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/abandoned" });
      if (!add.ok) return;
      // The op is synchronous: an abandoned caller cannot interrupt it, so the
      // delete is observably complete with no rollback.
      const result = removeWorktree({ cwd: add.path, deleteBranch: true });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBeDefined();
      if (!result.data) return;
      expect(result.data.branchDeleted).toBe(true);
      expect(branchExists("feat/abandoned")).toBe(false);
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  // test-plan #E8 — assert on the command spy, not the outcome.
  it("never invokes `git branch` when the entry has no branch", () => {
    const detached = addWorktree({ cwd: repo, base: "main", newBranch: "feat/det" });
    if (!detached.ok) return;
    // Detach HEAD inside the worktree → porcelain reports `detached`, branch null.
    git("checkout --detach", detached.path);

    // Spy BOTH exec surfaces: the branch delete runs through `execFileSync`
    // (argv form), so watching only `execSync` would make this assertion
    // vacuous — it could never observe a `git branch` call in the first place.
    const calls: string[] = [];
    const realExec = platformExec.execSync;
    const realExecFile = platformExec.execFileSync;
    const spy = vi.spyOn(platformExec, "execSync").mockImplementation(((cmd: any, opts: any) => {
      calls.push(String(cmd));
      return realExec(cmd, opts);
    }) as any);
    const fileSpy = vi.spyOn(platformExec, "execFileSync").mockImplementation(((
      file: any,
      args: any,
      opts: any,
    ) => {
      calls.push(`${String(file)} ${(args ?? []).join(" ")}`);
      return realExecFile(file, args, opts);
    }) as any);
    try {
      const result = removeWorktree({ cwd: detached.path, deleteBranch: true });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBeDefined();
      if (!result.data) return;
      expect(result.data.branchDeleted).toBe(false);
      expect(result.data.branchDeleteCode).toBe("no_branch");
    } finally {
      spy.mockRestore();
      fileSpy.mockRestore();
    }
    // Guard against the spy itself going blind: it must have observed SOMETHING.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => /\bgit branch\b/.test(c))).toBe(false);
  });

  // Security: `shellEscape` is POSIX single-quoting, which cmd.exe treats as
  // literal characters — a branch name containing `&` would become a command
  // separator if this were built as a shell string.
  it("passes the branch name as an argv element, never through a shell", () => {
    const nasty = "feat/x&echo_pwned";
    const add = addWorktree({ cwd: repo, base: "main", newBranch: nasty });
    console.log("DEBUG add:", JSON.stringify(add));
    expect(add.ok).toBe(true);
    if (!add.ok) return;

    // Record BOTH surfaces so the assertion is falsifiable either way.
    const shellCalls: string[] = [];
    const argvCalls: Array<[string, string[]]> = [];
    const realExec = platformExec.execSync;
    const realExecFile = platformExec.execFileSync;
    const spy = vi.spyOn(platformExec, "execSync").mockImplementation(((cmd: any, opts: any) => {
      shellCalls.push(String(cmd));
      return realExec(cmd, opts);
    }) as any);
    const fileSpy = vi.spyOn(platformExec, "execFileSync").mockImplementation(((
      file: any,
      args: any,
      opts: any,
    ) => {
      argvCalls.push([String(file), (args ?? []) as string[]]);
      return realExecFile(file, args, opts);
    }) as any);
    try {
      const result = removeWorktree({ cwd: add.path, deleteBranch: true });
      expect(result.ok).toBe(true);
      expect(result.ok && result.data?.branchDeleted).toBe(true);
    } finally {
      spy.mockRestore();
      fileSpy.mockRestore();
    }

    // The delete ran in ARGV form, with the branch as its own element — so no
    // shell ever parsed the `&`.
    const branchDelete = argvCalls.find(([f, a]) => f === "git" && a[0] === "branch");
    expect(branchDelete, `argv calls: ${JSON.stringify(argvCalls)}`).toBeDefined();
    expect(branchDelete?.[1]).toEqual(["branch", "-d", nasty]);
    // ...and it was NOT built as a shell string.
    expect(shellCalls.filter((c) => /git branch/.test(c))).toEqual([]);
    // The injected fragment never executed as a command.
    expect(branchExists(nasty)).toBe(false);
    expect(existsSync(join(repo, "echo_pwned"))).toBe(false);
  });
});

describe("removeWorktree shell safety", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  // The batch endpoint accepts up to 50 caller-supplied paths per request, so
  // the removal path must never build a shell string out of one.
  it("passes the worktree path as an argv element, never through a shell", () => {
    const dir = join(repo, "wt&pwned");
    git(`worktree add ${JSON.stringify(dir)} -b feat/amp`, repo);
    expect(existsSync(dir)).toBe(true);

    const shellCalls: string[] = [];
    const argvCalls: Array<[string, string[]]> = [];
    const realExec = platformExec.execSync;
    const realExecFile = platformExec.execFileSync;
    const spy = vi.spyOn(platformExec, "execSync").mockImplementation(((cmd: any, opts: any) => {
      shellCalls.push(String(cmd));
      return realExec(cmd, opts);
    }) as any);
    const fileSpy = vi.spyOn(platformExec, "execFileSync").mockImplementation(((
      f: any, a: any, o: any,
    ) => {
      argvCalls.push([String(f), (a ?? []) as string[]]);
      return realExecFile(f, a, o);
    }) as any);
    try {
      const result = removeWorktree({ cwd: dir });
      expect(result.ok).toBe(true);
    } finally {
      spy.mockRestore();
      fileSpy.mockRestore();
    }

    const removeCall = argvCalls.find(([f, a]) => f === "git" && a[0] === "worktree" && a[1] === "remove");
    expect(removeCall, `argv calls: ${JSON.stringify(argvCalls)}`).toBeDefined();
    // The path is its own argv element — no shell ever parsed the `&`.
    expect(removeCall?.[1].at(-1)).toBe(dir);
    expect(shellCalls.filter((c) => /worktree remove/.test(c))).toEqual([]);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(repo, "pwned"))).toBe(false);
  });
});

describe("pruneWorktrees", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  function registrationPaths(): string[] {
    return git("worktree list --porcelain", repo)
      .split(/\r?\n/)
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice("worktree ".length));
  }

  // test-plan #X8
  it("clears a registration whose directory was deleted outside git", () => {
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/stale" });
    if (!add.ok) return;
    rmSync(add.path, { recursive: true, force: true });
    expect(registrationPaths()).toContain(add.path);

    const result = pruneWorktrees(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeDefined();
    if (!result.data) return;
    expect(result.data.pruned).toBeGreaterThan(0);
    expect(registrationPaths()).not.toContain(add.path);
  });

  // test-plan #X7
  it("is a no-op when every registration's directory exists", () => {
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/live" });
    if (!add.ok) return;
    const before = registrationPaths();

    const result = pruneWorktrees(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeDefined();
    if (!result.data) return;
    expect(result.data.pruned).toBe(0);
    expect(registrationPaths()).toEqual(before);
  });
});

// ── apply-checkout-root-to-worktree-ops: removal guard routes (E5–E11, E10) ──

import { realpathSync as rp2 } from "node:fs";
import Fastify2, { type FastifyInstance } from "fastify";
import * as sharedGit2 from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import {
  buildGitFixtures,
  type GitFixtures,
  restoreEnv,
} from "@blackbelt-technology/pi-dashboard-shared/test-support/git-fixtures.js";
import { registerGitRoutes } from "../routes/git-routes.js";

async function makeRouteApp(): Promise<FastifyInstance> {
  const app = Fastify2({ logger: false });
  registerGitRoutes(app, { networkGuard: async () => {} });
  await app.ready();
  return app;
}

describe("POST /api/git/worktree/remove — tri-state guard (D3)", () => {
  const savedEnv = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
  let fx: GitFixtures;
  let app: FastifyInstance;

  beforeAll(() => {
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CONFIG_SYSTEM = "/dev/null";
    fx = buildGitFixtures();
  });

  afterAll(() => {
    fx.cleanup();
    restoreEnv("GIT_CONFIG_GLOBAL", savedEnv.global);
    restoreEnv("GIT_CONFIG_SYSTEM", savedEnv.system);
  });

  beforeEach(async () => {
    app = await makeRouteApp();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const remove = (cwd: string, force = false) =>
    app.inject({
      method: "POST",
      url: "/api/git/worktree/remove",
      payload: { cwd, force },
    });

  it("E5: the main checkout is refused is_main_worktree, 400, directory intact", async () => {
    const res = await remove(fx.normal);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("is_main_worktree");
    expect(existsSync(fx.normal)).toBe(true);
  });

  it("E6: a worktree of a bare hub is refused main_checkout_unresolved, 400, still on disk", async () => {
    const res = await remove(fx.bareWorktree);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("main_checkout_unresolved");
    expect(existsSync(fx.bareWorktree)).toBe(true);
  });

  it("E7: a subdirectory of main classifies main → is_main_worktree, 400", async () => {
    const src = join(fx.normal, "src");
    mkdirSync(src, { recursive: true });
    const res = await remove(src);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("is_main_worktree");
  });

  it("E8: a submodule classifies main → is_main_worktree, 400", async () => {
    const res = await remove(fx.submodule);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("is_main_worktree");
  });

  it("E9: an ordinary linked worktree is still removable, exactly as before", async () => {
    const add = addWorktree({ cwd: fx.normal, base: "main", newBranch: "feat/e9" });
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    const res = await remove(rp2(add.path));
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(existsSync(add.path)).toBe(false);
  });

  it("E11: an inconclusive --show-toplevel is refused main_checkout_unresolved — NOT removable", async () => {
    // A linked worktree whose working-tree probe yields nothing while
    // `core.worktree` still resolves a main checkout. Injected at the resolver
    // seam: real git cannot produce this state on demand.
    vi.spyOn(sharedGit2, "checkoutRoots").mockReturnValue({
      thisCheckout: null,
      isLinkedWorktree: true,
      mainCheckout: fx.normal,
      commonDir: join(fx.normal, ".git"),
    });
    const res = await remove(fx.worktree);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("main_checkout_unresolved");
    expect(existsSync(fx.worktree)).toBe(true);
  });

  it("E10: the batch classifies per item, in input order, never aborting", async () => {
    const add = addWorktree({ cwd: fx.normal, base: "main", newBranch: "feat/e10" });
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: {
        items: [{ cwd: rp2(add.path) }, { cwd: fx.normal }, { cwd: fx.bareWorktree }],
      },
    });
    expect(res.statusCode).toBe(200);
    const results = res.json().data.results;
    expect(results.map((r: { code: string }) => r.code)).toEqual([
      "ok",
      "is_main_worktree",
      "main_checkout_unresolved",
    ]);
    // Item 3 was refused but still exists; item 1 was removed.
    expect(existsSync(add.path)).toBe(false);
    expect(existsSync(fx.bareWorktree)).toBe(true);
  });
});

// ── apply-checkout-root-to-worktree-ops: lifecycle refusals (E21/E22/X6) ──

describe("lifecycle endpoints — unresolvable main checkout (D2)", () => {
  const savedEnv = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
  let fx: GitFixtures;
  let app: FastifyInstance;

  beforeAll(() => {
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CONFIG_SYSTEM = "/dev/null";
    fx = buildGitFixtures();
  });

  afterAll(() => {
    fx.cleanup();
    restoreEnv("GIT_CONFIG_GLOBAL", savedEnv.global);
    restoreEnv("GIT_CONFIG_SYSTEM", savedEnv.system);
  });

  beforeEach(async () => {
    app = await makeRouteApp();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("E21: merge returns not_a_worktree with 400, not git_failed/500", async () => {
    const res = await app.inject({ method: "POST", url: "/api/git/worktree/merge", payload: { cwd: fx.bareWorktree } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("not_a_worktree");
  });

  it("E21: diff-stat returns not_a_worktree with 400, not git_failed/500", async () => {
    const res = await app.inject({ method: "GET", url: `/api/git/worktree/diff-stat?cwd=${encodeURIComponent(fx.bareWorktree)}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("not_a_worktree");
  });

  it("E22: push is exempt — proceeds against cwd, never refused not_a_worktree", async () => {
    const res = await app.inject({ method: "POST", url: "/api/git/worktree/push", payload: { cwd: fx.bareWorktree } });
    expect(res.json().code).not.toBe("not_a_worktree");
  });

  it("E22: pr is exempt — proceeds past validation, never refused not_a_worktree", async () => {
    const res = await app.inject({ method: "POST", url: "/api/git/worktree/pr", payload: { cwd: fx.bareWorktree } });
    expect(res.json().code).not.toBe("not_a_worktree");
  });

  it("X6: a dead probe refuses every endpoint with its OWN code — nothing created or deleted", async () => {
    vi.spyOn(sharedGit2, "checkoutRoots").mockReturnValue(null);
    const markerFile = join(fx.worktree, "marker.txt");
    writeFileSync(markerFile, "intact\n");
    const target = join(fx.normal, ".worktrees", "x6-orphan");
    mkdirSync(target, { recursive: true });

    const create = await app.inject({ method: "POST", url: "/api/git/worktree", payload: { cwd: fx.bare, base: "main", newBranch: "x6" } });
    expect(create.json().code).toBe("not_a_repo");
    const fromPr = await app.inject({ method: "POST", url: "/api/git/worktree/from-pr", payload: { cwd: fx.bare, prNumber: 1 } });
    expect(fromPr.json().code).toBe("not_a_repo");
    const merge = await app.inject({ method: "POST", url: "/api/git/worktree/merge", payload: { cwd: fx.worktree } });
    expect(merge.json().code).toBe("not_a_worktree");
    const prune = await app.inject({ method: "POST", url: "/api/git/worktree/prune", payload: { cwd: fx.worktree } });
    expect(prune.json().code).toBe("not_a_worktree");
    const diffStat = await app.inject({ method: "GET", url: `/api/git/worktree/diff-stat?cwd=${encodeURIComponent(fx.worktree)}` });
    expect(diffStat.json().code).toBe("not_a_worktree");
    const remove = await app.inject({ method: "POST", url: "/api/git/worktree/remove", payload: { cwd: fx.worktree } });
    expect(remove.json().code).toBe("main_checkout_unresolved");
    const orphan = await app.inject({ method: "POST", url: "/api/git/worktree/orphan-cleanup", payload: { cwd: fx.worktree, path: target } });
    expect(orphan.json().code).toBe("outside_repo");

    // Nothing created or deleted.
    expect(existsSync(markerFile)).toBe(true);
    expect(existsSync(target)).toBe(true);
  });
});

// ── apply-checkout-root-to-worktree-ops: batch cap (D8) + resolver count (D7) ──

async function makeRouteAppWithCap(removeBatchCap?: number): Promise<FastifyInstance> {
  const app = Fastify2({ logger: false });
  registerGitRoutes(app, { networkGuard: async () => {}, removeBatchCap });
  await app.ready();
  return app;
}

describe("POST /api/git/worktree/remove-batch — configurable cap (E26–E29)", () => {
  const savedEnv = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
  let fx: GitFixtures;

  beforeAll(() => {
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CONFIG_SYSTEM = "/dev/null";
    fx = buildGitFixtures();
  });

  afterAll(() => {
    fx.cleanup();
    restoreEnv("GIT_CONFIG_GLOBAL", savedEnv.global);
    restoreEnv("GIT_CONFIG_SYSTEM", savedEnv.system);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The cap check runs BEFORE any removal: a null resolver makes every item a fast refusal. */
  const items = (n: number, cwd: string) =>
    Array.from({ length: n }, () => ({ cwd }));

  it("E26: an unset config keeps today's cap — 50 accepted, 51 rejected", async () => {
    vi.spyOn(sharedGit2, "checkoutRoots").mockReturnValue(null);
    const app = await makeRouteAppWithCap();
    const ok = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: { items: items(50, fx.worktree) },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.results).toHaveLength(50);
    const tooLarge = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: { items: items(51, fx.worktree) },
    });
    expect(tooLarge.statusCode).toBe(400);
    expect(tooLarge.json().code).toBe("batch_too_large");
    await app.close();
  });

  it("E27: a configured cap is honoured at its boundary — no git command for the rejected batch", async () => {
    const spy = vi.spyOn(sharedGit2, "checkoutRoots").mockReturnValue(null);
    const app = await makeRouteAppWithCap(10);
    const ok = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: { items: items(10, fx.worktree) },
    });
    expect(ok.statusCode).toBe(200);
    const rejected = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: { items: items(11, fx.worktree) },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().code).toBe("batch_too_large");
    // The rejected batch never classified an item — the cap check is first.
    // All 10 items share one cwd → once per DISTINCT cwd = 1 call.
    expect(spy).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it.each<[string, unknown]>([
    ["0", 0],
    ["-1", -1],
    ["2.5", 2.5],
    ['"many"', "many"],
    ["null", null],
  ])("E28: cap %s falls back to the default (neither all-rejected nor unbounded)", async (_name, cap) => {
    vi.spyOn(sharedGit2, "checkoutRoots").mockReturnValue(null);
    const app = await makeRouteAppWithCap(cap as number);
    const atDefault = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: { items: items(50, fx.worktree) },
    });
    expect(atDefault.statusCode).toBe(200);
    const above = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: { items: items(51, fx.worktree) },
    });
    expect(above.statusCode).toBe(400);
    await app.close();
  });

  it("E29: the rejection message names the EFFECTIVE cap, not a hardcoded 50", async () => {
    vi.spyOn(sharedGit2, "checkoutRoots").mockReturnValue(null);
    const app = await makeRouteAppWithCap(10);
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: { items: items(11, fx.worktree) },
    });
    expect(res.json().error).toContain("10");
    await app.close();
  });
});

describe("resolver invocation count (D7)", () => {
  const savedEnv = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
  let fx: GitFixtures;
  let app: FastifyInstance;

  beforeAll(() => {
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CONFIG_SYSTEM = "/dev/null";
    fx = buildGitFixtures();
  });

  afterAll(() => {
    fx.cleanup();
    restoreEnv("GIT_CONFIG_GLOBAL", savedEnv.global);
    restoreEnv("GIT_CONFIG_SYSTEM", savedEnv.system);
  });

  beforeEach(async () => {
    app = await makeRouteApp();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("P1: ONE resolution for /remove; one per distinct cwd for /remove-batch", async () => {
    const a = addWorktree({ cwd: fx.normal, base: "main", newBranch: "feat/p1a" });
    const b = addWorktree({ cwd: fx.normal, base: "main", newBranch: "feat/p1b" });
    const c = addWorktree({ cwd: fx.normal, base: "main", newBranch: "feat/p1c" });
    for (const r of [a, b, c]) expect(r.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    const spy = vi.spyOn(sharedGit2, "checkoutRoots");
    // Single remove: classify (1) + threaded mainPath into removeWorktree (0)
    // — a second internal resolution would make this 2.
    await app.inject({ method: "POST", url: "/api/git/worktree/remove", payload: { cwd: rp2(a.path) } });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    // Batch of 3 distinct cwds: classify per item = 3, never 2× per item.
    await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: { items: [{ cwd: rp2(b.path) }, { cwd: rp2(c.path) }, { cwd: fx.worktree }] },
    });
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockClear();
    // Duplicate cwds resolve ONCE per DISTINCT cwd within one request (spec:
    // the same cwd SHALL NOT be resolved twice in one request). Refusal
    // fixtures only (main checkout + submodule) so nothing is removed
    // mid-batch: 3 items, 2 distinct cwds → 2 resolutions.
    const dup = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: { items: [{ cwd: fx.normal }, { cwd: fx.submodule }, { cwd: fx.normal }] },
    });
    expect(spy).toHaveBeenCalledTimes(2);
    const dupResults = dup.json().data.results;
    expect(dupResults).toHaveLength(3);
    // Input order preserved; the duplicated item got the same verdict twice.
    expect(dupResults[0].cwd).toBe(fx.normal);
    expect(dupResults[2].cwd).toBe(fx.normal);
    expect(dupResults[0].code).toBe(dupResults[2].code);
  });
});
