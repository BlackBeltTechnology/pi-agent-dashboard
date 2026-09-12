import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import * as sharedGit from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import {
  buildGitFixtures,
  fixtureGit,
  type GitFixtures,
  restoreEnv,
} from "@blackbelt-technology/pi-dashboard-shared/test-support/git-fixtures.js";
import * as gitOps from "../git-worktree/git-operations.js";
import {
  checkoutBranch,
  getDirtyFiles,
  gitInit,
  isGitRepo,
  listBranches,
  resolveConfigRoot,
  resolveMainPath,
  stashPop,
} from "../git-worktree/git-operations.js";

function git(cmd: string, cwd: string) {
  execSync(`git ${cmd}`, { cwd, stdio: "pipe" });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "git-ops-test-"));
  // Force `main` as the default branch so tests are deterministic regardless
  // of the host user's `init.defaultBranch` config.
  git("-c init.defaultBranch=main init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);
  // Initial commit so we have a branch
  writeFileSync(join(dir, "README.md"), "init");
  git("add .", dir);
  git("commit -m init", dir);
  return dir;
}

describe("git-operations", () => {
  let repo: string;

  beforeEach(() => {
    repo = makeRepo();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  describe("isGitRepo", () => {
    it("returns true for a git repo", () => {
      expect(isGitRepo(repo)).toBe(true);
    });

    it("returns false for a non-git directory", () => {
      const plain = mkdtempSync(join(tmpdir(), "no-git-"));
      try {
        expect(isGitRepo(plain)).toBe(false);
      } finally {
        rmSync(plain, { recursive: true, force: true });
      }
    });
  });

  describe("resolveConfigRoot", () => {
    afterEach(() => vi.restoreAllMocks());

    it("git repo → returns resolveMainPath(cwd)", () => {
      expect(resolveConfigRoot(repo)).toBe(resolveMainPath(repo));
    });

    it("non-git dir with .pi/settings.json → returns cwd", () => {
      const plain = mkdtempSync(join(tmpdir(), "cfg-root-"));
      try {
        mkdirSync(join(plain, ".pi"), { recursive: true });
        writeFileSync(join(plain, ".pi", "settings.json"), "{}");
        expect(resolveConfigRoot(plain)).toBe(plain);
      } finally {
        rmSync(plain, { recursive: true, force: true });
      }
    });

    it("non-git dir without .pi/settings.json → null", () => {
      const plain = mkdtempSync(join(tmpdir(), "cfg-root-"));
      try {
        expect(resolveConfigRoot(plain)).toBeNull();
      } finally {
        rmSync(plain, { recursive: true, force: true });
      }
    });

    it("degenerate git (repo, mainCheckout null) → null, no cwd/.pi fallthrough", () => {
      const plain = mkdtempSync(join(tmpdir(), "cfg-root-"));
      try {
        // .pi/settings.json present so a fallthrough to the non-git branch
        // would wrongly return `plain`; assert it does NOT.
        mkdirSync(join(plain, ".pi"), { recursive: true });
        writeFileSync(join(plain, ".pi", "settings.json"), "{}");
        // In a repository (non-null result) whose mainCheckout is null
        // (degenerate git state) → null, and the non-git branch is unreachable.
        vi.spyOn(sharedGit, "checkoutRoots").mockReturnValue({
          thisCheckout: plain,
          isLinkedWorktree: false,
          mainCheckout: null,
          commonDir: join(plain, ".git"),
        });
        expect(gitOps.resolveConfigRoot(plain)).toBeNull();
      } finally {
        rmSync(plain, { recursive: true, force: true });
      }
    });

    it("no upward walk: non-git child of a .pi-bearing parent → null", () => {
      const parent = mkdtempSync(join(tmpdir(), "cfg-root-"));
      try {
        mkdirSync(join(parent, ".pi"), { recursive: true });
        writeFileSync(join(parent, ".pi", "settings.json"), "{}");
        const child = join(parent, "child");
        mkdirSync(child, { recursive: true });
        expect(resolveConfigRoot(child)).toBeNull();
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    });
  });

  describe("getDirtyFiles", () => {
    it("returns empty for a clean repo", () => {
      expect(getDirtyFiles(repo)).toEqual([]);
    });

    it("returns modified files", () => {
      writeFileSync(join(repo, "README.md"), "changed");
      const files = getDirtyFiles(repo);
      expect(files).toContain("README.md");
    });

    it("returns untracked files", () => {
      writeFileSync(join(repo, "new.txt"), "hello");
      const files = getDirtyFiles(repo);
      expect(files).toContain("new.txt");
    });
  });

  describe("listBranches", () => {
    it("lists the current branch", () => {
      const info = listBranches(repo);
      expect(info.detached).toBe(false);
      expect(info.branches.length).toBeGreaterThanOrEqual(1);
      const current = info.branches.find((b) => b.isCurrent);
      expect(current).toBeDefined();
      expect(current!.name).toBe(info.current);
    });

    it("lists multiple local branches", () => {
      git("checkout -b feature-a", repo);
      git("checkout -b feature-b", repo);
      const info = listBranches(repo);
      const names = info.branches.map((b) => b.name);
      expect(names).toContain("feature-a");
      expect(names).toContain("feature-b");
    });

    it("handles empty repo (no commits)", () => {
      const emptyRepo = mkdtempSync(join(tmpdir(), "git-empty-"));
      try {
        git("init", emptyRepo);
        const info = listBranches(emptyRepo);
        expect(info.detached).toBe(false);
        expect(info.branches).toEqual([]);
        expect(info.current).toBeTruthy(); // default branch name
      } finally {
        rmSync(emptyRepo, { recursive: true, force: true });
      }
    });

    it("detects detached HEAD", () => {
      const sha = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf-8" }).trim();
      git(`checkout ${sha}`, repo);
      const info = listBranches(repo);
      expect(info.detached).toBe(true);
      expect(info.current).toMatch(/^[0-9a-f]+$/);
    });

    it("lists remote branches", () => {
      // Create a "remote" by cloning
      const clone = mkdtempSync(join(tmpdir(), "git-ops-clone-"));
      try {
        execSync(`git clone ${repo} ${clone}`, { stdio: "pipe" });
        // Create a branch in origin that doesn't exist locally
        git("checkout -b remote-only", repo);
        writeFileSync(join(repo, "remote.txt"), "data");
        git("add .", repo);
        git("commit -m remote-only", repo);
        git("checkout main", repo);

        // Fetch in clone
        git("fetch origin", clone);
        const info = listBranches(clone);
        const remotes = info.branches.filter((b) => b.isRemote);
        const remoteNames = remotes.map((b) => b.name);
        expect(remoteNames.some((n) => n.includes("remote-only"))).toBe(true);
      } finally {
        rmSync(clone, { recursive: true, force: true });
      }
    });

    it("excludes origin/HEAD from remote branches", () => {
      const clone = mkdtempSync(join(tmpdir(), "git-ops-clone-"));
      try {
        execSync(`git clone ${repo} ${clone}`, { stdio: "pipe" });
        const info = listBranches(clone);
        const remoteNames = info.branches.filter((b) => b.isRemote).map((b) => b.name);
        expect(remoteNames.every((n) => !n.endsWith("/HEAD"))).toBe(true);
      } finally {
        rmSync(clone, { recursive: true, force: true });
      }
    });
  });

  describe("checkoutBranch", () => {
    it("checks out a local branch on clean repo", () => {
      git("checkout -b feature-x", repo);
      git("checkout main", repo);
      const result = checkoutBranch(repo, "feature-x", false);
      expect(result.success).toBe(true);
      const head = execSync("git rev-parse --abbrev-ref HEAD", { cwd: repo, encoding: "utf-8" }).trim();
      expect(head).toBe("feature-x");
    });

    it("returns dirty when working tree is dirty and stash=false", () => {
      git("checkout -b feature-y", repo);
      git("checkout main", repo);
      writeFileSync(join(repo, "README.md"), "dirty");
      const result = checkoutBranch(repo, "feature-y", false);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.dirty).toBe(true);
        expect(result.files.length).toBeGreaterThan(0);
      }
    });

    it("stashes and checks out when stash=true", () => {
      git("checkout -b feature-z", repo);
      git("checkout main", repo);
      writeFileSync(join(repo, "README.md"), "dirty");
      const result = checkoutBranch(repo, "feature-z", true);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stashed).toBe(true);
      }
      const head = execSync("git rev-parse --abbrev-ref HEAD", { cwd: repo, encoding: "utf-8" }).trim();
      expect(head).toBe("feature-z");
    });

    it("returns success when already on target branch", () => {
      const result = checkoutBranch(repo, "main", false);
      expect(result.success).toBe(true);
    });

    it("creates local tracking branch for remote branch", () => {
      // Create remote-only branch
      git("checkout -b only-remote", repo);
      writeFileSync(join(repo, "r.txt"), "data");
      git("add .", repo);
      git("commit -m r", repo);
      git("checkout main", repo);

      const clone = mkdtempSync(join(tmpdir(), "git-ops-clone-"));
      try {
        execSync(`git clone ${repo} ${clone}`, { stdio: "pipe" });
        const result = checkoutBranch(clone, "origin/only-remote", false);
        expect(result.success).toBe(true);
        const head = execSync("git rev-parse --abbrev-ref HEAD", { cwd: clone, encoding: "utf-8" }).trim();
        expect(head).toBe("only-remote");
      } finally {
        rmSync(clone, { recursive: true, force: true });
      }
    });
  });

  describe("gitInit", () => {
    it("initializes a new git repo", () => {
      const dir = mkdtempSync(join(tmpdir(), "git-init-"));
      try {
        gitInit(dir);
        expect(isGitRepo(dir)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("throws if already a git repo", () => {
      expect(() => gitInit(repo)).toThrow("already a git repository");
    });
  });

  // ── apply-checkout-root-to-worktree-ops: resolveMainPath / resolveConfigRoot ──

  describe("resolveMainPath — fixture matrix (E1)", () => {
    const savedEnv = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
    let fx: GitFixtures;

    beforeAll(() => {
      // The resolver spawns git with the ambient env; isolate it so a
      // developer's own `core.worktree` cannot leak into the assertions.
      process.env.GIT_CONFIG_GLOBAL = "/dev/null";
      process.env.GIT_CONFIG_SYSTEM = "/dev/null";
      fx = buildGitFixtures();
    });

    afterAll(() => {
      fx.cleanup();
      restoreEnv("GIT_CONFIG_GLOBAL", savedEnv.global);
      restoreEnv("GIT_CONFIG_SYSTEM", savedEnv.system);
    });

    // Exactly the D1 "new" column.
    const cases: Array<[string, keyof GitFixtures, keyof GitFixtures | null]> = [
      ["normal checkout", "normal", "normal"],
      ["deep subdir", "normalSubdir", "normal"],
      ["linked worktree", "worktree", "normal"],
      ["submodule", "submodule", "submodule"],
      ["worktree of submodule", "submoduleWorktree", "submodule"],
      ["--separate-git-dir checkout", "separateGitDir", "separateGitDir"],
      ["bare hub", "bare", null],
      ["worktree of bare hub", "bareWorktree", null],
      ["non-repo", "nonRepo", null],
    ];

    it.each(cases)("%s → %s", (_name, cwdKey, mainKey) => {
      const cwd = fx[cwdKey] as string;
      const expected = mainKey === null ? null : (fx[mainKey] as string);
      expect(resolveMainPath(cwd)).toBe(expected);
    });
  });

  describe("resolveMainPath — .git-segment rejection is exact-component (E2)", () => {
    const savedEnv = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
    let fx: GitFixtures;
    let base: string;
    let wt: string;

    beforeAll(() => {
      process.env.GIT_CONFIG_GLOBAL = "/dev/null";
      process.env.GIT_CONFIG_SYSTEM = "/dev/null";
      fx = buildGitFixtures();
      base = realpathSync(mkdtempSync(join(tmpdir(), "gitops-gitseg-")));
      fixtureGit(base, ["init", "-q"]);
      writeFileSync(join(base, "seed.txt"), "seed\n");
      fixtureGit(base, ["add", "."]);
      fixtureGit(base, ["commit", "-q", "-m", "seed"]);
      wt = join(base, "wt");
      fixtureGit(base, ["worktree", "add", "-q", "-b", "segwt", wt]);
      // Repo-local `core.worktree` pointing INSIDE the git dir. mainCheckout
      // resolves to `<base>/.git` — a path carrying a `.git` COMPONENT.
      fixtureGit(base, ["config", "core.worktree", ".git"]);
    });

    afterAll(() => {
      fx.cleanup();
      rmSync(base, { recursive: true, force: true });
      restoreEnv("GIT_CONFIG_GLOBAL", savedEnv.global);
      restoreEnv("GIT_CONFIG_SYSTEM", savedEnv.system);
    });

    it("returns null when mainCheckout sits inside .git/ (resolved against commonDir)", () => {
      expect(resolveMainPath(wt)).toBeNull();
    });

    it("returns a real path for the app.git fixture (a `.git`-NAMED dir is not a `.git` component)", () => {
      expect(resolveMainPath(fx.dotGitNamedCheckout)).toBe(fx.dotGitNamedCheckout);
    });
  });

  describe("resolveMainPath — request-budgeted resolver call (E3)", () => {
    afterEach(() => vi.restoreAllMocks());

    it("the spy receives timeout: 400, never undefined or the 15s batch default", () => {
      const repo = makeRepo();
      try {
        const spy = vi.spyOn(sharedGit, "checkoutRoots");
        resolveMainPath(repo);
        expect(spy).toHaveBeenCalledWith({ cwd: repo, timeout: 400 });
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });
  });

  describe("resolveConfigRoot — per git state (E19)", () => {
    const savedEnv = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
    let fx: GitFixtures;

    beforeAll(() => {
      process.env.GIT_CONFIG_GLOBAL = "/dev/null";
      process.env.GIT_CONFIG_SYSTEM = "/dev/null";
      fx = buildGitFixtures();
      // Bare hub WITH a `.pi/settings.json` — a fall-through would adopt it.
      mkdirSync(join(fx.bare, ".pi"), { recursive: true });
      writeFileSync(join(fx.bare, ".pi", "settings.json"), "{}");
    });

    afterAll(() => {
      fx.cleanup();
      restoreEnv("GIT_CONFIG_GLOBAL", savedEnv.global);
      restoreEnv("GIT_CONFIG_SYSTEM", savedEnv.system);
    });

    const cases: Array<[string, keyof GitFixtures, keyof GitFixtures | null]> = [
      ["submodule → its own working tree", "submodule", "submodule"],
      ["worktree of submodule → the submodule tree", "submoduleWorktree", "submodule"],
      ["--separate-git-dir → the checkout", "separateGitDir", "separateGitDir"],
      ["bare with .pi/settings.json → null (no fall-through)", "bare", null],
      ["non-git without settings → null", "nonRepo", null],
    ];

    it.each(cases)("%s", (_name, cwdKey, rootKey) => {
      const cwd = fx[cwdKey] as string;
      const expected = rootKey === null ? null : (fx[rootKey] as string);
      expect(resolveConfigRoot(cwd)).toBe(expected);
    });

    it("non-git dir with .pi/settings.json → cwd itself", () => {
      mkdirSync(join(fx.nonRepo, ".pi"), { recursive: true });
      writeFileSync(join(fx.nonRepo, ".pi", "settings.json"), "{}");
      expect(resolveConfigRoot(fx.nonRepo)).toBe(fx.nonRepo);
    });

    it("nested non-git child does not inherit the parent's settings (no upward walk)", () => {
      const child = join(fx.nonRepo, "child");
      mkdirSync(child, { recursive: true });
      expect(resolveConfigRoot(child)).toBeNull();
    });
  });

  describe("stashPop", () => {
    it("pops stash cleanly", () => {
      writeFileSync(join(repo, "README.md"), "stashed-content");
      git("stash push -u", repo);
      const result = stashPop(repo);
      expect(result.conflicts).toBe(false);
    });

    it("throws when no stash entries", () => {
      expect(() => stashPop(repo)).toThrow("no stash entries");
    });

    it("detects conflicts on stash pop", () => {
      // Create a stash, then modify same file on current branch
      writeFileSync(join(repo, "README.md"), "stash-version");
      git("stash push -u", repo);
      writeFileSync(join(repo, "README.md"), "branch-version");
      git("add .", repo);
      git("commit -m conflict", repo);
      const result = stashPop(repo);
      expect(result.conflicts).toBe(true);
    });
  });
});

describe("classifyWorktreeRemoval — tri-state classifier (E4)", () => {
  it.each<[string, Parameters<typeof gitOps.classifyWorktreeRemoval>[0], string]>([
    ["no resolver result → unresolved", null, "unresolved"],
    [
      "not a linked worktree → main",
      { thisCheckout: "/r", isLinkedWorktree: false, mainCheckout: "/r", commonDir: "/r/.git" },
      "main",
    ],
    [
      "linked + thisCheckout null (inconclusive --show-toplevel) → unresolved",
      { thisCheckout: null, isLinkedWorktree: true, mainCheckout: "/r", commonDir: "/r/.git" },
      "unresolved",
    ],
    [
      "linked + mainCheckout null (worktree of bare hub) → unresolved",
      { thisCheckout: "/wt", isLinkedWorktree: true, mainCheckout: null, commonDir: "/r/.git" },
      "unresolved",
    ],
    [
      "linked + mainCheckout with a .git segment → unresolved",
      { thisCheckout: "/wt", isLinkedWorktree: true, mainCheckout: "/r/.git/x", commonDir: "/r/.git" },
      "unresolved",
    ],
    [
      "linked + plausible mainCheckout → removable",
      { thisCheckout: "/wt", isLinkedWorktree: true, mainCheckout: "/r", commonDir: "/r/.git" },
      "removable",
    ],
  ])("%s", (_name, roots, verdict) => {
    expect(gitOps.classifyWorktreeRemoval(roots)).toBe(verdict);
  });
});
