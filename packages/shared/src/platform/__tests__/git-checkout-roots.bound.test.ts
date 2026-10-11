
import { mkdirSync, realpathSync, symlinkSync, } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupGitShims, makeGitShim, useGitPath } from "../../test-support/git-shim.js";
import {
  buildGitFixtures,
  fixtureGit,
  type GitFixtures,
  restoreEnv,
} from "../../test-support/git-fixtures.js";
import { getDefaultRegistry } from "../../tool-registry/index.js";
import { samePath } from "../paths.js";
import {
  checkoutRoots,
  checkoutRootsAsync,
  type GitCheckoutRootAsyncProbes,
  type GitCheckoutRootProbes,
  isBoundCheckout,
  isBoundCheckoutAsync,
  isBoundCheckoutFromRoots,
  resolveCheckoutRootsFrom,
  resolveCheckoutRootsFromAsync,
} from "../git.js";

let fx: GitFixtures;
const savedEnv = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };

beforeAll(() => {
  // The resolver spawns git with the ambient env, so the developer's own
  // `core.worktree` would otherwise leak into the mainCheckout assertions.
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_SYSTEM = "/dev/null";
  fx = buildGitFixtures();
});

afterAll(() => {
  fx.cleanup();
  cleanupGitShims();
  restoreEnv("GIT_CONFIG_GLOBAL", savedEnv.global);
  restoreEnv("GIT_CONFIG_SYSTEM", savedEnv.system);
});

/** Probes that return fixed strings — for states no fixture can build. */
function stubProbes(over: Partial<GitCheckoutRootProbes>): GitCheckoutRootProbes {
  return {
    gitDir: () => undefined,
    commonDir: () => undefined,
    topLevel: () => undefined,
    localCoreWorktree: () => undefined,
    localCoreBare: () => "not-bare" as const,
    ...over,
  };
}

// ── Task 1.2 — the fixture builder itself ──────────────────────────────────


const isWin = process.platform === "win32";

/** Async twin of {@link stubProbes} — same answers, awaited. */
function stubAsyncProbes(over: Partial<GitCheckoutRootProbes>): GitCheckoutRootAsyncProbes {
  const sync = stubProbes(over);
  return {
    gitDir: async () => sync.gitDir(),
    commonDir: async () => sync.commonDir(),
    topLevel: async () => sync.topLevel(),
    localCoreWorktree: async (commonDir) => sync.localCoreWorktree(commonDir),
    localCoreBare: async (commonDir) => sync.localCoreBare(commonDir),
  };
}

/** Every fixture state, plus a non-repository directory. */
function states(): Array<[string, string]> {
  return [
    ["normal", fx.normal],
    ["normalSubdir", fx.normalSubdir],
    ["worktree", fx.worktree],
    ["submodule", fx.submodule],
    ["submoduleWorktree", fx.submoduleWorktree],
    ["bare", fx.bare],
    ["bareWorktree", fx.bareWorktree],
    ["separateGitDir", fx.separateGitDir],
    ["dotGitNamedCheckout", fx.dotGitNamedCheckout],
    ["nonRepo", fx.nonRepo],
  ];
}

// ── E1 — the commonDir identity field ──────────────────────────────────────

describe("commonDir is the repository identity, per state", () => {
  it("E1: carries the canonical common dir for every fixture state", () => {
    expect(checkoutRoots({ cwd: fx.normal })!.commonDir).toBe(path.join(fx.normal, ".git"));
    expect(checkoutRoots({ cwd: fx.normalSubdir })!.commonDir).toBe(path.join(fx.normal, ".git"));
    expect(checkoutRoots({ cwd: fx.worktree })!.commonDir).toBe(path.join(fx.normal, ".git"));
    expect(checkoutRoots({ cwd: fx.submodule })!.commonDir).toBe(
      path.join(fx.superproject, ".git", "modules", "models", "sub"),
    );
    expect(checkoutRoots({ cwd: fx.submoduleWorktree })!.commonDir).toBe(
      path.join(fx.superproject, ".git", "modules", "models", "sub"),
    );
    expect(checkoutRoots({ cwd: fx.bare })!.commonDir).toBe(fx.bare);
    expect(checkoutRoots({ cwd: fx.bareWorktree })!.commonDir).toBe(fx.bare);
    expect(checkoutRoots({ cwd: fx.separateGitDir })!.commonDir).toBe(fx.separateGitDirGitDir);
    expect(checkoutRoots({ cwd: fx.dotGitNamedCheckout })!.commonDir).toBe(
      path.join(fx.dotGitNamedCheckout, ".git"),
    );
  });

  it("E1b: a non-repository cwd has no commonDir, because it has no result", () => {
    expect(checkoutRoots({ cwd: fx.nonRepo })).toBeNull();
  });
});

// ── E2, X3, X4 — async parity over the SAME resolution logic ───────────────

describe("checkoutRootsAsync", () => {
  it("E2: agrees with the synchronous resolver for every state, nonRepo included", async () => {
    for (const [name, cwd] of states()) {
      expect(await checkoutRootsAsync({ cwd }), name).toEqual(checkoutRoots({ cwd }));
    }
    expect(checkoutRoots({ cwd: fx.nonRepo })).toBeNull();
    expect(await checkoutRootsAsync({ cwd: fx.nonRepo })).toBeNull();
  });

  it("E2b: resolves a linked worktree to the same roots as the sync form", async () => {
    const asyncRoots = await checkoutRootsAsync({ cwd: fx.worktree });
    expect(asyncRoots).toEqual(checkoutRoots({ cwd: fx.worktree }));
    expect(asyncRoots!.isLinkedWorktree).toBe(true);
    expect(asyncRoots!.mainCheckout).toBe(fx.normal);
  });

  it("X3: the async core agrees with the sync core on degraded probes", async () => {
    const cases: Array<Partial<GitCheckoutRootProbes>> = [
      // `--show-toplevel` throws (a timeout, say) — a bare-shaped result.
      {
        gitDir: () => "/work/repo/.git/worktrees/wt",
        commonDir: () => "/work/repo/.git",
        topLevel: () => {
          throw new Error("timeout");
        },
      },
      // The `core.bare` probe fails — bareness must be `"unknown"`, never `"not-bare"`.
      {
        gitDir: () => "/work/repo/.git/worktrees/wt",
        commonDir: () => "/work/repo/.git",
        topLevel: () => "/work/wt",
        localCoreBare: () => {
          throw new Error("timeout");
        },
      },
      // A healthy worktree with a repository-local `core.worktree`.
      {
        gitDir: () => "/work/repo/.git/worktrees/wt",
        commonDir: () => "/work/repo/.git",
        topLevel: () => "/work/wt",
        localCoreWorktree: () => "/work/repo",
      },
    ];

    for (const over of cases) {
      const sync = resolveCheckoutRootsFrom(stubProbes(over), "linux");
      const asyncRoots = await resolveCheckoutRootsFromAsync(stubAsyncProbes(over), "linux");
      expect(asyncRoots, JSON.stringify(over)).toEqual(sync);
    }

    // The unanswerable bareness probe must NOT take the parent fallback.
    const unknownBare = await resolveCheckoutRootsFromAsync(stubAsyncProbes(cases[1]), "linux");
    expect(unknownBare).toMatchObject({
      thisCheckout: "/work/wt",
      isLinkedWorktree: true,
      mainCheckout: null,
      commonDir: "/work/repo/.git",
    });
  });

  it.skipIf(isWin)("X4: a probe timeout yields null, never a partial result", async () => {
    const restore = useGitPath(makeGitShim("sleep 5"));
    try {
      expect(await checkoutRootsAsync({ cwd: fx.normal, timeout: 1 })).toBeNull();
    } finally {
      restore();
    }
  });
});

// ── E3–E11, X5 — repository binding ────────────────────────────────────────

/** Build a throwaway repo under the fixture root, cloned from `normal`. */
function clone(name: string): string {
  const dir = path.join(fx.root, name);
  fixtureGit(fx.root, ["clone", "-q", fx.normal, dir]);
  return dir;
}

describe("isBoundCheckout — positive controls", () => {
  it("E3: an honest linked worktree's main checkout is bound", async () => {
    const roots = checkoutRoots({ cwd: fx.worktree })!;
    expect(roots.mainCheckout).toBe(fx.normal);
    expect(isBoundCheckout(roots.mainCheckout!, roots.commonDir)).toBe(true);
    expect(await isBoundCheckoutAsync(roots.mainCheckout!, roots.commonDir)).toBe(true);
  });

  it("E4: a worktree of a submodule binds to the submodule checkout", async () => {
    const roots = checkoutRoots({ cwd: fx.submoduleWorktree })!;
    expect(roots.mainCheckout).toBe(fx.submodule);
    expect(isBoundCheckout(roots.mainCheckout!, roots.commonDir)).toBe(true);
    expect(await isBoundCheckoutAsync(roots.mainCheckout!, roots.commonDir)).toBe(true);
  });

  it("E5: a sibling linked worktree of the SAME repository is bound", async () => {
    const repo = clone("e5-repo");
    const wtA = path.join(fx.root, "e5-wt-a");
    const wtB = path.join(fx.root, "e5-wt-b");
    fixtureGit(repo, ["worktree", "add", "-q", "-b", "e5a", wtA]);
    fixtureGit(repo, ["worktree", "add", "-q", "-b", "e5b", wtB]);
    fixtureGit(repo, ["config", "--local", "core.worktree", wtB]);

    const roots = checkoutRoots({ cwd: wtA })!;
    expect(roots.mainCheckout).toBe(wtB);
    expect(isBoundCheckout(roots.mainCheckout!, roots.commonDir)).toBe(true);
    expect(await isBoundCheckoutAsync(roots.mainCheckout!, roots.commonDir)).toBe(true);
  });

  it.skipIf(isWin)("E11: a symlinked candidate binds, comparing on REAL paths", async () => {
    const link = path.join(fx.root, "e11-link");
    symlinkSync(fx.normal, link);
    const roots = checkoutRoots({ cwd: fx.worktree })!;
    expect(realpathSync(link)).toBe(fx.normal);
    expect(isBoundCheckout(link, roots.commonDir)).toBe(true);
    expect(await isBoundCheckoutAsync(link, roots.commonDir)).toBe(true);
  });
});

describe("isBoundCheckout — adversarial rejections", () => {
  it("E6: a core.worktree aimed at an unrelated checkout is unbound", async () => {
    const repoA = clone("e6-a");
    const repoB = clone("e6-b");
    const wtA = path.join(fx.root, "e6-wt");
    fixtureGit(repoA, ["worktree", "add", "-q", "-b", "e6", wtA]);
    fixtureGit(repoA, ["config", "--local", "core.worktree", repoB]);

    const roots = checkoutRoots({ cwd: wtA })!;
    expect(roots.mainCheckout).toBe(repoB);
    expect(isBoundCheckout(roots.mainCheckout!, roots.commonDir)).toBe(false);
    expect(await isBoundCheckoutAsync(roots.mainCheckout!, roots.commonDir)).toBe(false);
  });

  it("E7: a non-repository and a nonexistent candidate are both unbound", async () => {
    const repo = clone("e7-repo");
    const wt = path.join(fx.root, "e7-wt");
    fixtureGit(repo, ["worktree", "add", "-q", "-b", "e7", wt]);
    const fresh = path.join(fx.root, "e7-fresh");
    mkdirSync(fresh);
    fixtureGit(repo, ["config", "--local", "core.worktree", fresh]);

    const roots = checkoutRoots({ cwd: wt })!;
    expect(roots.mainCheckout).toBe(fresh);
    expect(isBoundCheckout(fresh, roots.commonDir)).toBe(false);

    // `git config` validates the path at WRITE time, so a nonexistent
    // `core.worktree` cannot be stored — but the resolver would still return
    // one verbatim, so the check must reject it on its own.
    const missing = path.join(fresh, "does-not-exist");
    expect(isBoundCheckout(missing, roots.commonDir)).toBe(false);
    expect(await isBoundCheckoutAsync(missing, roots.commonDir)).toBe(false);
  });

  it("E8: a different repo that CONTAINS the worktree's parent is unbound", async () => {
    const outer = path.join(fx.root, "e8-outer");
    mkdirSync(outer);
    fixtureGit(outer, ["init", "-q"]);
    const repoA = path.join(outer, "e8-repo");
    fixtureGit(fx.root, ["clone", "-q", fx.normal, repoA]);
    const wtA = path.join(outer, "e8-wt");
    fixtureGit(repoA, ["worktree", "add", "-q", "-b", "e8", wtA]);
    fixtureGit(repoA, ["config", "--local", "core.worktree", outer]);

    const roots = checkoutRoots({ cwd: wtA })!;
    expect(roots.mainCheckout).toBe(outer);
    // `outer` contains cwd, yet it is a DIFFERENT repository → unbound.
    expect(isBoundCheckout(roots.mainCheckout!, roots.commonDir)).toBe(false);
  });

  it("E9: a git-internal candidate is unbound, with and without the segment test", () => {
    const repo = clone("e9-repo");
    const wt = path.join(fx.root, "e9-wt");
    fixtureGit(repo, ["worktree", "add", "-q", "-b", "e9", wt]);
    const bogus = path.join(repo, ".git", "x");
    mkdirSync(bogus, { recursive: true });
    fixtureGit(repo, ["config", "--local", "core.worktree", bogus]);

    const roots = checkoutRoots({ cwd: wt })!;
    expect(roots.mainCheckout).toBe(bogus);
    // Rule 1: the `.git`-segment test rejects it.
    expect(isBoundCheckout(roots.mainCheckout!, roots.commonDir)).toBe(false);
    // Rule 1 bypassed: MEASURED — with `core.worktree` aimed inside `.git`, git
    // happily reports that path as its own toplevel, so `--show-toplevel` does
    // NOT fail there. The path comparison is therefore load-bearing.
    expect(checkoutRoots({ cwd: bogus })!.thisCheckout).toBe(bogus);
    expect(isBoundCheckoutFromRoots(bogus, roots.commonDir, checkoutRoots({ cwd: bogus }))).toBe(false);
  });

  it("E10: a subdirectory of the true main is MEASURED, and never widens to it", () => {
    const repo = clone("e10-repo");
    const wt = path.join(fx.root, "e10-wt");
    fixtureGit(repo, ["worktree", "add", "-q", "-b", "e10", wt]);
    const sub = path.join(repo, "sub", "dir");
    mkdirSync(sub, { recursive: true });
    fixtureGit(repo, ["config", "--local", "core.worktree", sub]);

    const roots = checkoutRoots({ cwd: wt })!;
    expect(roots.mainCheckout).toBe(sub);

    const reResolved = checkoutRoots({ cwd: sub });
    const bound = isBoundCheckoutFromRoots(sub, roots.commonDir, reResolved);
    if (bound) {
      // Bound ⇒ the anchor is the SUBDIRECTORY itself, strictly narrower than
      // the real main checkout. Compared with `samePath`, because that is the
      // comparison the binding made — exact equality would flake on a
      // case-insensitive filesystem.
      expect(samePath(reResolved!.thisCheckout!, sub)).toBe(true);
      expect(samePath(reResolved!.thisCheckout!, repo)).toBe(false);
    }
    // Either way the real main checkout must never become the anchor.
    expect(reResolved?.thisCheckout ?? null).not.toBe(repo);
    expect(isBoundCheckout(sub, roots.commonDir)).toBe(bound);
  });

  it.skipIf(isWin)("X5: a probe timeout reports the candidate unbound", async () => {
    const roots = checkoutRoots({ cwd: fx.worktree })!;
    // The timeout is deliberately LONGER than a healthy git needs: the shim
    // sleeps 5 s, so a shim that failed to take effect would resolve within
    // the budget and report the (honest) candidate as BOUND.
    const shim = makeGitShim("sleep 5");
    const restore = useGitPath(shim);
    try {
      // Guard against a vacuous pass: the shim must actually BE the git.
      const resolved = getDefaultRegistry().resolve("git");
      expect(resolved.ok && resolved.path).toBe(path.join(shim, "git"));
      expect(isBoundCheckout(roots.mainCheckout!, roots.commonDir, { timeout: 1_000 })).toBe(false);
      expect(await isBoundCheckoutAsync(roots.mainCheckout!, roots.commonDir, { timeout: 1_000 })).toBe(false);
    } finally {
      restore();
    }
  });

  it.skipIf(isWin)("X5b: git unavailable reports the candidate unbound", async () => {
    const roots = checkoutRoots({ cwd: fx.worktree })!;
    const restore = useGitPath(null);
    try {
      // Guard against a vacuous pass: git must really be unresolvable.
      expect(getDefaultRegistry().resolve("git").ok).toBe(false);
      expect(isBoundCheckout(roots.mainCheckout!, roots.commonDir)).toBe(false);
      expect(await isBoundCheckoutAsync(roots.mainCheckout!, roots.commonDir)).toBe(false);
    } finally {
      restore();
    }
  });
});
