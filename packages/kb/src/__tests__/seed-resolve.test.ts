// findMainCheckout (git-checkout-root-resolution, local copy) and config validation.
// See change: add-kb-worktree-seed (test-plan E14, E15, E20).
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, validateConfig } from "../config.js";
import { findMainCheckout } from "../seed.js";
import { addWorktree, mkMain, sh, useSeedTree, writeFile } from "./helpers/seed-fixture.js";

const t = useSeedTree();

/** PATH-prefixed git shim: `SHIM=worktree` fails the core.worktree read (exit 128);
 *  `SHIM=bare` hangs the core.bare read past the 2 s probe timeout. */
function installShim(): () => void {
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const dir = join(t.tmp, "shim");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "git"),
    `#!/bin/sh
case "$*" in *core.worktree*) [ "$SHIM" = worktree ] && exit 128;; esac
case "$*" in *core.bare*) [ "$SHIM" = bare ] && exec sleep 5;; esac
exec ${real} "$@"
`,
  );
  chmodSync(join(dir, "git"), 0o755);
  const prev = process.env.PATH;
  process.env.PATH = `${dir}:${prev}`;
  return () => {
    process.env.PATH = prev;
    delete process.env.SHIM;
  };
}

describe("findMainCheckout", () => {
  it("resolves the main checkout from a linked worktree; a main checkout and a non-git dir are not worktrees", () => {
    mkMain(t);
    const wt = addWorktree(t);
    expect(findMainCheckout(wt)).toEqual({ status: "ok", main: t.main, toplevel: wt });
    expect(findMainCheckout(t.main)).toEqual({ status: "not-a-worktree" });
    expect(findMainCheckout(t.tmp)).toEqual({ status: "not-a-worktree" });
  });

  it("E14 repo-local core.worktree names the main checkout; a failing probe means none (no .git-parent fallback)", () => {
    // A submodule-like layout: separate git dir (NOT named .git), worktree elsewhere via core.worktree.
    const alt = join(t.tmp, "alt");
    const gitdir = join(t.tmp, "gitdir");
    mkdirSync(alt, { recursive: true });
    sh(t.tmp, "init", "-q", "-b", "main", `--separate-git-dir=${gitdir}`, alt);
    sh(alt, "config", "--file", join(gitdir, "config"), "core.worktree", alt);
    writeFile(alt, "a.md", "x");
    sh(alt, "add", "-A");
    sh(alt, "commit", "-q", "-m", "i");
    const wt = join(t.tmp, "w");
    sh(alt, "worktree", "add", "-q", "-b", "w", wt);
    expect(findMainCheckout(wt)).toEqual({ status: "ok", main: realpathSync(alt), toplevel: wt });

    const restore = installShim();
    try {
      process.env.SHIM = "worktree";
      expect(findMainCheckout(wt)).toEqual({ status: "no-main-checkout" });
    } finally {
      restore();
    }
  });

  it("E15 core.bare unset / false → the .git parent; yes / unanswerable → none", () => {
    mkMain(t);
    const wt = addWorktree(t);
    const cfg = join(t.main, ".git", "config");
    sh(t.main, "config", "--file", cfg, "--unset", "core.bare");
    expect(findMainCheckout(wt)).toMatchObject({ status: "ok", main: t.main });
    sh(t.main, "config", "--file", cfg, "core.bare", "false");
    expect(findMainCheckout(wt)).toMatchObject({ status: "ok", main: t.main });
    sh(t.main, "config", "--file", cfg, "core.bare", "yes");
    expect(findMainCheckout(wt)).toEqual({ status: "no-main-checkout" });
    sh(t.main, "config", "--file", cfg, "core.bare", "false");
    const restore = installShim();
    try {
      process.env.SHIM = "bare";
      expect(findMainCheckout(wt)).toEqual({ status: "no-main-checkout" });
    } finally {
      restore();
    }
  }, 30_000);
});

describe("seedFromMainWorktree config", () => {
  it("defaults to true and accepts a boolean", () => {
    expect(validateConfig({}).seedFromMainWorktree).toBe(true);
    expect(validateConfig({ seedFromMainWorktree: false }).seedFromMainWorktree).toBe(false);
  });

  it("E20 a non-boolean value throws an error naming the key", () => {
    const dir = join(t.tmp, "proj");
    writeFile(dir, ".pi/dashboard/knowledge_base.json", JSON.stringify({ seedFromMainWorktree: "yes" }));
    expect(() => loadConfig(dir)).toThrow(/seedFromMainWorktree/);
    expect(() => validateConfig({ seedFromMainWorktree: "yes" as unknown as boolean })).toThrow(/seedFromMainWorktree/);
  });
});
