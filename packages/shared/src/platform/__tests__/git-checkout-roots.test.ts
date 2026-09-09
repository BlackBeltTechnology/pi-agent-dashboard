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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildGitFixtures,
  fixtureGit,
  type GitFixtures,
  probeTriple,
  restoreEnv,
} from "../../test-support/git-fixtures.js";
import {
  checkoutRoots,
  GIT_COMMON_DIR_ABS,
  GIT_DIR_ABS,
  type GitCheckoutRootProbes,
  hasGitPathSegment,
  resolveCheckoutRootsFrom,
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
    });
  });

  it("E2: a linked worktree reports its own root and the main checkout", () => {
    expect(checkoutRoots({ cwd: fx.worktree })).toEqual({
      thisCheckout: fx.worktree,
      isLinkedWorktree: true,
      mainCheckout: fx.normal,
    });
  });

  it("E3: a submodule is NOT a linked worktree and owns its checkout", () => {
    const roots = checkoutRoots({ cwd: fx.submodule });
    expect(roots).toEqual({
      thisCheckout: fx.submodule,
      isLinkedWorktree: false,
      mainCheckout: fx.submodule,
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
    });
    expect(roots!.mainCheckout).not.toBe(path.join(fx.superproject, ".git", "modules", "models"));
  });

  it("E5: a worktree of a bare hub has no main checkout", () => {
    expect(checkoutRoots({ cwd: fx.bareWorktree })).toEqual({
      thisCheckout: fx.bareWorktree,
      isLinkedWorktree: true,
      mainCheckout: null,
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
    expect(roots).toEqual({ thisCheckout: null, isLinkedWorktree: false, mainCheckout: null });
  });

  it("E7: a --separate-git-dir checkout is not a worktree and is its own root", () => {
    const roots = checkoutRoots({ cwd: fx.separateGitDir });
    expect(roots).toEqual({
      thisCheckout: fx.separateGitDir,
      isLinkedWorktree: false,
      mainCheckout: fx.separateGitDir,
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
    expect(roots).toEqual({ thisCheckout: "/repo", isLinkedWorktree: false, mainCheckout: "/repo" });
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
    expect(roots).toEqual({ thisCheckout: "/work/wt", isLinkedWorktree: true, mainCheckout: null });

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
    expect(roots).toEqual({ thisCheckout: null, isLinkedWorktree: false, mainCheckout: null });
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
    expect(roots).toEqual({ thisCheckout: "/wt", isLinkedWorktree: true, mainCheckout: null });
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
