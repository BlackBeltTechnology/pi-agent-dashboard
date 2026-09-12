/**
 * Checkout-root resolver tests — the state matrix, pinned by REAL repos.
 *
 * Two layers, deliberately:
 *   - real-fixture tests (`buildGitFixtures`) exercise the canonical
 *     `checkoutRoots()` wiring, so a mis-wired probe (`--path-format=absolute`
 *     missing on one side) is caught;
 *   - injected-thunk tests exercise `resolveCheckoutRootsFrom` for the states
 *     no fixture can produce (probe timeouts, an implausible `core.worktree`).
 *
 * Covers test-plan E1–E13, X1–X4 plus the fixture self-assertion.
 * See change: add-git-checkout-root-resolver.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupGitShims, makeGitShim, useGitPath } from "../../test-support/git-shim.js";
import {
  buildGitFixtures,
  fixtureGit,
  type GitFixtures,
  probeTriple,
  restoreEnv,
} from "../../test-support/git-fixtures.js";
import { getDefaultRegistry } from "../../tool-registry/index.js";
import { samePath } from "../paths.js";
import {
  checkoutRoots,
  checkoutRootsAsync,
  GIT_COMMON_DIR_ABS,
  GIT_DIR_ABS,
  type GitCheckoutRootAsyncProbes,
  type GitCheckoutRootProbes,
  hasGitPathSegment,
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

describe("git fixtures", () => {
  it("reports the expected probe triple for every state", () => {
    const R = fx.root;
    expect(probeTriple(fx.normal)).toEqual({
      gitDir: `${R}/normal/.git`,
      commonDir: `${R}/normal/.git`,
      topLevel: `${R}/normal`,
    });
    expect(probeTriple(fx.normalSubdir)).toEqual({
      gitDir: `${R}/normal/.git`,
      commonDir: `${R}/normal/.git`,
      topLevel: `${R}/normal`,
    });
    expect(probeTriple(fx.worktree)).toEqual({
      gitDir: `${R}/normal/.git/worktrees/normal-wt`,
      commonDir: `${R}/normal/.git`,
      topLevel: `${R}/normal-wt`,
    });
    expect(probeTriple(fx.submodule)).toEqual({
      gitDir: `${R}/super/.git/modules/models/sub`,
      commonDir: `${R}/super/.git/modules/models/sub`,
      topLevel: `${R}/super/models/sub`,
    });
    expect(probeTriple(fx.submoduleWorktree)).toEqual({
      gitDir: `${R}/super/.git/modules/models/sub/worktrees/sub-wt`,
      commonDir: `${R}/super/.git/modules/models/sub`,
      topLevel: `${R}/sub-wt`,
    });
    expect(probeTriple(fx.bare)).toEqual({
      gitDir: `${R}/barehub.git`,
      commonDir: `${R}/barehub.git`,
      topLevel: null,
    });
    expect(probeTriple(fx.bareWorktree)).toEqual({
      gitDir: `${R}/barehub.git/worktrees/bare-wt`,
      commonDir: `${R}/barehub.git`,
      topLevel: `${R}/bare-wt`,
    });
    expect(probeTriple(fx.separateGitDir)).toEqual({
      gitDir: `${R}/elsewhere.git`,
      commonDir: `${R}/elsewhere.git`,
      topLevel: `${R}/sepco`,
    });
    expect(probeTriple(fx.dotGitNamedCheckout)).toEqual({
      gitDir: `${R}/app.git/.git`,
      commonDir: `${R}/app.git/.git`,
      topLevel: `${R}/app.git`,
    });
    expect(probeTriple(fx.nonRepo)).toEqual({ gitDir: null, commonDir: null, topLevel: null });
  });
});

// ── E1–E8 — the state matrix over real repos ───────────────────────────────

describe("checkoutRoots over real repositories", () => {
  it("E1: a normal checkout resolves to itself", () => {
    expect(checkoutRoots({ cwd: fx.normal })).toEqual({
      thisCheckout: fx.normal,
      isLinkedWorktree: false,
      mainCheckout: fx.normal,
      commonDir: path.join(fx.normal, ".git"),
    });
  });

  it("E2: a linked worktree reports its own root and the main checkout", () => {
    expect(checkoutRoots({ cwd: fx.worktree })).toEqual({
      thisCheckout: fx.worktree,
      isLinkedWorktree: true,
      mainCheckout: fx.normal,
      commonDir: path.join(fx.normal, ".git"),
    });
  });

  it("E3: a submodule is NOT a linked worktree and owns its checkout", () => {
    const roots = checkoutRoots({ cwd: fx.submodule });
    expect(roots).toEqual({
      thisCheckout: fx.submodule,
      isLinkedWorktree: false,
      mainCheckout: fx.submodule,
      commonDir: path.join(fx.superproject, ".git", "modules", "models", "sub"),
    });
    expect(hasGitPathSegment(roots!.thisCheckout!)).toBe(false);
    expect(hasGitPathSegment(roots!.mainCheckout!)).toBe(false);
  });

  it("E4: a worktree of a submodule resolves to the submodule checkout", () => {
    const roots = checkoutRoots({ cwd: fx.submoduleWorktree });
    expect(roots).toEqual({
      thisCheckout: fx.submoduleWorktree,
      isLinkedWorktree: true,
      mainCheckout: fx.submodule,
      commonDir: path.join(fx.superproject, ".git", "modules", "models", "sub"),
    });
    expect(roots!.mainCheckout).not.toBe(path.join(fx.superproject, ".git", "modules", "models"));
  });

  it("E5: a worktree of a bare hub has no main checkout", () => {
    expect(checkoutRoots({ cwd: fx.bareWorktree })).toEqual({
      thisCheckout: fx.bareWorktree,
      isLinkedWorktree: true,
      mainCheckout: null,
      commonDir: fx.bare,
    });
  });

  it("E5b: a worktree of a BARE hub named `.git` has no main checkout", () => {
    // The basename rule alone would name `<parent>` as the main checkout of a
    // hub that owns no checkout at all — an anchor an authorization consumer
    // would then match against the known-folder set. `core.bare` disambiguates.
    const parent = path.join(fx.root, "hubparent");
    fixtureGit(fx.root, ["clone", "--bare", "-q", fx.normal, path.join(parent, ".git")]);
    const wt = path.join(fx.root, "dotgit-hub-wt");
    fixtureGit(path.join(parent, ".git"), ["worktree", "add", "-q", "-b", "dotgitwt", wt]);

    const roots = checkoutRoots({ cwd: wt })!;
    expect(roots.isLinkedWorktree).toBe(true);
    expect(roots.thisCheckout).toBe(wt);
    expect(roots.mainCheckout).toBeNull();
  });

  it("E5e: an UNSET core.bare is not-bare (git's boolean default), and resolves", () => {
    // Unset is a SUCCESSFUL read of git's default, not a failure to read — so it
    // must take the fallback, unlike the "unknown" case in E5d.
    const repo = path.join(fx.root, "unset-bare");
    fixtureGit(fx.root, ["clone", "-q", fx.normal, repo]);
    fixtureGit(repo, ["config", "--local", "--unset", "core.bare"]);
    // `config --get` EXITS 1 on an unset key, so the absence is asserted by the
    // throw, not by an empty string.
    expect(() => fixtureGit(repo, ["config", "--local", "--get", "core.bare"])).toThrow();
    const wt = path.join(fx.root, "unset-bare-wt");
    fixtureGit(repo, ["worktree", "add", "-q", "-b", "unsetwt", wt]);

    expect(checkoutRoots({ cwd: wt })!.mainCheckout).toBe(repo);
  });

  it("E5c: `core.bare = yes` counts as bare (git boolean, not the literal `true`)", () => {
    // git accepts yes/on/1/true as boolean-true. A raw text read compared to the
    // literal "true" would classify this hub as NOT bare and name its parent.
    const parent = path.join(fx.root, "yeshub");
    const hub = path.join(parent, ".git");
    fixtureGit(fx.root, ["clone", "--bare", "-q", fx.normal, hub]);
    fixtureGit(hub, ["config", "--local", "core.bare", "yes"]);
    const wt = path.join(fx.root, "yes-hub-wt");
    fixtureGit(hub, ["worktree", "add", "-q", "-b", "yeswt", wt]);

    expect(checkoutRoots({ cwd: wt })!.mainCheckout).toBeNull();
  });

  it("E6: a bare repository yields a RESULT with both roots null", () => {
    const roots = checkoutRoots({ cwd: fx.bare });
    expect(roots).not.toBeNull();
    expect(roots).toEqual({ thisCheckout: null, isLinkedWorktree: false, mainCheckout: null, commonDir: fx.bare });
  });

  it("E7: a --separate-git-dir checkout is not a worktree and is its own root", () => {
    const roots = checkoutRoots({ cwd: fx.separateGitDir });
    expect(roots).toEqual({
      thisCheckout: fx.separateGitDir,
      isLinkedWorktree: false,
      mainCheckout: fx.separateGitDir,
      commonDir: fx.separateGitDirGitDir,
    });
    // Never the directory that merely contains the git dir.
    expect(roots!.mainCheckout).not.toBe(path.dirname(fx.separateGitDirGitDir));
  });

  it("E8: a deep subdirectory resolves to its containing checkout", () => {
    expect(checkoutRoots({ cwd: fx.normalSubdir })).toEqual(checkoutRoots({ cwd: fx.normal }));
  });

  it("X1: a non-repo cwd yields no result", () => {
    expect(checkoutRoots({ cwd: fx.nonRepo })).toBeNull();
  });

  it("E11: a checkout at app.git carries no .git path segment", () => {
    const roots = checkoutRoots({ cwd: fx.dotGitNamedCheckout });
    expect(roots!.mainCheckout).toBe(fx.dotGitNamedCheckout);
    expect(hasGitPathSegment(roots!.mainCheckout!)).toBe(false);
    expect(hasGitPathSegment(path.join(fx.superproject, ".git", "modules"))).toBe(true);
  });

  it("E12: a globally-configured core.worktree is not consulted", () => {
    const cfgDir = mkdtempSync(path.join(tmpdir(), "gitroots-cfg-"));
    const cfg = path.join(cfgDir, "gitconfig");
    writeFileSync(cfg, "[core]\n\tworktree = /POISONED\n");
    const prev = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = cfg;
    try {
      // Sanity: a MERGED read does return the global value, which is exactly
      // why the resolver must issue a `--local` read.
      const merged = execFileSync(
        "git",
        ["--git-dir", path.join(fx.normal, ".git"), "config", "--get", "core.worktree"],
        { encoding: "utf8", env: { ...process.env, GIT_CONFIG_SYSTEM: "/dev/null" } },
      ).trim();
      expect(merged).toBe("/POISONED");

      expect(checkoutRoots({ cwd: fx.worktree })!.mainCheckout).toBe(fx.normal);
    } finally {
      restoreEnv("GIT_CONFIG_GLOBAL", prev);
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });

  it("X4: the core.worktree probe is argv-based (spaces read, metacharacters inert)", () => {
    const spaced = path.join(fx.root, "sp ace repo");
    fixtureGit(fx.root, ["clone", "-q", fx.normal, spaced]);
    const spacedWt = path.join(fx.root, "sp ace wt");
    fixtureGit(spaced, ["worktree", "add", "-q", "-b", "spwt", spacedWt]);
    // A space in the git-dir path would split argv under a shell string and the
    // probe would read as unset; argv form reads the repo correctly.
    expect(checkoutRoots({ cwd: spacedWt })!.mainCheckout).toBe(spaced);

    const canary = path.join(fx.root, "canary.txt");
    const evil = path.join(fx.root, `evil; touch ${canary}`);
    fixtureGit(fx.root, ["clone", "-q", fx.normal, evil]);
    const evilWt = path.join(fx.root, "evil-wt");
    fixtureGit(evil, ["worktree", "add", "-q", "-b", "evilwt", evilWt]);
    expect(checkoutRoots({ cwd: evilWt })!.mainCheckout).toBe(evil);
    // `existsSync`, not a spawned `test` binary: a lookup failure (ENOENT) would
    // satisfy `.toThrow()` without ever having looked at the canary.
    expect(existsSync(canary)).toBe(false);
  });
});

// ── E9, E10, E13, X2, X3 — injected probes ─────────────────────────────────

describe("resolveCheckoutRootsFrom", () => {
  // E9 has TWO halves, and only the second is about the resolver.
  //
  // The resolver does NOT absolutize a relative probe — canonicalization is the
  // RECIPES' job (`--path-format=absolute`), which is exactly why the probe
  // form is part of the contract rather than a per-call-site choice. So the
  // guarantee is pinned at its real source (the argv) and at its consequence
  // (equal absolute forms classify as non-worktree), not by feeding the
  // resolver a relative path it was never promised to repair.
  it("E9a: both required probes request absolute paths, so the forms cannot diverge", () => {
    expect(GIT_DIR_ABS.argv({ cwd: "/repo" })).toEqual([
      "git",
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
    ]);
    expect(GIT_COMMON_DIR_ABS.argv({ cwd: "/repo" })).toEqual([
      "git",
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
  });

  it("E9b: identical absolute probe forms are not misclassified as a worktree", () => {
    const roots = resolveCheckoutRootsFrom(
      stubProbes({
        gitDir: () => "/repo/.git",
        commonDir: () => "/repo/.git",
        topLevel: () => "/repo",
      }),
      "linux",
    );
    expect(roots).toEqual({ thisCheckout: "/repo", isLinkedWorktree: false, mainCheckout: "/repo", commonDir: "/repo/.git" });
  });

  it("E10: a trailing separator does not change the classification", () => {
    const withSep = resolveCheckoutRootsFrom(
      stubProbes({ gitDir: () => "/repo/.git/", commonDir: () => "/repo/.git", topLevel: () => "/repo/" }),
      "linux",
    );
    const without = resolveCheckoutRootsFrom(
      stubProbes({ gitDir: () => "/repo/.git", commonDir: () => "/repo/.git", topLevel: () => "/repo" }),
      "linux",
    );
    expect(withSep).toEqual(without);
    expect(withSep!.isLinkedWorktree).toBe(false);
  });

  it("E5d: an UNANSWERABLE bareness probe does not take the parent fallback", () => {
    // A timed-out / failed probe is "unknown", never "not-bare": collapsing the
    // two would let a slow git re-open the exact fallback the check closes.
    const roots = resolveCheckoutRootsFrom(
      stubProbes({
        gitDir: () => "/work/repo/.git/worktrees/wt",
        commonDir: () => "/work/repo/.git",
        topLevel: () => "/work/wt",
        localCoreBare: () => "unknown",
      }),
    );
    expect(roots).toEqual({ thisCheckout: "/work/wt", isLinkedWorktree: true, mainCheckout: null, commonDir: "/work/repo/.git" });

    // Control: the SAME shape with a confirmed non-bare answer does resolve.
    const ok = resolveCheckoutRootsFrom(
      stubProbes({
        gitDir: () => "/work/repo/.git/worktrees/wt",
        commonDir: () => "/work/repo/.git",
        topLevel: () => "/work/wt",
        localCoreBare: () => "not-bare",
      }),
    );
    expect(ok!.mainCheckout).toBe("/work/repo");
  });

  it("E13: an implausible core.worktree is returned verbatim", () => {
    const roots = resolveCheckoutRootsFrom(
      stubProbes({
        gitDir: () => "/repo/.git/worktrees/wt",
        commonDir: () => "/repo/.git",
        topLevel: () => "/wt",
        localCoreWorktree: () => "/repo/.git/modules/bogus",
      }),
      "linux",
    );
    expect(roots!.mainCheckout).toBe("/repo/.git/modules/bogus");
    expect(roots!.mainCheckout).not.toBeNull();
    expect(roots!.mainCheckout).not.toBe("/wt");
    expect(roots!.mainCheckout).not.toBe("/repo");
  });

  it("X1: a failed required probe yields no result and derives nothing", () => {
    expect(
      resolveCheckoutRootsFrom(stubProbes({ commonDir: () => "/repo/.git", topLevel: () => "/repo" }), "linux"),
    ).toBeNull();
    expect(
      resolveCheckoutRootsFrom(stubProbes({ gitDir: () => "/repo/.git", topLevel: () => "/repo" }), "linux"),
    ).toBeNull();
  });

  it("X2: a failing --show-toplevel still yields a result (bare stays a repo)", () => {
    const roots = resolveCheckoutRootsFrom(
      stubProbes({ gitDir: () => "/hub.git", commonDir: () => "/hub.git" }),
      "linux",
    );
    expect(roots).toEqual({ thisCheckout: null, isLinkedWorktree: false, mainCheckout: null, commonDir: "/hub.git" });
  });

  it("X3: a probe that throws (timeout) yields no result rather than throwing", () => {
    const boom = () => {
      throw new Error("timeout");
    };
    // A throw would fail this test outright, which is the assertion: the
    // caller degrades to "no result" rather than propagating the timeout.
    expect(resolveCheckoutRootsFrom(stubProbes({ gitDir: boom, commonDir: () => "/r/.git" }), "linux")).toBeNull();
  });

  it("a worktree whose common dir is not named .git and has no core.worktree has no main checkout", () => {
    const roots = resolveCheckoutRootsFrom(
      stubProbes({ gitDir: () => "/hub.git/worktrees/wt", commonDir: () => "/hub.git", topLevel: () => "/wt" }),
      "linux",
    );
    expect(roots).toEqual({ thisCheckout: "/wt", isLinkedWorktree: true, mainCheckout: null, commonDir: "/hub.git" });
  });
});

describe("hasGitPathSegment", () => {
  it("matches whole components only", () => {
    expect(hasGitPathSegment("/super/.git/modules/models", "linux")).toBe(true);
    expect(hasGitPathSegment("/work/app.git", "linux")).toBe(false);
    expect(hasGitPathSegment("/work/.github/x", "linux")).toBe(false);
    expect(hasGitPathSegment("/work/repo", "linux")).toBe(false);
  });
});

// ── Fault injection: a slow / absent `git` on PATH ─────────────────────────
//
// `checkoutRoots`/`checkoutRootsAsync` forward only `timeout` to the runner, so
// a probe timeout cannot be injected through the API. The only lever is the
// binary itself — see `test-support/git-shim.ts`.

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
    expect(unknownBare).toEqual({
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
