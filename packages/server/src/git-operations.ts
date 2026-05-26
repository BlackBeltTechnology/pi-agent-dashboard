/**
 * Server-side git operations — branch listing, checkout, init, stash,
 * worktree (head probe, list, create).
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import {
  ensureWorktreeExcludeLine,
  parsePorcelainWorktrees,
  slugifyBranch,
  type WorktreeEntry,
} from "./git-worktree.js";

const GIT_TIMEOUT = 15_000;

/** Run a git command, return trimmed stdout. Throws on failure. */
function run(command: string, cwd: string): string {
  return execSync(command, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: GIT_TIMEOUT,
  }).trim();
}

/** Run a git command, return trimmed stdout or undefined on failure. */
function tryRun(command: string, cwd: string): string | undefined {
  try {
    return run(command, cwd);
  } catch {
    return undefined;
  }
}

/** Check if cwd is inside a git work tree. */
export function isGitRepo(cwd: string): boolean {
  return tryRun("git rev-parse --is-inside-work-tree", cwd) === "true";
}

/** Get list of dirty files from git status --porcelain. */
export function getDirtyFiles(cwd: string): string[] {
  let output: string;
  try {
    output = execSync("git status --porcelain", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: GIT_TIMEOUT,
    });
  } catch {
    return [];
  }
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3)); // strip 2 status chars + space
}

export interface BranchInfo {
  current: string;
  detached: boolean;
  branches: Array<{ name: string; isRemote: boolean; isCurrent: boolean }>;
}

/** List all local and remote branches sorted by most recent commit. */
export function listBranches(cwd: string): BranchInfo {
  // Detect current branch / detached HEAD
  const headRef = tryRun("git rev-parse --abbrev-ref HEAD", cwd);

  // Empty repo (no commits yet)
  if (!headRef) {
    // Try to read the default branch name from HEAD
    const symbolic = tryRun("git symbolic-ref --short HEAD", cwd);
    return {
      current: symbolic ?? "main",
      detached: false,
      branches: [],
    };
  }
  const detached = headRef === "HEAD";
  const current = detached
    ? run("git rev-parse --short HEAD", cwd)
    : headRef;

  // List all branches with committer date sorting
  const format = "%(refname:short)%(HEAD)";
  const rawLocal = tryRun(
    `git branch --sort=-committerdate --format="${format}"`,
    cwd
  ) ?? "";
  const rawRemote = tryRun(
    `git branch -r --sort=-committerdate --format="${format}"`,
    cwd
  ) ?? "";

  const localBranches: BranchInfo["branches"] = [];
  for (const line of rawLocal.split("\n").filter(Boolean)) {
    const isCurrent = line.includes("*");
    const name = line.replace("*", "").trim();
    if (!name) continue;
    localBranches.push({ name, isRemote: false, isCurrent });
  }

  // Collect local branch names for dedup
  const localNames = new Set(localBranches.map((b) => b.name));

  const remoteBranches: BranchInfo["branches"] = [];
  for (const line of rawRemote.split("\n").filter(Boolean)) {
    const name = line.replace("*", "").trim();
    // Skip HEAD pointers like "origin/HEAD"
    if (name.endsWith("/HEAD")) continue;
    // Skip remote branches that have a local counterpart
    const localName = name.replace(/^[^/]+\//, ""); // "origin/foo" → "foo"
    if (localNames.has(localName)) continue;
    remoteBranches.push({ name, isRemote: true, isCurrent: false });
  }

  return {
    current,
    detached,
    branches: [...localBranches, ...remoteBranches],
  };
}

export interface CheckoutResult {
  success: true;
  stashed?: boolean;
}

export interface CheckoutDirty {
  success: false;
  dirty: true;
  files: string[];
}

/** Checkout a branch. Returns dirty info if working tree is dirty and stash=false. */
export function checkoutBranch(
  cwd: string,
  branch: string,
  stash: boolean
): CheckoutResult | CheckoutDirty {
  // Already on this branch?
  const headRef = tryRun("git rev-parse --abbrev-ref HEAD", cwd);
  if (headRef === branch) return { success: true };

  const dirtyFiles = getDirtyFiles(cwd);

  if (dirtyFiles.length > 0 && !stash) {
    return { success: false, dirty: true, files: dirtyFiles };
  }

  let stashed = false;
  if (dirtyFiles.length > 0 && stash) {
    run("git stash push -u -m \"pi-dashboard-auto-stash\"", cwd);
    stashed = true;
  }

  // Check if this is a remote branch that needs a local tracking branch
  const isRemote = branch.includes("/");
  if (isRemote) {
    const localName = branch.replace(/^[^/]+\//, "");
    // Check if local branch exists
    const localExists = tryRun(`git rev-parse --verify refs/heads/${localName}`, cwd);
    if (!localExists) {
      run(`git checkout -b ${localName} ${branch}`, cwd);
      return { success: true, stashed };
    }
    // Local branch exists, just checkout
    run(`git checkout ${localName}`, cwd);
    return { success: true, stashed };
  }

  run(`git checkout ${branch}`, cwd);
  return { success: true, stashed };
}

/** Initialize a git repository. Throws if already a git repo. */
export function gitInit(cwd: string): void {
  if (isGitRepo(cwd)) {
    throw new Error("already a git repository");
  }
  run("git init", cwd);
}

export interface StashPopResult {
  conflicts: boolean;
}

// ── Worktree operations ────────────────────────────────────────────────────────────────
// See change: add-worktree-spawn-dialog.

export interface HeadInfo {
  /** Current branch name, or `null` for detached HEAD. */
  branch: string | null;
  detached: boolean;
  /** Short HEAD SHA, or `null` when the repo is empty (no commits yet). */
  sha: string | null;
  /**
   * True iff `.gitmodules` exists at the repo's top level. Used by the
   * worktree dialog to surface a "submodules will not be initialized"
   * footnote. Cheap stat-only probe; never spawns git. Optional on the
   * wire to keep older clients happy.
   */
  hasSubmodules?: boolean;
}

/** Read HEAD state of a git repo. */
export function readHead(cwd: string): HeadInfo {
  // Detect detached HEAD via symbolic-ref --quiet (exits non-zero when detached).
  const symbolic = tryRun("git symbolic-ref --quiet --short HEAD", cwd);
  const sha = tryRun("git rev-parse --short HEAD", cwd) ?? null;
  // `.gitmodules` lives at the worktree's top level (or the main
  // checkout's). Use the worktree's own top level so the probe is correct
  // whether the dialog is opened from a sibling worktree or main.
  const topLevel = tryRun("git rev-parse --show-toplevel", cwd);
  const hasSubmodules = topLevel ? fs.existsSync(path.join(topLevel, ".gitmodules")) : false;
  if (symbolic) {
    return { branch: symbolic, detached: false, sha, hasSubmodules };
  }
  // No symbolic ref → either detached or empty repo.
  return {
    branch: null,
    detached: sha !== null,
    sha,
    hasSubmodules,
  };
}

/** List all worktrees of the repository containing `cwd`. */
export function listWorktrees(cwd: string): WorktreeEntry[] {
  const stdout = run("git worktree list --porcelain", cwd);
  return parsePorcelainWorktrees(stdout);
}

export type AddWorktreeError =
  | "not_a_repo"
  | "cwd_invalid"
  | "branch_in_use"
  | "branch_exists"
  | "path_exists"
  | "base_not_found"
  | "git_failed";

export interface AddWorktreeSuccess {
  ok: true;
  path: string;
  branch: string;
  /** True iff this call appended `.worktrees/` to `.git/info/exclude`. */
  excludeAppended: boolean;
}

export interface AddWorktreeFailure {
  ok: false;
  error: AddWorktreeError;
  message: string;
  stderr?: string;
}

export interface AddWorktreeOptions {
  /** Cwd inside the parent repo (any worktree's path resolves to the same parent). */
  cwd: string;
  /** Base ref to fork from (local or `origin/<x>`). */
  base: string;
  /** New branch name to create at the worktree's HEAD. */
  newBranch: string;
  /** Optional explicit path; derived from slug when absent. */
  path?: string;
  /** Pass `--force` to `git worktree add` (defaults to false). */
  force?: boolean;
}

/**
 * Create a new worktree. Pure orchestration over `git worktree add` plus
 * the `.git/info/exclude` housekeeping.
 *
 * Returns a discriminated union with stable error codes so the route
 * handler can map straight to HTTP status without re-parsing stderr.
 */
export function addWorktree(opts: AddWorktreeOptions): AddWorktreeSuccess | AddWorktreeFailure {
  const { cwd, base, newBranch, force } = opts;
  if (!isGitRepo(cwd)) {
    return { ok: false, error: "not_a_repo", message: "not a git repository" };
  }
  // Resolve to the parent repo root (works whether cwd is the main checkout
  // or any sibling worktree). `git rev-parse --show-toplevel` from a
  // worktree returns the worktree's own root, NOT the main repo. We want
  // the MAIN repo so `.worktrees/<slug>` lands consistently regardless of
  // which worktree opened the dialog. Read `--git-common-dir` and walk up.
  const commonDirRaw = tryRun("git rev-parse --git-common-dir", cwd);
  if (!commonDirRaw) {
    return { ok: false, error: "not_a_repo", message: "unable to resolve git common-dir" };
  }
  const commonDirAbs = path.isAbsolute(commonDirRaw)
    ? commonDirRaw
    : path.resolve(cwd, commonDirRaw);
  const repoRoot = path.dirname(commonDirAbs);

  // Derive worktree path when not supplied.
  let worktreePath = opts.path;
  if (!worktreePath) {
    const slug = slugifyBranch(newBranch);
    if (!slug) {
      return {
        ok: false,
        error: "git_failed",
        message: `cannot derive a filesystem-safe slug from branch name "${newBranch}"`,
      };
    }
    worktreePath = path.join(repoRoot, ".worktrees", slug);
  }

  // Pre-flight: path must not exist (or must be empty).
  if (fs.existsSync(worktreePath)) {
    const isEmpty = (() => {
      try { return fs.readdirSync(worktreePath).length === 0; } catch { return false; }
    })();
    if (!isEmpty) {
      return {
        ok: false,
        error: "path_exists",
        message: `target path already exists and is not empty: ${worktreePath}`,
      };
    }
  }

  // Run `git worktree add -b <newBranch> <path> <base>` (+ optional --force).
  // Args are quoted via single-shell-arg escaping below.
  const args = ["git", "worktree", "add"];
  if (force) args.push("--force");
  args.push("-b", newBranch, worktreePath, base);
  const cmd = args.map(shellEscape).join(" ");
  try {
    execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: GIT_TIMEOUT,
    });
  } catch (err: any) {
    const stderr = String(err?.stderr ?? err?.message ?? "");
    // Map common stderr patterns onto stable error codes. The exact
    // wording varies by git version; we match generously.
    if (/already used by worktree at|is already checked out at/i.test(stderr)) {
      return { ok: false, error: "branch_in_use", message: "branch is already checked out in another worktree", stderr };
    }
    if (/A branch named.*already exists|branch '.*' already exists/i.test(stderr)) {
      return { ok: false, error: "branch_exists", message: `branch "${newBranch}" already exists`, stderr };
    }
    if (/invalid reference|unknown revision|not a valid object name/i.test(stderr)) {
      return { ok: false, error: "base_not_found", message: `base ref not found: ${base}`, stderr };
    }
    if (/'.*' already exists/i.test(stderr)) {
      return { ok: false, error: "path_exists", message: `target path already exists: ${worktreePath}`, stderr };
    }
    return { ok: false, error: "git_failed", message: "git worktree add failed", stderr };
  }

  // Append `.worktrees/` to .git/info/exclude (idempotent). ONLY do this
  // when we derived the path — if the user supplied an explicit `path`
  // they're opting out of the convention.
  let excludeAppended = false;
  if (!opts.path) {
    const excludePath = path.join(commonDirAbs, "info", "exclude");
    try {
      const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf-8") : "";
      const result = ensureWorktreeExcludeLine(existing);
      if (result.appended) {
        fs.mkdirSync(path.dirname(excludePath), { recursive: true });
        fs.writeFileSync(excludePath, result.content);
        excludeAppended = true;
      }
    } catch (err) {
      // Non-fatal: the worktree is created; exclude write is housekeeping.
      console.error(`[git-worktree] failed to update .git/info/exclude:`, err);
    }
  }

  // Rewrite the new worktree's `.pi/settings.json` so any relative
  // `packages[].source` paths resolve against the MAIN repo root instead
  // of the worktree's own root. Without this, a worktree of an older
  // branch loads pi packages (e.g. the dashboard bridge) from its own
  // stale sibling directory — missing features that ship in the main
  // repo's `feature/...` branch. Best-effort, non-fatal.
  // See change: add-worktree-spawn-dialog.
  rewriteWorktreePiSettings(worktreePath, repoRoot);

  return { ok: true, path: worktreePath, branch: newBranch, excludeAppended };
}

/**
 * Rewrite `<worktreePath>/.pi/settings.json` so any relative
 * `packages[].source` becomes an absolute path against `mainRoot`.
 *
 * Idempotent and conservative:
 *   - If the file doesn't exist, do nothing (no template-fabrication).
 *   - If `packages` is absent or empty, do nothing.
 *   - Sources that are already absolute paths are left untouched.
 *   - Sources that look like URLs (`http://...`, `git+...`) or npm specs
 *     (no path separators / no `..`) are left untouched.
 *   - Only relative paths (`..`, `./...`, `../...`) are rewritten.
 *
 * Atomic write (write-to-tmp + rename).
 */
export function rewriteWorktreePiSettings(worktreePath: string, mainRoot: string): void {
  const settingsPath = path.join(worktreePath, ".pi", "settings.json");
  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, "utf-8");
  } catch {
    // No project settings in the worktree — nothing to rewrite.
    return;
  }
  let parsed: { packages?: Array<{ source?: string; [k: string]: unknown }>; [k: string]: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[git-worktree] worktree .pi/settings.json is malformed; skipping rewrite:`, err);
    return;
  }
  const packages = Array.isArray(parsed.packages) ? parsed.packages : [];
  if (packages.length === 0) return;
  let changed = false;
  for (const pkg of packages) {
    if (typeof pkg.source !== "string") continue;
    if (!isRelativePathSource(pkg.source)) continue;
    // Source resolves relative to the .pi directory by pi's convention
    // (i.e. `..` from `.pi/` is the project root). We want it to resolve
    // against the MAIN repo's `.pi/`, so we anchor against `<mainRoot>/.pi`.
    const anchorDir = path.join(mainRoot, ".pi");
    const absolute = path.resolve(anchorDir, pkg.source);
    pkg.source = absolute;
    changed = true;
  }
  if (!changed) return;
  try {
    const tmpPath = settingsPath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(parsed, null, 2) + "\n");
    fs.renameSync(tmpPath, settingsPath);
  } catch (err) {
    console.error(`[git-worktree] failed to write rewritten .pi/settings.json:`, err);
  }
}

/**
 * True when `source` is a relative filesystem path (`..`, `./...`,
 * `../...`, or a bare relative segment). Absolute paths, URLs, and npm
 * package specs are NOT considered relative.
 */
function isRelativePathSource(source: string): boolean {
  if (source.length === 0) return false;
  if (path.isAbsolute(source)) return false;
  // URL-like: http(s)://, git+ssh://, file://, ssh://, etc. Match any
  // scheme made of [a-z0-9+.-] followed by `://`.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) return false;
  // Scoped npm package: `@scope/name`. Stays untouched.
  if (/^@[^/\\]+\/[^/\\]+$/.test(source)) return false;
  if (source.startsWith(".") || source.startsWith("..")) return true;
  // A bare name (e.g. "foo") could be an npm package spec or a relative
  // directory. We conservatively treat path-separator-bearing names as
  // relative paths; pure single segments as npm.
  return source.includes("/") || source.includes("\\");
}

/**
 * Single-arg shell-escape helper. Sufficient for the path / branch /
 * base values we pass; we never interpolate user-controlled shell
 * fragments. Wraps in single quotes and escapes embedded single quotes.
 */
function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

// ── Worktree lifecycle (remove / merge / push / pr) ─────────────────────────
// See change: add-worktree-lifecycle-actions.

import {
  mapRemoveStderr,
  mapMergeStderr,
  mapPushStderr,
  mapPrStderr,
  parsePrUrl,
  parseShortstat,
  type RemoveCode,
  type MergeCode,
  type PushCode,
  type PrCode,
} from "./git-worktree-lifecycle.js";

export interface LifecycleSuccess<T = unknown> {
  ok: true;
  data?: T;
}
export interface LifecycleFailure<C extends string = string> {
  ok: false;
  code: C;
  stderr?: string;
}

/**
 * Resolve the main checkout (parent repo root) for any `cwd`. Returns
 * `null` when the cwd isn't a git work tree.
 */
function resolveMainPath(cwd: string): string | null {
  const commonDirRaw = tryRun("git rev-parse --git-common-dir", cwd);
  if (!commonDirRaw) return null;
  const commonDirAbs = path.isAbsolute(commonDirRaw)
    ? commonDirRaw
    : path.resolve(cwd, commonDirRaw);
  return path.dirname(commonDirAbs);
}

/**
 * `git worktree remove [--force] <cwd>` invoked from the parent repo.
 * Stderr is mapped to a stable code.
 */
export function removeWorktree(opts: {
  cwd: string;
  force?: boolean;
}): LifecycleSuccess<{ removed: true }> | LifecycleFailure<RemoveCode> {
  const { cwd, force } = opts;
  const mainPath = resolveMainPath(cwd);
  if (!mainPath) return { ok: false, code: "not_a_worktree" };
  const args = ["git", "worktree", "remove"];
  if (force) args.push("--force");
  args.push(cwd);
  try {
    execSync(args.map(shellEscape).join(" "), {
      cwd: mainPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: GIT_TIMEOUT,
    });
  } catch (err: any) {
    const stderr = String(err?.stderr ?? err?.message ?? "");
    return { ok: false, code: mapRemoveStderr(stderr), stderr };
  }
  return { ok: true, data: { removed: true } };
}

const BASE_FALLBACKS = ["develop", "main", "master"] as const;

/**
 * Resolve the base ref for a merge: prefer the explicit `gitWorktreeBase`,
 * else first match in `develop|main|master` (local then `origin/`).
 */
export function resolveDefaultBase(
  cwd: string,
  hint?: string,
): string | null {
  if (hint && tryRun(`git rev-parse --verify ${shellEscape(hint)}`, cwd)) return hint;
  for (const name of BASE_FALLBACKS) {
    if (tryRun(`git rev-parse --verify refs/heads/${name}`, cwd)) return name;
  }
  for (const name of BASE_FALLBACKS) {
    if (tryRun(`git rev-parse --verify refs/remotes/origin/${name}`, cwd)) {
      return `origin/${name}`;
    }
  }
  return null;
}

/**
 * Resolve the PR base for `gh pr create`. Differs from `resolveDefaultBase`
 * in two ways:
 *   1. The hint MUST exist on `origin/` (`refs/remotes/origin/<hint>`).
 *      `gh pr create` needs the base to be a remote branch — a local-only
 *      hint (e.g. a feature branch the worktree forked from but that was
 *      never pushed) is rejected here and the chain falls through to the
 *      `develop|main|master` fallbacks on `origin/`.
 *   2. Returns the bare branch name (no `origin/` prefix), since `gh` wants
 *      `--base <name>` not `--base origin/<name>`.
 *
 * See change: add-worktree-lifecycle-actions.
 */
export function resolveRemoteBase(
  cwd: string,
  hint?: string,
): string | null {
  const stripOrigin = (n: string) => n.replace(/^origin\//, "");
  const hintBare = hint ? stripOrigin(hint) : undefined;
  if (hintBare && tryRun(`git rev-parse --verify refs/remotes/origin/${shellEscape(hintBare)}`, cwd)) {
    return hintBare;
  }
  for (const name of BASE_FALLBACKS) {
    if (tryRun(`git rev-parse --verify refs/remotes/origin/${name}`, cwd)) {
      return name;
    }
  }
  return null;
}

/**
 * Merge the worktree's current branch into its base ref. Refuses when
 * the main checkout is dirty; aborts the merge on conflict.
 *
 * Steps (all in `mainPath`):
 *   1. `git status --porcelain` (empty => clean)
 *   2. `git checkout <base>`
 *   3. `git merge --no-ff <branch>`
 *   4. Optional `git branch -d <branch>`
 */
export function mergeWorktree(opts: {
  cwd: string;
  baseHint?: string;
  deleteBranch?: boolean;
}): LifecycleSuccess<{ mergeSha: string; branchDeleted: boolean }> | LifecycleFailure<MergeCode | "dirty_main"> {
  const { cwd, baseHint, deleteBranch } = opts;
  const mainPath = resolveMainPath(cwd);
  if (!mainPath) return { ok: false, code: "git_failed", stderr: "unable to resolve main checkout" };
  const branch = tryRun("git rev-parse --abbrev-ref HEAD", cwd);
  if (!branch || branch === "HEAD") {
    return { ok: false, code: "git_failed", stderr: "worktree is in a detached HEAD state" };
  }
  const base = resolveDefaultBase(mainPath, baseHint);
  if (!base) return { ok: false, code: "base_not_found" };

  // 1. Main must be clean.
  const porcelain = tryRun("git status --porcelain", mainPath);
  if (porcelain && porcelain.length > 0) {
    return { ok: false, code: "dirty_main" as any, stderr: porcelain };
  }

  // 2. Checkout base in main.
  try {
    execSync(`git checkout ${shellEscape(base)}`, {
      cwd: mainPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: GIT_TIMEOUT,
    });
  } catch (err: any) {
    const stderr = String(err?.stderr ?? err?.message ?? "");
    return { ok: false, code: mapMergeStderr(stderr), stderr };
  }

  // 3. Merge --no-ff.
  try {
    execSync(`git merge --no-ff ${shellEscape(branch)}`, {
      cwd: mainPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: GIT_TIMEOUT,
    });
  } catch (err: any) {
    // git writes conflict notices to BOTH stdout ("CONFLICT (content)...")
    // AND stderr ("Automatic merge failed..."). Concatenate so the mapper
    // sees all of it; empty strings are harmless.
    const stderrRaw = [err?.stderr, err?.stdout, err?.message]
      .map((v) => (v == null ? "" : String(v)))
      .filter((s) => s.length > 0)
      .join("\n");
    const code = mapMergeStderr(stderrRaw);
    if (code === "merge_conflict") {
      // Best-effort abort to leave main on `base` in a clean state.
      tryRun("git merge --abort", mainPath);
    }
    return { ok: false, code, stderr: stderrRaw };
  }

  const mergeSha = tryRun("git rev-parse --short HEAD", mainPath) ?? "";

  let branchDeleted = false;
  if (deleteBranch) {
    try {
      execSync(`git branch -d ${shellEscape(branch)}`, {
        cwd: mainPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: GIT_TIMEOUT,
      });
      branchDeleted = true;
    } catch {
      // Refuse to escalate to -D — the spec explicitly forbids it.
      branchDeleted = false;
    }
  }

  return { ok: true, data: { mergeSha, branchDeleted } };
}

/**
 * Five-line `git diff --stat <base>..<branch>` plus shortstat numbers,
 * for the merge confirm dialog.
 */
export function worktreeDiffStat(opts: {
  cwd: string;
  baseHint?: string;
}): LifecycleSuccess<{ summary: string; filesChanged: number; insertions: number; deletions: number; base: string; branch: string }> | LifecycleFailure<MergeCode> {
  const { cwd, baseHint } = opts;
  const mainPath = resolveMainPath(cwd);
  if (!mainPath) return { ok: false, code: "git_failed" };
  const branch = tryRun("git rev-parse --abbrev-ref HEAD", cwd);
  if (!branch || branch === "HEAD") return { ok: false, code: "git_failed" };
  const base = resolveDefaultBase(mainPath, baseHint);
  if (!base) return { ok: false, code: "base_not_found" };
  let stat: string;
  try {
    stat = execSync(
      `git diff --stat ${shellEscape(base)}..${shellEscape(branch)}`,
      { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: GIT_TIMEOUT },
    );
  } catch (err: any) {
    const stderr = String(err?.stderr ?? err?.message ?? "");
    return { ok: false, code: mapMergeStderr(stderr), stderr };
  }
  const lines = stat.split("\n").filter((l) => l.length > 0);
  const summary = lines.slice(0, 5).join("\n");
  const shortstatLine = lines[lines.length - 1] ?? "";
  const { filesChanged, insertions, deletions } = parseShortstat(shortstatLine);
  return {
    ok: true,
    data: { summary, filesChanged, insertions, deletions, base, branch },
  };
}

/**
 * `git push [-u] origin <branch>` from the worktree.
 */
export function pushBranch(opts: {
  cwd: string;
  setUpstream?: boolean;
}): LifecycleSuccess<{ pushed: true }> | LifecycleFailure<PushCode> {
  const { cwd, setUpstream = true } = opts;
  const branch = tryRun("git rev-parse --abbrev-ref HEAD", cwd);
  if (!branch || branch === "HEAD") {
    return { ok: false, code: "git_failed", stderr: "detached HEAD" };
  }
  // Detect missing remote up-front for a clean error.
  const remoteExists = tryRun("git remote get-url origin", cwd);
  if (!remoteExists) return { ok: false, code: "no_remote" };
  const args = ["git", "push"];
  if (setUpstream) args.push("-u");
  args.push("origin", branch);
  try {
    execSync(args.map(shellEscape).join(" "), {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: GIT_TIMEOUT,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  } catch (err: any) {
    const stderr = String(err?.stderr ?? err?.message ?? "");
    return { ok: false, code: mapPushStderr(stderr), stderr };
  }
  return { ok: true, data: { pushed: true } };
}

/**
 * Open a GitHub pull request via `gh pr create`. When the branch has
 * no upstream, push first. Caller is expected to have resolved `gh`
 * via the tool registry (we accept the path here).
 */
export function createPullRequest(opts: {
  cwd: string;
  ghPath: string;
  title?: string;
  body?: string;
  baseHint?: string;
}): LifecycleSuccess<{ url: string; pushed: boolean }> | LifecycleFailure<PrCode | PushCode | "pushed_but_pr_failed"> {
  const { cwd, ghPath, title, body, baseHint } = opts;
  const branch = tryRun("git rev-parse --abbrev-ref HEAD", cwd);
  if (!branch || branch === "HEAD") {
    return { ok: false, code: "git_failed", stderr: "detached HEAD" };
  }
  const upstream = tryRun(`git rev-parse --abbrev-ref ${shellEscape(branch)}@{upstream}`, cwd);
  let pushed = false;
  if (!upstream) {
    const pushResult = pushBranch({ cwd, setUpstream: true });
    if (!pushResult.ok) return pushResult;
    pushed = true;
  }
  const mainPath = resolveMainPath(cwd);
  // Resolve base AGAINST `origin/` because `gh pr create` needs a remote
  // branch (it diffs origin/<base>..<head> to populate --fill or to
  // validate the PR). Falls back to `origin/{develop,main,master}` when
  // the session's `gitWorktreeBase` hint is a local-only branch.
  const base = resolveRemoteBase(cwd, baseHint);
  if (!base) return { ok: false, code: "base_not_found", stderr: `no base branch found on origin (tried hint=${baseHint ?? "<none>"} + ${BASE_FALLBACKS.join("|")})` };
  const args = [ghPath, "pr", "create", "--base", base, "--head", branch];
  // Derive an explicit title when none supplied. Using `--fill` requires
  // the remote base ref to be locally up-to-date so gh can compute the
  // diff; on freshly-pushed branches that's often not true and --fill
  // explodes with "could not compute title or body defaults: failed to
  // run git: fatal: ambiguous argument ...". Falling back to the latest
  // commit subject (or branch name) side-steps the dependency on origin.
  const resolvedTitle = title ?? deriveDefaultPrTitle(cwd, branch);
  args.push("--title", resolvedTitle);
  args.push("--body", body ?? "");
  let stdout: string;
  try {
    stdout = execSync(args.map(shellEscape).join(" "), {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: GIT_TIMEOUT,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    });
  } catch (err: any) {
    // gh writes the error to BOTH stdout and stderr in many failure
    // modes (e.g. "could not compute title or body defaults" lands on
    // stdout). Concatenate so the mapper sees all of it.
    const stderr = [err?.stderr, err?.stdout, err?.message]
      .map((v) => (v == null ? "" : String(v)))
      .filter((s) => s.length > 0)
      .join("\n");
    const code = mapPrStderr(stderr);
    if (pushed) {
      return { ok: false, code: "pushed_but_pr_failed", stderr };
    }
    return { ok: false, code, stderr };
  }
  const url = parsePrUrl(stdout);
  if (!url) {
    return { ok: false, code: "git_failed", stderr: stdout };
  }
  return { ok: true, data: { url, pushed } };
}

/**
 * Default PR title when the caller doesn't supply one. Prefers the
 * latest commit subject on `branch`; falls back to the branch name.
 * Trimmed and truncated to 72 chars (conventional PR title limit).
 */
function deriveDefaultPrTitle(cwd: string, branch: string): string {
  const subject = tryRun(`git log -1 --format=%s ${shellEscape(branch)}`, cwd);
  const candidate = (subject && subject.length > 0) ? subject : branch;
  return candidate.slice(0, 72);
}

/** Pop the most recent stash. */
export function stashPop(cwd: string): StashPopResult {
  // Check if there are stash entries
  const stashList = tryRun("git stash list", cwd);
  if (!stashList) {
    throw new Error("no stash entries");
  }

  try {
    run("git stash pop", cwd);
    return { conflicts: false };
  } catch (err: any) {
    // git stash pop exits non-zero on conflicts but still applies
    const msg: string = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n");
    if (msg.includes("CONFLICT") || msg.includes("conflict") || msg.includes("Merge conflict")) {
      return { conflicts: true };
    }
    throw err;
  }
}
