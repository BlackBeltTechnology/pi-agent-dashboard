/**
 * Canonical-probe-wiring assertion for `detectWorktree`.
 *
 * Deliberately does NOT mock `platform/git.js`: the sibling `vcs-info.test.ts`
 * injects resolver verdicts, and an injected verdict cannot catch a MIS-WIRED
 * probe. If `detectWorktree` ever assembled its own probes and dropped
 * `--path-format=absolute` on one side, every normal checkout would report as a
 * linked worktree — and only a real repository shows that.
 *
 * See change: add-git-checkout-root-resolver.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGitFixtures, type GitFixtures } from "@blackbelt-technology/pi-dashboard-shared/test-support/git-fixtures.js";
import { detectWorktree } from "../vcs-info.js";

let fx: GitFixtures;
const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };

beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_SYSTEM = "/dev/null";
  fx = buildGitFixtures();
});

afterAll(() => {
  fx.cleanup();
  process.env.GIT_CONFIG_GLOBAL = saved.global;
  process.env.GIT_CONFIG_SYSTEM = saved.system;
});

describe("detectWorktree against real repositories", () => {
  it("reports no worktree for an ordinary checkout root", () => {
    expect(detectWorktree(fx.normal)).toBeUndefined();
  });

  it("reports no worktree for a subdirectory of an ordinary checkout", () => {
    expect(detectWorktree(fx.normalSubdir)).toBeUndefined();
  });

  it("reports the main checkout for a linked worktree", () => {
    expect(detectWorktree(fx.worktree)).toEqual({ mainPath: fx.normal, name: "normal-wt" });
  });

  it("reports NO worktree for a submodule, and never a .git/modules mainPath", () => {
    expect(detectWorktree(fx.submodule)).toBeUndefined();
  });

  it("reports the submodule checkout for a worktree of a submodule", () => {
    expect(detectWorktree(fx.submoduleWorktree)).toEqual({ mainPath: fx.submodule, name: "sub-wt" });
  });

  it("reports no worktree for a worktree of a bare hub", () => {
    expect(detectWorktree(fx.bareWorktree)).toBeUndefined();
  });

  it("reports no worktree for a --separate-git-dir checkout or a bare repo", () => {
    expect(detectWorktree(fx.separateGitDir)).toBeUndefined();
    expect(detectWorktree(fx.bare)).toBeUndefined();
  });

  it("reports no worktree outside any repository", () => {
    expect(detectWorktree(fx.nonRepo)).toBeUndefined();
  });
});
