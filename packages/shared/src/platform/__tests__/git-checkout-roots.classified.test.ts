/**
 * Classified checkout-root resolution — a probe that did not COMPLETE is FAILED, never
 * "not a repository", and never falls through to a weaker rule. The unclassified resolvers
 * keep returning no result for both. Covers test-plan E1–E7 of harden-plugin-cwd-admission.
 * (Split from git-checkout-roots.test.ts after test-trust-audit's file split.)
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGitFixtures, type GitFixtures, restoreEnv } from "../../test-support/git-fixtures.js";
import { cleanupGitShims, useGitPath } from "../../test-support/git-shim.js";
import {
  bindCheckoutClassifiedAsync,
  checkoutRootsAsync,
  checkoutRootsClassifiedAsync,
  GIT_COMMON_DIR_ABS,
  GIT_CONFIG_LOCAL_CORE_BARE,
  GIT_CONFIG_LOCAL_CORE_WORKTREE,
  GIT_DIR_ABS,
  GIT_TOPLEVEL,
  type GitProbeRunner,
  isBoundCheckoutAsync,
  resolveCheckoutRootsFromAsync,
} from "../git.js";
import type { ExecError, Recipe, Result } from "../runner.js";

let fx: GitFixtures;
const savedEnv = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };

beforeAll(() => {
  // The resolver spawns git with the ambient env: keep a developer's own config out.
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

// ── harden-plugin-cwd-admission — classified resolution (E1–E7) ──────────────

type StubAnswer = string | undefined | ExecError;

/** Runner answering by recipe identity; anything unanswered is a definitive exit 128. */
function stubRunner(answers: {
  gitDir?: StubAnswer;
  commonDir?: StubAnswer;
  topLevel?: StubAnswer;
  worktree?: StubAnswer;
  bare?: StubAnswer;
}): { runner: GitProbeRunner; calls: string[] } {
  const calls: string[] = [];
  const pick = (name: string, a: StubAnswer | undefined): Result<never> => {
    calls.push(name);
    if (a === undefined) return { ok: true, value: undefined as never };
    if (typeof a === "string") return { ok: true, value: a as never };
    return { ok: false, error: a };
  };
  const exit128: ExecError = { kind: "exit", code: 128, signal: null, stdout: "", stderr: "" };
  const runner: GitProbeRunner = async <I, O>(recipe: Recipe<I, O>) => {
    if (recipe === (GIT_DIR_ABS as unknown)) return pick("git-dir", answers.gitDir ?? exit128) as Result<O>;
    if (recipe === (GIT_COMMON_DIR_ABS as unknown)) return pick("git-common-dir", answers.commonDir ?? exit128) as Result<O>;
    if (recipe === (GIT_TOPLEVEL as unknown)) return pick("show-toplevel", answers.topLevel ?? exit128) as Result<O>;
    if (recipe === (GIT_CONFIG_LOCAL_CORE_WORKTREE as unknown)) return pick("core.worktree", answers.worktree) as Result<O>;
    if (recipe === (GIT_CONFIG_LOCAL_CORE_BARE as unknown)) return pick("core.bare", answers.bare) as Result<O>;
    throw new Error("unexpected recipe");
  };
  return { runner, calls };
}

const TIMEOUT: ExecError = { kind: "timeout", timeoutMs: 1000, binary: "git" };
const EXIT128: ExecError = { kind: "exit", code: 128, signal: null, stdout: "", stderr: "" };

describe("classified checkout roots (harden-plugin-cwd-admission)", () => {
  it("E1: a definitive non-zero --git-dir exit is no-result, not FAILED", async () => {
    const { runner } = stubRunner({ gitDir: EXIT128, commonDir: EXIT128 });
    expect(await checkoutRootsClassifiedAsync({ cwd: "/x" }, { runner })).toEqual({ kind: "none" });
  });

  it("E2: a timed-out --git-common-dir is FAILED; the unclassified resolver still says null", async () => {
    const answers = { gitDir: "/r/.git", commonDir: TIMEOUT, topLevel: "/r" } as const;
    const { runner } = stubRunner(answers);
    expect(await checkoutRootsClassifiedAsync({ cwd: "/r" }, { runner })).toEqual({
      kind: "failed",
      failedProbes: ["git-common-dir"],
    });
    const unclassified = await resolveCheckoutRootsFromAsync({
      gitDir: async () => "/r/.git",
      commonDir: async () => undefined, // what `unwrap(timeout, undefined)` yields
      topLevel: async () => "/r",
      localCoreWorktree: async () => undefined,
      localCoreBare: async () => "unknown",
    });
    expect(unclassified).toBeNull();
  });

  it("E3: bare repo — failing --show-toplevel exit is thisCheckout=null, not FAILED", async () => {
    const { runner } = stubRunner({ gitDir: "/hub.git", commonDir: "/hub.git", topLevel: EXIT128 });
    const r = await checkoutRootsClassifiedAsync({ cwd: "/hub.git" }, { runner });
    expect(r.kind).toBe("roots");
    if (r.kind === "roots") {
      expect(r.roots.thisCheckout).toBeNull();
      expect(r.roots.mainCheckout).toBeNull();
    }
  });

  it("a timed-out --show-toplevel is FAILED (only an exit means bare)", async () => {
    const { runner } = stubRunner({ gitDir: "/hub.git", commonDir: "/hub.git", topLevel: TIMEOUT });
    expect(await checkoutRootsClassifiedAsync({ cwd: "/hub.git" }, { runner })).toEqual({
      kind: "failed",
      failedProbes: ["show-toplevel"],
    });
  });

  it("E4: core.bare exiting 128 is FAILED and never reaches the dirname(commonDir) rule", async () => {
    const { runner } = stubRunner({
      gitDir: "/r/.git/worktrees/w",
      commonDir: "/r/.git",
      topLevel: "/r/.worktrees/w",
      bare: EXIT128,
    });
    const r = await checkoutRootsClassifiedAsync({ cwd: "/r/.worktrees/w" }, { runner });
    expect(r).toEqual({ kind: "failed", failedProbes: ["config core.bare"] });
  });

  it("E5: core.worktree timing out is FAILED; mainCheckout never becomes the common-dir parent", async () => {
    const { runner, calls } = stubRunner({
      gitDir: "/r/.git/worktrees/w",
      commonDir: "/r/.git",
      topLevel: "/r/.worktrees/w",
      worktree: TIMEOUT,
      bare: "false",
    });
    const r = await checkoutRootsClassifiedAsync({ cwd: "/r/.worktrees/w" }, { runner });
    expect(r).toEqual({ kind: "failed", failedProbes: ["config core.worktree"] });
    // The failed read decides the outcome — no further config spawn is spent.
    expect(calls).not.toContain("core.bare");
  });

  it("an unset core.worktree (tolerated exit 1 → ok(undefined)) is still an answer", async () => {
    const { runner } = stubRunner({
      gitDir: "/r/.git/worktrees/w",
      commonDir: "/r/.git",
      topLevel: "/r/.worktrees/w",
      bare: "false",
    });
    const r = await checkoutRootsClassifiedAsync({ cwd: "/r/.worktrees/w" }, { runner });
    expect(r.kind).toBe("roots");
    if (r.kind === "roots") expect(r.roots.mainCheckout).toBe("/r");
  });

  it("pairs onProbeStart/onProbeEnd for every probe, including injected runners", async () => {
    const { runner } = stubRunner({ gitDir: "/r/.git", commonDir: "/r/.git", topLevel: "/r" });
    let live = 0;
    let started = 0;
    await checkoutRootsClassifiedAsync(
      { cwd: "/r" },
      {
        runner,
        onProbeStart: () => {
          live++;
          started++;
        },
        onProbeEnd: () => {
          live--;
        },
      },
    );
    expect(started).toBe(3);
    expect(live).toBe(0);
  });

  it("E6: binding twin reports failed when the re-resolution times out; the boolean twin says false", async () => {
    const cand = realpathSync(fx.normal);
    const commonDir = path.join(cand, ".git");
    const { runner } = stubRunner({ gitDir: path.join(cand, ".git"), commonDir: TIMEOUT, topLevel: cand });
    const r = await bindCheckoutClassifiedAsync(cand, commonDir, { runner });
    expect(r).toEqual({ kind: "failed", failedProbes: ["git-common-dir"] });
    // The unclassified twin cannot tell a timeout from "unbound": no git available.
    const restore = useGitPath(null);
    try {
      expect(await isBoundCheckoutAsync(cand, commonDir)).toBe(false);
    } finally {
      restore();
    }
  });

  it("binding twin: bound / unbound against real git", async () => {
    const cand = realpathSync(fx.normal);
    const commonDir = path.join(cand, ".git");
    expect(await bindCheckoutClassifiedAsync(cand, commonDir)).toEqual({ kind: "bound" });
    expect(await bindCheckoutClassifiedAsync(path.join(cand, "missing"), commonDir)).toEqual({ kind: "unbound" });
    expect(await bindCheckoutClassifiedAsync(path.join(cand, ".git"), commonDir)).toEqual({ kind: "unbound" });
  });

  it("real git: classified result equals the unclassified resolver for a linked worktree", async () => {
    const cwd = realpathSync(fx.worktree);
    const c = await checkoutRootsClassifiedAsync({ cwd });
    const u = await checkoutRootsAsync({ cwd });
    expect(c.kind).toBe("roots");
    if (c.kind === "roots") expect(c.roots).toEqual(u);
  });
});

