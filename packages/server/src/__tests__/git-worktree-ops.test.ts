/**
 * Integration tests for the three worktree operations in
 * `git-operations.ts` (readHead, listWorktrees, addWorktree).
 *
 * Uses a real tmpdir git repo + real git invocations — no mocks. Tests
 * are skipped on platforms without `git` on PATH (the suite never runs
 * in such environments, but be defensive).
 *
 * See change: add-worktree-spawn-dialog.
 */
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import nodeFs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildGitFixtures,
  fixtureGit,
  type GitFixtures,
  restoreEnv,
} from "@blackbelt-technology/pi-dashboard-shared/test-support/git-fixtures.js";
import { addWorktree, addWorktreeFromPr, listWorktrees, orphanCleanup, readHead, removeWorktree, resolveMainPath } from "../git-worktree/git-operations.js";
import { parsePorcelainWorktrees } from "../git-worktree/git-worktree.js";

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" }).trim();
}

function makeRepo(): string {
  // realpathSync to dereference `/tmp` → `/private/tmp` on macOS so paths
  // returned by `git rev-parse --git-common-dir` (which itself realpaths)
  // match what the test expects to compare against.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "git-wt-test-")));
  git("-c init.defaultBranch=main init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);
  writeFileSync(join(dir, "README.md"), "init");
  git("add .", dir);
  git("commit -m init", dir);
  return dir;
}

describe("readHead", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("returns branch=main, detached=false on a fresh repo", () => {
    const head = readHead(repo);
    expect(head.branch).toBe("main");
    expect(head.detached).toBe(false);
    expect(head.sha).toMatch(/^[0-9a-f]{4,}$/);
  });

  it("returns branch=null, detached=true after checkout of a SHA", () => {
    const sha = git("rev-parse HEAD", repo);
    git(`checkout ${sha}`, repo);
    const head = readHead(repo);
    expect(head.branch).toBeNull();
    expect(head.detached).toBe(true);
    expect(head.sha).toMatch(/^[0-9a-f]{4,}$/);
  });
});

describe("listWorktrees", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("returns the main worktree only on a fresh repo", () => {
    const wts = listWorktrees(repo);
    expect(wts).toHaveLength(1);
    expect(wts[0]?.isMain).toBe(true);
    expect(wts[0]?.branch).toBe("main");
  });

  it("returns main + sibling worktree after addWorktree", () => {
    const res = addWorktree({ cwd: repo, base: "main", newBranch: "feat/x" });
    expect(res.ok).toBe(true);
    const wts = listWorktrees(repo);
    expect(wts).toHaveLength(2);
    const main = wts.find((w) => w.isMain);
    const sibling = wts.find((w) => !w.isMain);
    expect(main?.branch).toBe("main");
    expect(sibling?.branch).toBe("feat/x");
  });
});

describe("addWorktree", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("creates a worktree under .worktrees/<slug>", () => {
    const res = addWorktree({ cwd: repo, base: "main", newBranch: "feat/dark-mode" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.path).toBe(join(repo, ".worktrees", "feat-dark-mode"));
    expect(res.branch).toBe("feat/dark-mode");
    expect(existsSync(res.path)).toBe(true);
    expect(existsSync(join(res.path, "README.md"))).toBe(true);
  });

  it("appends .worktrees/ to .git/info/exclude on first create", () => {
    const res = addWorktree({ cwd: repo, base: "main", newBranch: "feat/a" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.excludeAppended).toBe(true);
    const excludeContent = readFileSync(join(repo, ".git", "info", "exclude"), "utf-8");
    expect(excludeContent).toMatch(/^\.worktrees\/$/m);
  });

  it("does NOT re-append on a second create", () => {
    addWorktree({ cwd: repo, base: "main", newBranch: "feat/a" });
    const res2 = addWorktree({ cwd: repo, base: "main", newBranch: "feat/b" });
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    expect(res2.excludeAppended).toBe(false);
    const excludeContent = readFileSync(join(repo, ".git", "info", "exclude"), "utf-8");
    const matches = excludeContent.match(/^\.worktrees\/$/gm) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("does NOT touch .git/info/exclude when an explicit path is supplied", () => {
    const explicit = join(tmpdir(), `wt-explicit-${Date.now()}`);
    try {
      const res = addWorktree({ cwd: repo, base: "main", newBranch: "feat/x", path: explicit });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.excludeAppended).toBe(false);
      // Exclude file may or may not exist (git creates it lazily); when it
      // does, it shouldn't carry our line.
      const excludeFile = join(repo, ".git", "info", "exclude");
      if (existsSync(excludeFile)) {
        const content = readFileSync(excludeFile, "utf-8");
        expect(content).not.toMatch(/^\.worktrees\/$/m);
      }
    } finally {
      rmSync(explicit, { recursive: true, force: true });
    }
  });

  it("returns branch_in_use / branch_exists when newBranch collides", () => {
    // First worktree creates branch `feat/already` and a worktree dir.
    const first = addWorktree({ cwd: repo, base: "main", newBranch: "feat/already" });
    expect(first.ok).toBe(true);
    // Second worktree: SAME branch, EXPLICIT distinct path so the
    // pre-flight path_exists check doesn't preempt the git failure we
    // actually want to test.
    const altPath = mkdtempSync(join(tmpdir(), "wt-alt-"));
    // mkdtempSync creates a directory, but git needs the target to NOT
    // exist or to be empty; remove it so git creates a fresh one.
    rmSync(altPath, { recursive: true, force: true });
    const res = addWorktree({ cwd: repo, base: "main", newBranch: "feat/already", path: altPath });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // Either `branch_in_use` or `branch_exists` is acceptable since git's
    // exact wording varies; both indicate the same user-visible failure.
    expect(["branch_in_use", "branch_exists"]).toContain(res.error);
  });

  it("returns base_not_found for an unknown base ref", () => {
    const res = addWorktree({ cwd: repo, base: "does-not-exist", newBranch: "feat/x" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("base_not_found");
  });

  it("returns path_exists when target path is non-empty", () => {
    const collide = join(repo, ".worktrees", "feat-x");
    // Pre-create the path with a file in it.
    execSync(`mkdir -p '${collide}' && echo hi > '${collide}/file.txt'`);
    try {
      const res = addWorktree({ cwd: repo, base: "main", newBranch: "feat/x" });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toBe("path_exists");
    } finally {
      rmSync(join(repo, ".worktrees"), { recursive: true, force: true });
    }
  });

  it("returns not_a_repo for a non-git cwd", () => {
    const plain = mkdtempSync(join(tmpdir(), "no-git-"));
    try {
      const res = addWorktree({ cwd: plain, base: "main", newBranch: "feat/x" });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toBe("not_a_repo");
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("resolves the parent repo even when called from a sibling worktree", () => {
    // Create a worktree, then call addWorktree from INSIDE that worktree.
    const first = addWorktree({ cwd: repo, base: "main", newBranch: "feat/first" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const res = addWorktree({ cwd: first.path, base: "main", newBranch: "feat/second" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // New worktree's derived path should be under the ORIGINAL repo's
    // `.worktrees/`, NOT under the first worktree's path.
    expect(res.path).toBe(join(repo, ".worktrees", "feat-second"));
    expect(readdirSync(join(repo, ".worktrees")).sort()).toEqual(["feat-first", "feat-second"]);
  });
});

// Checkout mode = addWorktree without `newBranch`. Checks out an existing
// branch ref directly (DWIM-creating a tracking branch for remote-only
// refs). See change: worktree-checkout-existing-branch.
describe("addWorktree — checkout mode", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("checks out an existing local branch (no -b)", () => {
    git("branch stale-feature", repo);
    const res = addWorktree({ cwd: repo, base: "stale-feature" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.path).toBe(join(repo, ".worktrees", "stale-feature"));
    expect(res.branch).toBe("stale-feature");
    // The worktree HEAD is the existing branch, not a fork.
    const head = git("rev-parse --abbrev-ref HEAD", res.path);
    expect(head).toBe("stale-feature");
  });

  it("DWIM-creates a local branch for a remote-only ref, slug drops the remote prefix", () => {
    git("branch old-experiment", repo);
    const clone = mkdtempSync(join(tmpdir(), "wt-clone-"));
    rmSync(clone, { recursive: true, force: true });
    try {
      execSync(`git clone '${repo}' '${clone}'`, { stdio: "pipe" });
      git("config user.email test@test.com", clone);
      git("config user.name Test", clone);
      // Clone's default branch is checked out; `origin/old-experiment`
      // exists as a remote-tracking ref with no local branch.
      const res = addWorktree({ cwd: clone, base: "origin/old-experiment" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      // Path slug is the LOCAL name, not `origin-old-experiment`. The anchor
      // is git's canonical (realpath'd) checkout root, so compare against the
      // realpath of the clone dir. See change:
      // apply-checkout-root-to-worktree-ops (D1).
      expect(res.path).toBe(join(realpathSync(clone), ".worktrees", "old-experiment"));
      expect(res.branch).toBe("old-experiment");
      // git DWIM-created local `old-experiment` tracking origin.
      const head = git("rev-parse --abbrev-ref HEAD", res.path);
      expect(head).toBe("old-experiment");
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });

  it("branch_in_use message includes the holding-worktree path", () => {
    git("branch foo", repo);
    const first = addWorktree({ cwd: repo, base: "foo" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Second checkout of the SAME branch at an explicit distinct path so
    // the pre-flight path check doesn't preempt git's branch_in_use.
    const altPath = mkdtempSync(join(tmpdir(), "wt-alt-"));
    rmSync(altPath, { recursive: true, force: true });
    const res = addWorktree({ cwd: repo, base: "foo", path: altPath });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("branch_in_use");
    // Message names the worktree currently holding `foo`.
    expect(res.message).toContain(first.path);
  });
});

// ── apply-checkout-root-to-worktree-ops: E12/E13/E14/E15 ──────────────────

describe("parsePorcelainWorktrees — the parser stops stamping isMain (E14)", () => {
  const porcelain = [
    "worktree /repo",
    "HEAD a".padEnd(11, "0"),
    "branch refs/heads/main",
    "",
    "worktree /repo/.worktrees/wt",
    "HEAD b".padEnd(11, "0"),
    "branch refs/heads/wtb",
    "",
    "worktree /hub",
    "bare",
    "",
  ].join("\n");

  it("every record has isMain: false, including the first", () => {
    const parsed = parsePorcelainWorktrees(porcelain);
    expect(parsed).toHaveLength(3);
    for (const entry of parsed) expect(entry.isMain).toBe(false);
  });
});

describe("listWorktrees — isMain is resolved, not positional", () => {
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

  it("E12: a bare hub is never main — called from the linked worktree", () => {
    const wts = listWorktrees(fx.bareWorktree);
    const hub = wts.find((w) => w.bare);
    expect(hub).toBeDefined();
    expect(hub!.isMain).toBe(false);
    expect(wts.some((w) => w.isMain)).toBe(false);
  });

  it("E13: a submodule's git-dir row is never main (the old positional stamp marked it)", () => {
    // git quirk: from inside a submodule, `worktree list --porcelain` reports
    // the main-worktree registration at the MODULE GIT-DIR path
    // (`<super>/.git/modules/...`), not at the working tree. Positional
    // stamping therefore marked a git-dir row `isMain: true` — exactly the bug
    // D4 removes. The resolved main checkout is the submodule WORKING TREE,
    // which matches no row, so no entry is main ("at most one", not "exactly
    // one") — and the git-dir row is never it.
    const wts = listWorktrees(fx.submodule);
    expect(resolveMainPath(fx.submodule)).toBe(fx.submodule);
    for (const w of wts) {
      expect(w.path.startsWith(join(fx.superproject, ".git")) || w.isMain === false).toBe(true);
      if (w.path.startsWith(join(fx.superproject, ".git"))) {
        expect(w.isMain).toBe(false);
      }
    }
    expect(wts.some((w) => w.isMain)).toBe(false);
  });

  it("E15: a main checkout whose path carries a .git COMPONENT is never stamped isMain", () => {
    // A repo physically located inside a directory named `.git`: its resolved
    // main path equals the first porcelain record but carries a `.git`
    // component — the D1 consumer-side rejection must refuse it, so no record
    // (not even the main-registered one) is isMain. The old positional stamp
    // marked the first record unconditionally.
    const root = realpathSync(mkdtempSync(join(tmpdir(), "git-wt-gitseg-")));
    try {
      const nested = join(root, ".git", "nested");
      mkdirSync(nested, { recursive: true });
      fixtureGit(nested, ["init", "-q"]);
      writeFileSync(join(nested, "seed.txt"), "seed\n");
      fixtureGit(nested, ["add", "."]);
      fixtureGit(nested, ["commit", "-q", "-m", "seed"]);
      const wt = join(root, "nested-wt");
      fixtureGit(nested, ["worktree", "add", "-q", "-b", "nwt", wt]);
      // The resolver refuses the anchor outright.
      expect(resolveMainPath(wt)).toBeNull();
      const wts = listWorktrees(wt);
      expect(wts.length).toBeGreaterThanOrEqual(2);
      expect(wts.some((w) => w.isMain)).toBe(false);
      const nestedRecord = wts.find((w) => realpathSync(w.path) === nested);
      expect(nestedRecord).toBeDefined();
      expect(nestedRecord!.isMain).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("E12-positive control: an ordinary repo still marks exactly its main checkout", () => {
    const wts = listWorktrees(fx.normal);
    const mainRows = wts.filter((w) => w.isMain);
    expect(mainRows).toHaveLength(1);
    expect(realpathSync(mainRows[0].path)).toBe(realpathSync(fx.normal));
  });
});

// ── apply-checkout-root-to-worktree-ops: create + from-pr (E16/E17/E18/X7) ──

describe("addWorktree — refusal + anchoring (D2)", () => {
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

  it("E17: cwd in a bare hub refuses not_a_repo — without path AND WITH an explicit path", () => {
    const noPath = addWorktree({ cwd: fx.bare, base: "main", newBranch: "e17a" });
    expect(noPath.ok).toBe(false);
    if (noPath.ok) return;
    expect(noPath.error).toBe("not_a_repo");
    const explicit = join(fx.root, "e17-explicit");
    const withPath = addWorktree({ cwd: fx.bare, base: "main", newBranch: "e17b", path: explicit });
    expect(withPath.ok).toBe(false);
    if (withPath.ok) return;
    expect(withPath.error).toBe("not_a_repo");
    expect(existsSync(explicit)).toBe(false);
  });

  it("E16: cwd inside the submodule anchors the derived path under the SUBMODULE tree", () => {
    const result = addWorktree({ cwd: fx.submodule, base: "main", newBranch: "e16" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    try {
      const inside = (p: string, root: string) => realpathSync(p).startsWith(realpathSync(root));
      expect(inside(result.path, fx.submodule)).toBe(true);
      expect(result.path.includes(join(fx.superproject, ".git"))).toBe(false);
    } finally {
      rmSync(result.path, { recursive: true, force: true });
    }
  });

  it("E18: the exclude line lands in the COMMON GIT DIR's info/exclude, idempotently", () => {
    // --separate-git-dir checkout: the common git dir is <root>/elsewhere.git,
    // NOT <checkout>/.git (which does not even exist as a directory).
    const result = addWorktree({ cwd: fx.separateGitDir, base: "main", newBranch: "e18" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    try {
      const excludePath = join(fx.separateGitDirGitDir, "info", "exclude");
      expect(existsSync(excludePath)).toBe(true);
      const content = readFileSync(excludePath, "utf-8");
      expect(content).toContain(".worktrees/");
      expect(existsSync(join(fx.separateGitDir, ".git", "info", "exclude"))).toBe(false);
      // Appending twice does not duplicate: run addWorktree again (a second
      // worktree) and count the exclude lines.
      const second = addWorktree({ cwd: fx.separateGitDir, base: "main", newBranch: "e18b" });
      expect(second.ok).toBe(true);
      if (second.ok) rmSync(second.path, { recursive: true, force: true });
      const content2 = readFileSync(excludePath, "utf-8");
      expect(content2.split(".worktrees/").length - 1).toBe(1);
    } finally {
      rmSync(result.path, { recursive: true, force: true });
    }
  });

  it("X7: from-pr refuses not_a_repo when no main checkout resolves — before any fetch", () => {
    const target = join(fx.root, "pr-999");
    const result = addWorktreeFromPr({ cwd: fx.bareWorktree, prNumber: 999, path: target });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_a_repo");
    expect(existsSync(target)).toBe(false);
  });
});

// ── apply-checkout-root-to-worktree-ops: delete boundaries (D6/D7) ────────


describe("orphanCleanup — resolved anchor + realpath containment (D6)", () => {
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

  /** A small deletable orphan dir with one file. */
  const makeOrphan = (parent: string, name: string): string => {
    const dir = join(parent, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "leftover.txt"), "orphan\n");
    return dir;
  };

  it("E23: cwd inside the submodule cleans an orphan INSIDE the submodule working tree", () => {
    const orphan = makeOrphan(fx.submodule, "orphan-e23");
    const result = orphanCleanup({ cwd: fx.submodule, path: orphan });
    expect(result.ok).toBe(true);
    expect(existsSync(orphan)).toBe(false);
  });

  it("E24: an orphan under the MAIN checkout is cleanable from a linked worktree", () => {
    const orphan = makeOrphan(fx.normal, "orphan-e24");
    const result = orphanCleanup({ cwd: fx.worktree, path: orphan });
    expect(result.ok).toBe(true);
    expect(existsSync(orphan)).toBe(false);
  });

  it("X1: a symlink escape refuses outside_repo — neither link nor target deleted", () => {
    const outside = mkdtempSync(join(tmpdir(), "orphan-outside-"));
    const outsideTarget = join(outside, "victim");
    mkdirSync(outsideTarget, { recursive: true });
    writeFileSync(join(outsideTarget, "keep.txt"), "keep\n");
    const link = join(fx.normal, "orphan-x1");
    symlinkSync(outsideTarget, link, "dir");
    try {
      const result = orphanCleanup({ cwd: fx.normal, path: link });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("outside_repo");
      // The LINK survives and its TARGET is untouched.
      expect(existsSync(link)).toBe(true);
      expect(existsSync(join(outsideTarget, "keep.txt"))).toBe(true);
    } finally {
      rmSync(link, { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("X2: a missing path refuses not_a_directory — no unhandled ENOENT", () => {
    const missing = join(fx.normal, "does-not-exist");
    const result = orphanCleanup({ cwd: fx.normal, path: missing });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_a_directory");
  });

  it("X3: an unreadable (EACCES) symlink resolution refuses fs_failed — never a pass", () => {
    const orphan = makeOrphan(fx.normal, "orphan-x3");
    const realSpy = vi.spyOn(nodeFs, "realpathSync").mockImplementation(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });
    try {
      const result = orphanCleanup({ cwd: fx.normal, path: orphan });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("fs_failed");
      expect(existsSync(orphan)).toBe(true);
    } finally {
      realSpy.mockRestore();
      rmSync(orphan, { recursive: true, force: true });
    }
  });

  it("X4: the target deleted between the existence check and realpath refuses not_a_directory", () => {
    const orphan = makeOrphan(fx.normal, "orphan-x4");
    // Simulate the TOCTOU window: statSync (iii) saw the dir, realpath (iv)
    // finds it gone. A real race cannot be staged deterministically — inject
    // the post-check state at the fs seam.
    const realSpy = vi.spyOn(nodeFs, "realpathSync").mockImplementation(() => {
      throw Object.assign(new Error("no such file"), { code: "ENOENT" });
    });
    try {
      const result = orphanCleanup({ cwd: fx.normal, path: orphan });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("not_a_directory");
    } finally {
      realSpy.mockRestore();
      rmSync(orphan, { recursive: true, force: true });
    }
  });

  it("X5: cwd inside a bare repo (or worktree of one) refuses outside_repo — nothing deleted", () => {
    const orphan = makeOrphan(fx.bare, "orphan-x5");
    const fromBare = orphanCleanup({ cwd: fx.bare, path: orphan });
    expect(fromBare.ok).toBe(false);
    if (!fromBare.ok) expect(fromBare.error).toBe("outside_repo");
    expect(existsSync(orphan)).toBe(true);
    const fromWorktree = orphanCleanup({ cwd: fx.bareWorktree, path: orphan });
    expect(fromWorktree.ok).toBe(false);
    if (!fromWorktree.ok) expect(fromWorktree.error).toBe("outside_repo");
    expect(existsSync(orphan)).toBe(true);
    rmSync(orphan, { recursive: true, force: true });
  });

  it("E25: a registered worktree with a top-level .git entry returns not_orphan — guard order preserved", () => {
    // A worktree registered under `<main>/.worktrees/` is BOTH inside the
    // resolved anchor AND carries a top-level `.git` file. The registered
    // check comes FIRST (D6): the code is `not_orphan`, never
    // `looks_like_worktree`.
    const add = addWorktree({ cwd: fx.normal, base: "main", newBranch: "e25" });
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    try {
      const result = orphanCleanup({ cwd: fx.normal, path: add.path });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("not_orphan");
      expect(existsSync(add.path)).toBe(true);
    } finally {
      removeWorktree({ cwd: add.path, force: true });
    }
  });
});

describe("resolveMainPath — probe budget (P3)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("makes ONE resolver call and maps a failed result to null (budget pinned by E3's timeout:400)", async () => {
    const repo = makeRepo();
    try {
      const sharedGit = await import("@blackbelt-technology/pi-dashboard-shared/platform/git.js");
      // SYNC mock — the wrapper calls checkoutRoots synchronously and never
      // awaits; a failed/timed-out resolver result (what the 400ms budget
      // bounds in production) maps to null with no retry loop.
      const spy = vi.spyOn(sharedGit, "checkoutRoots").mockReturnValue(null);
      const result = resolveMainPath(repo);
      expect(result).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
