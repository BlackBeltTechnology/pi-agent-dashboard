/**
 * Tests for packages/shared/src/platform/git.ts — Recipe argv shapes +
 * light integration tests against the actual repository.
 *
 * The argv-shape tests are pure: they verify the Recipe's `argv()`
 * function produces the expected command without spawning anything.
 *
 * The integration tests use the actual repo as a git fixture; they're
 * smoke tests that the full recipe → runner → git pipeline works.
 *
 * See change: platform-command-executor.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import url from "node:url";
import {
  GIT_DIFF,
  GIT_STATUS_PORCELAIN,
  GIT_IS_REPO,
  GIT_CURRENT_BRANCH,
  GIT_HEAD_SHA,
  GIT_REMOTE_URL,
  GH_PR_NUMBER,
  GIT_RECIPES,
  isGitRepo,
  currentBranch,
  headSha,
  remoteUrl,
  diff,
  statusPorcelain,
  isGitRepoOr,
  currentBranchOr,
} from "../platform/git.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");

// ── Pure argv tests ─────────────────────────────────────────────────────────

describe("GIT_DIFF.argv", () => {
  it("produces `git diff HEAD -- <path>` by default", () => {
    expect(GIT_DIFF.argv({ cwd: "/tmp", path: "src/foo.ts" })).toEqual([
      "git", "diff", "HEAD", "--", "src/foo.ts",
    ]);
  });

  it("respects an explicit ref", () => {
    expect(GIT_DIFF.argv({ cwd: "/tmp", path: "a.ts", ref: "main" })).toEqual([
      "git", "diff", "main", "--", "a.ts",
    ]);
  });

  it("does not shell-escape the path (argv array is passed verbatim)", () => {
    // With argv arrays, paths like "a b.ts" flow through as one element.
    // No JSON.stringify, no quoting — safe by construction.
    expect(GIT_DIFF.argv({ cwd: "/tmp", path: "a b.ts" })).toEqual([
      "git", "diff", "HEAD", "--", "a b.ts",
    ]);
  });

  it("tolerates exit code 1 (no-diff or empty repo)", () => {
    expect(GIT_DIFF.tolerate).toContain(1);
  });
});

describe("GIT_STATUS_PORCELAIN.argv", () => {
  it("omits `--` when no path is given", () => {
    expect(GIT_STATUS_PORCELAIN.argv({ cwd: "/tmp" })).toEqual([
      "git", "status", "--porcelain",
    ]);
  });

  it("adds `-- <path>` when a path is given", () => {
    expect(GIT_STATUS_PORCELAIN.argv({ cwd: "/tmp", path: "src/foo.ts" })).toEqual([
      "git", "status", "--porcelain", "--", "src/foo.ts",
    ]);
  });
});

describe("other recipe argv shapes", () => {
  it("GIT_IS_REPO", () => {
    expect(GIT_IS_REPO.argv({ cwd: "/tmp" })).toEqual(["git", "rev-parse", "--is-inside-work-tree"]);
  });

  it("GIT_CURRENT_BRANCH", () => {
    expect(GIT_CURRENT_BRANCH.argv({ cwd: "/tmp" })).toEqual(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
  });

  it("GIT_HEAD_SHA (full)", () => {
    expect(GIT_HEAD_SHA.argv({ cwd: "/tmp" })).toEqual(["git", "rev-parse", "HEAD"]);
  });

  it("GIT_HEAD_SHA (short)", () => {
    expect(GIT_HEAD_SHA.argv({ cwd: "/tmp", short: true })).toEqual(["git", "rev-parse", "--short", "HEAD"]);
  });

  it("GIT_REMOTE_URL (default origin)", () => {
    expect(GIT_REMOTE_URL.argv({ cwd: "/tmp" })).toEqual(["git", "remote", "get-url", "origin"]);
  });

  it("GIT_REMOTE_URL (custom remote)", () => {
    expect(GIT_REMOTE_URL.argv({ cwd: "/tmp", remote: "upstream" })).toEqual([
      "git", "remote", "get-url", "upstream",
    ]);
  });

  it("GH_PR_NUMBER tolerates exit 1 (no PR)", () => {
    expect(GH_PR_NUMBER.tolerate).toContain(1);
    expect(GH_PR_NUMBER.argv({ cwd: "/tmp" })).toEqual([
      "gh", "pr", "view", "--json", "number", "-q", ".number",
    ]);
  });
});

describe("GIT_RECIPES registry", () => {
  it("enumerates all exported recipes", () => {
    const keys = Object.keys(GIT_RECIPES).sort();
    expect(keys).toEqual([
      "GH_PR_NUMBER",
      "GIT_COMMON_DIR",
      "GIT_CURRENT_BRANCH",
      "GIT_DIFF",
      "GIT_HEAD_SHA",
      "GIT_IS_REPO",
      "GIT_NUMSTAT",
      "GIT_REMOTE_URL",
      "GIT_STATUS_PORCELAIN",
      "GIT_TOPLEVEL",
    ]);
  });

  it("every recipe has argv and parse functions", () => {
    for (const [name, recipe] of Object.entries(GIT_RECIPES)) {
      expect(typeof recipe.argv, `${name}.argv`).toBe("function");
      expect(typeof recipe.parse, `${name}.parse`).toBe("function");
    }
  });
});

// ── Integration tests against the actual repository ────────────────────────

describe("git.* integration (runs against this repo)", () => {
  it("isGitRepo returns true for the repo root", () => {
    const result = isGitRepo({ cwd: REPO_ROOT });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(true);
  });

  it("isGitRepoOr returns false for a non-repo directory", () => {
    expect(isGitRepoOr({ cwd: require("node:os").tmpdir() })).toBe(false);
  });

  it("currentBranch returns a string for the repo", () => {
    const result = currentBranch({ cwd: REPO_ROOT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.value).toBe("string");
      expect(result.value!.length).toBeGreaterThan(0);
    }
  });

  it("headSha returns a 40-char SHA for the repo", () => {
    const result = headSha({ cwd: REPO_ROOT });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatch(/^[0-9a-f]{40}$/);
  });

  it("headSha short returns a 7-char SHA", () => {
    const result = headSha({ cwd: REPO_ROOT, short: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatch(/^[0-9a-f]{7}/);
  });

  it("remoteUrl returns a URL string if origin is set", () => {
    // This repo has an origin remote; the value is non-empty.
    const result = remoteUrl({ cwd: REPO_ROOT });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value?.length ?? 0).toBeGreaterThan(0);
  });

  it("statusPorcelain returns a string (possibly empty)", () => {
    const result = statusPorcelain({ cwd: REPO_ROOT });
    expect(result.ok).toBe(true);
    if (result.ok) expect(typeof result.value).toBe("string");
  });

  it("diff with exit-1 tolerance does not throw for a clean path", () => {
    // Pick a file guaranteed to exist and typically be unchanged in test runs.
    const result = diff({ cwd: REPO_ROOT, path: "package.json" });
    // tolerate: [1] means no diff is still ok
    expect(result.ok).toBe(true);
  });

  it("currentBranchOr returns a fallback when cwd is not a repo", () => {
    expect(currentBranchOr({ cwd: require("node:os").tmpdir() }, "no-repo")).toBe("no-repo");
  });
});
