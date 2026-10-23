import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as platformExec from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import * as sharedGit from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import {
  buildGitFixtures,
  fixtureGit,
  type GitFixtures,
  restoreEnv,
} from "@blackbelt-technology/pi-dashboard-shared/test-support/git-fixtures.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { redactGitText } from "../git-worktree/redact-git-text.js";
import { assertRefArg, InvalidRefError } from "../git-worktree/ref-arg.js";

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

  describe("listBranches parsing (fix-codeql-small-findings #E14)", () => {
    it("local names are exact (no %(HEAD) padding) and remote HEAD is skipped", () => {
      const remote = mkdtempSync(join(tmpdir(), "git-ops-remote-"));
      try {
        git("checkout -b feature/x", repo);
        git("checkout main", repo);
        git("checkout -b only-remote", repo);
        git("checkout main", repo);
        execSync(`git clone --bare ${repo} ${remote}`, { stdio: "pipe" });
        git(`remote add origin ${remote}`, repo);
        git("fetch origin", repo);
        git("remote set-head origin main", repo);
        git("branch -D only-remote", repo);
        const info = listBranches(repo);
        const local = info.branches.filter((b) => !b.isRemote);
        expect(local.map((b) => b.name).sort()).toEqual(["feature/x", "main"]);
        expect(local.filter((b) => b.isCurrent).map((b) => b.name)).toEqual(["main"]);
        const remoteNames = info.branches.filter((b) => b.isRemote).map((b) => b.name);
        expect(remoteNames).toContain("origin/only-remote");
        expect(remoteNames.some((n) => n.endsWith("/HEAD"))).toBe(false);
      } finally {
        rmSync(remote, { recursive: true, force: true });
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

// ── B20: redactGitText (change: harden-git-terminal-plugin-boundaries) ──────────
describe("redactGitText", () => {
  const ctx = { root: "/home/u/proj", home: "/home/u" };
  const r = (t: string) => redactGitText(t, ctx);
  const alnum = (n: number) => "aB3".repeat(Math.ceil(n / 3)).slice(0, n);

  it("SE10: relativizes repo paths, ~ for home, <path> for foreign, no sibling-prefix leak", () => {
    expect(r("/home/u/proj/src/a.ts")).toBe("src/a.ts");
    expect(r("/home/u/.ssh/config")).toBe("~/.ssh/config");
    expect(r("/var/secret/x")).toBe("<path>");
    expect(r("D:\\other\\x")).toBe("<path>");
    expect(r("/home/u/proj-wt/x.ts")).toBe("~/proj-wt/x.ts");
    expect(r("src/a.ts")).toBe("src/a.ts");
    expect(r("fatal: '/home/u/proj/src/a.ts': not found")).toBe("fatal: 'src/a.ts': not found");
  });

  it("SE11: URL userinfo is removed, host/path kept", () => {
    const out = r(
      [
        "https://user:tok@github.com/o/r.git",
        "https://deploytoken@github.com/o/r.git",
        "http://u:p@h/x",
        "https://user:p%40ss@host/x",
        "https://user:p@ss@host/x",
      ].join(" and "),
    );
    for (const secret of ["user", "tok", "deploytoken", "p%40ss", "ss@", "u:p"]) expect(out).not.toContain(secret);
    expect(out).toContain("github.com/o/r.git");
    expect(out).not.toContain("<path>");
    expect(out).toContain("host/x");
    expect(r("https://a:b@one/x https://c:d@two/y")).toBe("https://one/x https://two/y");
  });

  it("SE12: token shapes are masked to prefix + ***", () => {
    const cases: Array<[string, string]> = [
      [`ghp_${alnum(36)}`, "ghp_***"],
      [`github_pat_${alnum(82)}`, "github_pat_***"],
      [`glpat-${alnum(20)}`, "glpat-***"],
      [`sk-${alnum(48)}`, "sk-***"],
    ];
    for (const [secret, masked] of cases) {
      expect(r(`remote said ${secret} was rejected`)).toBe(`remote said ${masked} was rejected`);
    }
    expect(r("sent Authorization: Bearer abc.def.ghi to host")).toBe("sent Authorization: Bearer *** to host");
  });

  it("SE13: commit SHAs survive byte-identical", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(r(sha)).toBe(sha);
    expect(r(`bad object ${sha}`)).toBe(`bad object ${sha}`);
    expect(r(`/home/u/proj/.git/objects/01/${sha.slice(2)}`)).toBe(`.git/objects/01/${sha.slice(2)}`);
    const sha256 = "ab".repeat(32);
    expect(r(sha256)).toBe(sha256);
    expect(r("abc1234")).toBe("abc1234");
    const out = r(`${sha} ghp_${alnum(36)} ${sha256}`);
    expect(out).toBe(`${sha} ghp_*** ${sha256}`);
  });

  it("SE36: token bounds (>=20 chars, non-word boundary before prefix)", () => {
    for (const same of [
      "task-1",
      "risk-averse",
      "sk-abc12",
      `sk-${alnum(19)}`,
      `xsk-${alnum(20)}`,
      `_sk-${alnum(20)}`,
      `ghp_${alnum(19)}`,
    ]) {
      expect(r(same)).toBe(same);
    }
    expect(r(`sk-${alnum(20)}`)).toBe("sk-***");
    expect(r(`sk-${alnum(25)}!`)).toBe("sk-***!");
    expect(r(`sk-${alnum(60)}`)).toBe("sk-***");
    expect(r(`(sk-${alnum(20)}`)).toBe("(sk-***");
    expect(r(`ghp_${alnum(20)}`)).toBe("ghp_***");
  });

  it("SE37: bare root -> '.', ssh password removed (user kept), ssh user-only and scp unchanged", () => {
    expect(r("/home/u/proj")).toBe(".");
    expect(r("ssh://user:pass@host/x")).toBe("ssh://user@host/x");
    expect(r("ssh://git@host/x")).toBe("ssh://git@host/x");
    expect(r("git@github.com:o/r.git")).toBe("git@github.com:o/r.git");
    expect(r("ssh://git:secret@github.com/o/r.git")).toBe("ssh://git@github.com/o/r.git");
  });

  it("SE37b: hook output with no paths or secrets is byte-identical", () => {
    const text = "husky - pre-commit hook exited with code 1 (error)\nlint: 3 problems\n\u2716 unicode ok";
    expect(r(text)).toBe(text);
  });

  it("SX9: never throws on odd input", () => {
    expect(redactGitText(undefined, ctx)).toBe("");
    expect(redactGitText(null, ctx)).toBe("");
    expect(redactGitText("", ctx)).toBe("");
    expect(redactGitText(new Error(""), ctx)).toBe("");
    expect(redactGitText(new Error("fatal: /home/u/x"), ctx)).toBe("fatal: ~/x");
    expect(redactGitText("fatal: /home/u/x", ctx)).toBe("fatal: ~/x");
    expect(redactGitText("0123456789", ctx)).toBe("0123456789");
    expect(redactGitText(Buffer.from([0xff, 0xfe, 0x66, 0x6f]), ctx)).toEqual(expect.any(String));
    expect(redactGitText("bad \uFFFD bytes", ctx)).toBe("bad \uFFFD bytes");
    expect(redactGitText({ weird: true }, ctx)).toEqual(expect.any(String));
    expect(() => redactGitText("/x", { root: undefined, home: undefined })).not.toThrow();
  });

  it("SP4: linear-time on pathological 100 KB / 1 MB inputs", () => {
    const mk = (bytes: number, unit: string) => unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
    const units = ["https://", "/a", "Bearer ", "https://u:p@h/x /home/u/proj/a.ts Bearer abc sk-aaaaaaaaaaaaaaaaaaaaaaaa "];
    // CPU time (user+system), not wall time: a loaded CI host can deschedule the process for tens
    // of ms, which says nothing about the algorithm's cost.
    const cpuMs = () => {
      const u = process.cpuUsage();
      return (u.user + u.system) / 1000;
    };
    const run = (input: string, times: number) => {
      const t: number[] = [];
      for (let i = 0; i < times; i++) {
        const s = cpuMs();
        redactGitText(input, ctx);
        t.push(cpuMs() - s);
      }
      return t.sort((a, b) => a - b);
    };
    for (const unit of units) {
      run(mk(100_000, unit), 5); // warm-up
      const small = run(mk(100_000, unit), 200);
      expect(small[Math.floor(small.length * 0.99) - 1]).toBeLessThan(10);
      const big = run(mk(1_000_000, unit), 20);
      const med = (a: number[]) => a[Math.floor(a.length / 2)];
      expect(med(big)).toBeLessThanOrEqual(20 * Math.max(med(small), 0.05));
    }
  });
});

// ── B1r: assertRefArg + derived checkout name (change: harden-git-terminal-plugin-boundaries) ──
describe("assertRefArg", () => {
  it("accepts ordinary refs", () => {
    for (const ok of ["feature/a-b", "feature/x", "origin/main", "0123456789abcdef0123456789abcdef01234567", "release/1.2.3", "a-b", "feature/--x", "a\u0085b", "a\u2028b", "a\u00e9b"]) {
      expect(assertRefArg(ok)).toBe(ok);
    }
  });
  it("refuses non-strings, empty, leading dash and C0/DEL controls", () => {
    for (const bad of ["-x", "--orphan=x", "-", "--", "-b", "", 0, false, true, 1, {}, [], ["main"], null, undefined, "a\nb", "a\u0000b", "a\tb", "a\rb", "a\u001fb", "a\u007fb"]) {
      expect(() => assertRefArg(bad)).toThrow(InvalidRefError);
    }
  });
});

describe("checkoutBranch derived local name (SE6)", () => {
  let repo: string;
  let calls: string[][];
  let spies: Array<ReturnType<typeof vi.spyOn>>;
  beforeEach(() => {
    repo = makeRepo();
    calls = [];
    const real = platformExec.execFileSync;
    const realSync = platformExec.spawnSync;
    spies = [
      vi.spyOn(platformExec, "execFileSync").mockImplementation(((file: any, args: any, opts: any) => {
        if (file === "git") calls.push([...(args ?? [])]);
        return (real as any)(file, args, opts);
      }) as any),
      vi.spyOn(platformExec, "spawnSync").mockImplementation(((file: any, args: any, opts: any) => {
        if (file === "git") calls.push([...(args ?? [])]);
        return (realSync as any)(file, args, opts);
      }) as any),
    ];
  });
  afterEach(() => {
    for (const s of spies) s.mockRestore();
    rmSync(repo, { recursive: true, force: true });
  });

  it("origin/-x, origin/--orphan=x, origin/ -> InvalidRefError before any git spawn", () => {
    for (const bad of ["origin/-x", "origin/--orphan=x", "origin/"]) {
      expect(() => checkoutBranch(repo, bad, false)).toThrow(InvalidRefError);
    }
    expect(calls).toEqual([]);
  });

  it("direct option-like branch refused before any git spawn", () => {
    expect(() => checkoutBranch(repo, "--orphan=x", false)).toThrow(InvalidRefError);
    expect(calls).toEqual([]);
  });

  it("origin/feature/a-b strips only the remote prefix: checkout -b feature/a-b origin/feature/a-b", () => {
    const remote = mkdtempSync(join(tmpdir(), "git-ops-remote-"));
    try {
      git("checkout -b feature/a-b", repo);
      writeFileSync(join(repo, "r.txt"), "d");
      git("add .", repo);
      git("commit -m r", repo);
      git("checkout main", repo);
      execSync(`git clone ${repo} ${remote}`, { stdio: "pipe" });
      calls.length = 0;
      const result = checkoutBranch(remote, "origin/feature/a-b", false);
      expect(result.success).toBe(true);
      expect(calls).toContainEqual(["checkout", "-b", "feature/a-b", "origin/feature/a-b"]);
    } finally {
      rmSync(remote, { recursive: true, force: true });
    }
  });

  it("origin/main is accepted (existing local main -> plain checkout of the derived name)", () => {
    const clone = mkdtempSync(join(tmpdir(), "git-ops-clone2-"));
    try {
      execSync(`git clone ${repo} ${clone}`, { stdio: "pipe" });
      git("checkout -b side", clone);
      const result = checkoutBranch(clone, "origin/main", false);
      expect(result.success).toBe(true);
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });
});
