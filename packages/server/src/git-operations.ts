/**
 * Server-side git operations — branch listing, checkout, init, stash,
 * worktree (head probe, list, create).
 */
import fs from "node:fs";
import path from "node:path";
import { type ChildProcess, execFileAsync, execSync, spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { gitStatusV2 } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import type { GitChangedFile, GitCommitResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { GitStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
// Self-namespace import so `resolveConfigRoot` calls `isGitRepo`/`resolveMainPath`
// through the module's live exports — lets tests stub them (internal lexical
// references are otherwise un-spyable). See change: support-non-git-init-hook.
import * as self from "./git-operations.js";
import {
  ensureWorktreeExcludeLine,
  isOrphanWorktreePath,
  parsePorcelainWorktrees,
  resolveCheckoutLocalName,
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

/**
 * Fresh working-tree dirtiness + upstream drift for `cwd`. Reuses the shared
 * porcelain-v2 parser so the on-demand server read matches the bridge
 * broadcast byte-for-byte. Returns `undefined` on an inconclusive probe
 * (git missing, not a repo, timeout). See change:
 * add-session-uncommitted-indicator-and-commit.
 */
export function getGitStatus(cwd: string): GitStatus | undefined {
  const res = gitStatusV2({ cwd });
  return res.ok ? res.value : undefined;
}

/**
 * Error thrown by `commitFiles` carrying a stable machine-readable `code`
 * so the route can surface it to the dialog without string-matching stderr.
 */
export class GitCommitError extends Error {
  constructor(
    public code:
      | "not-a-repo"
      | "path-escape"
      | "no-files"
      | "empty-message"
      | "stage-failed"
      | "commit-failed",
    message: string,
  ) {
    super(message);
    this.name = "GitCommitError";
  }
}

/**
 * Resolve each repo-relative `file` against `cwd` and confirm it stays inside
 * `cwd`. Rejects absolute paths and `..` traversal that would escape the
 * working tree, AND root-equivalent inputs (`""`, `"."`, cwd itself) that would
 * resolve to `git add -- .` and stage the WHOLE tree instead of a chosen file.
 * Returns the sanitized repo-relative paths (normalized) for use in the
 * `git add -- <paths>` argv. Throws `GitCommitError` (`path-escape`) on the
 * first offender. See change:
 * add-session-uncommitted-indicator-and-commit (security-hardening).
 */
export function assertPathsInside(cwd: string, files: string[]): string[] {
  const root = path.resolve(cwd);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  return files.map((f) => {
    const abs = path.resolve(root, f);
    // Root-equivalent (empty / "." / cwd itself) would stage everything — the
    // picker always supplies concrete file paths, so reject it explicitly.
    if (abs === root) {
      throw new GitCommitError("path-escape", `path resolves to the repo root, not a file: ${JSON.stringify(f)}`);
    }
    if (!abs.startsWith(rootWithSep)) {
      throw new GitCommitError("path-escape", `path escapes cwd: ${f}`);
    }
    // Return the path relative to cwd so the argv is stable regardless of
    // how the client expressed it. `--` in the git argv still guards against
    // a leading-dash path being read as a flag.
    return path.relative(root, abs);
  });
}

/** Spawn git with an argv (no shell) and optional stdin. Never interpolates. */
function runGitCapture(
  args: string[],
  cwd: string,
  stdin?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let child: ChildProcess;
    try {
      child = spawn("git", args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      reject(err);
      return;
    }
    let settled = false;
    const done = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };
    // Timeout: SIGTERM, then SIGKILL escalation, then reject so a wedged git
    // never leaves the promise pending forever.
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } }, 2_000);
      done(() => reject(new Error(`git timed out after ${GIT_TIMEOUT}ms: git ${args[0]}`)));
    }, GIT_TIMEOUT);
    child.stdout?.on("data", (c: Buffer) => { stdout += c.toString("utf-8"); });
    child.stderr?.on("data", (c: Buffer) => { stderr += c.toString("utf-8"); });
    child.on("error", (err) => { done(() => reject(err)); });
    child.on("close", (code) => {
      done(() => resolve({ code: code ?? -1, stdout, stderr }));
    });
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    } else {
      child.stdin?.end();
    }
  });
}

/**
 * Stage the selected `files` and commit them with `message`.
 *
 * Security invariants (security-hardening):
 *   - argv arrays only — NO shell, so metacharacters in paths cannot execute.
 *   - message via `git commit -F -` stdin — never interpolated into a command
 *     string; multi-line bodies and `$()`/backticks are committed verbatim.
 *   - every path is `assertPathsInside(cwd)`-guarded before staging.
 *
 * Stages ONLY the selected paths (`git add -- <files>`), then commits the
 * index. Because staging is scoped to the chosen files, unselected changes
 * stay in the working tree. Returns `{ commitHash, subject }`.
 *
 * See change: add-session-uncommitted-indicator-and-commit.
 */
export async function commitFiles(opts: {
  cwd: string;
  message: string;
  files: string[];
}): Promise<GitCommitResult> {
  const { cwd, message, files } = opts;
  if (!self.isGitRepo(cwd)) throw new GitCommitError("not-a-repo", "cwd is not a git repository");
  if (files.length === 0) throw new GitCommitError("no-files", "no files selected");
  if (message.trim().length === 0) throw new GitCommitError("empty-message", "commit message is empty");

  const safePaths = assertPathsInside(cwd, files);

  const staged = await runGitCapture(["add", "--", ...safePaths], cwd);
  if (staged.code !== 0) {
    throw new GitCommitError("stage-failed", staged.stderr.trim() || "git add failed");
  }

  const committed = await runGitCapture(["commit", "-F", "-", "--", ...safePaths], cwd, message);
  if (committed.code !== 0) {
    throw new GitCommitError("commit-failed", committed.stderr.trim() || "git commit failed");
  }

  const head = await runGitCapture(["rev-parse", "HEAD"], cwd);
  const subjectRes = await runGitCapture(["log", "-1", "--pretty=%s"], cwd);
  return {
    commitHash: head.stdout.trim(),
    subject: subjectRes.stdout.trim(),
  };
}

/**
 * List changed files (staged, unstaged, untracked) with per-file line
 * additions/deletions for the commit dialog picker. Parses
 * `git status --porcelain=v2 --branch` for the file set + state, and
 * `git diff --numstat` (HEAD, then untracked via /dev/null) for counts.
 * Untracked files report their full line count as additions.
 * See change: add-session-uncommitted-indicator-and-commit.
 */
export async function getChangedFiles(cwd: string): Promise<GitChangedFile[]> {
  const statusRes = await runGitCapture(["status", "--porcelain=v2", "--branch"], cwd);
  // Propagate a real git failure instead of masking it as "no changes". A
  // clean tree still exits 0 with empty stdout → `[]` below.
  if (statusRes.code !== 0) {
    throw new GitCommitError("not-a-repo", statusRes.stderr.trim() || "git status failed");
  }

  const files: GitChangedFile[] = [];
  for (const line of statusRes.stdout.split("\n")) {
    if (line.length === 0) continue;
    const kind = line[0];
    if (kind === "?") {
      files.push({ path: line.slice(2), state: "untracked" });
      continue;
    }
    if (kind === "1" || kind === "2" || kind === "u") {
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      // Fixed field count before the path: 8 for `1`, 9 for `2` (rename
      // score), 10 for `u` (three stage hashes). For renames the path field
      // is `<newPath>\t<origPath>` — take the new path before the tab. Paths
      // may contain spaces, so rejoin the remaining tokens.
      const skip = kind === "1" ? 8 : kind === "2" ? 9 : 10;
      const p = parts.slice(skip).join(" ").split("\t")[0];
      const staged = xy[0] !== ".";
      files.push({ path: p, state: staged ? "staged" : "unstaged" });
    }
  }

  // Diffstat counts (best-effort; picker still works without them).
  const numstat = await runGitCapture(["diff", "HEAD", "--numstat"], cwd);
  if (numstat.code === 0) {
    const counts = new Map<string, { additions: number; deletions: number }>();
    for (const line of numstat.stdout.split("\n")) {
      if (!line) continue;
      const [add, del, ...rest] = line.split("\t");
      const p = rest.join("\t");
      counts.set(p, {
        additions: add === "-" ? 0 : parseInt(add, 10) || 0,
        deletions: del === "-" ? 0 : parseInt(del, 10) || 0,
      });
    }
    for (const f of files) {
      const c = counts.get(f.path);
      if (c) { f.additions = c.additions; f.deletions = c.deletions; }
    }
  }
  return files;
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

/**
 * Async git runner: trimmed stdout, or `undefined` on any failure. Uses async
 * `execFile` so the git subprocess never blocks the main event loop (unlike the
 * synchronous `run`/`tryRun` above). See change:
 * attribute-openspec-poll-eventloop-stalls.
 */
async function tryRunFileAsync(args: string[], cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf-8",
      timeout: GIT_TIMEOUT,
    });
    return String(stdout).trim();
  } catch {
    return undefined;
  }
}

/**
 * Async, non-blocking HEAD read for the folder-head poll. Mirrors `readHead`'s
 * branch/sha derivation (branch name on a branch; detached + short SHA
 * otherwise) but via async `execFile`, so the per-folder git spawns never form
 * one synchronous burst on the poll `setInterval` turn. Intentionally SKIPS the
 * `.gitmodules` submodule probe `readHead` does — the folder-head poll consumes
 * only `deriveDisplayBranch(head)` (branch/sha); the worktree dialog keeps using
 * the sync `readHead` when it needs `hasSubmodules`. See change:
 * attribute-openspec-poll-eventloop-stalls.
 */
export async function readHeadDisplayAsync(cwd: string): Promise<HeadInfo> {
  const symbolic = await tryRunFileAsync(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
  const sha = (await tryRunFileAsync(["rev-parse", "--short", "HEAD"], cwd)) ?? null;
  if (symbolic) {
    return { branch: symbolic, detached: false, sha };
  }
  return { branch: null, detached: sha !== null, sha };
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

/**
 * Resolve the directory containing this checkout's git `HEAD` file, worktree-
 * aware. For a main checkout returns `<cwd>/.git`; for a linked worktree
 * (whose `.git` is a file) returns the per-worktree gitdir
 * (`<main>/.git/worktrees/<name>`). Returns `null` when `cwd` is not a git
 * repository. Used by the folder-HEAD watcher to pick the directory to watch.
 * See change: refresh-folder-header-branch.
 */
export function resolveGitDir(cwd: string): string | null {
  const out = tryRun("git rev-parse --git-dir", cwd);
  if (!out) return null;
  return path.isAbsolute(out) ? out : path.join(cwd, out);
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
  /**
   * Set on `path_exists` returns. `true` when the target path exists on
   * disk but is NOT a registered worktree (likely orphan from a previous
   * failed attempt); `false` when the path IS a registered worktree.
   * Undefined for non-`path_exists` errors.
   * See change: openspec-worktree-spawn-button.
   */
  orphanLikely?: boolean;
}

export interface AddWorktreeOptions {
  /** Cwd inside the parent repo (any worktree's path resolves to the same parent). */
  cwd: string;
  /** Base ref to fork from (local or `origin/<x>`). In checkout mode (no
   *  `newBranch`) this is the existing branch ref to check out. */
  base: string;
  /**
   * New branch name to create at the worktree's HEAD (fork mode). When
   * omitted the server runs `git worktree add <path> <base>` (checkout
   * mode) — `base` carries the existing branch ref.
   * See change: worktree-checkout-existing-branch.
   */
  newBranch?: string;
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
  // Checkout mode = no newBranch. `base` is the existing branch ref to
  // check out. See change: worktree-checkout-existing-branch.
  const checkoutMode = newBranch === undefined;
  if (!isGitRepo(cwd)) {
    return { ok: false, error: "not_a_repo", message: "not a git repository" };
  }
  // Resolve the local branch name + commit-ish for checkout mode.
  //  - `base` is a local branch (`refs/heads/<base>` exists) → check it out
  //    directly; the branch keeps its full name (e.g. `feat/bar`).
  //  - otherwise `base` is a remote-tracking ref (`origin/foo`) → pass the
  //    BARE local name (`foo`) so git DWIM-creates a tracking branch.
  //    Passing `origin/foo` verbatim would yield a DETACHED HEAD, not a
  //    tracking branch, so the bare name is required to get the intended
  //    checkout. See change: worktree-checkout-existing-branch.
  const baseIsLocalBranch =
    checkoutMode && tryRun(`git show-ref --verify ${shellEscape(`refs/heads/${base}`)}`, cwd) !== undefined;
  const resolvedBranch = checkoutMode
    ? resolveCheckoutLocalName(base, baseIsLocalBranch)
    : newBranch;
  // In checkout mode the commit-ish handed to git is the resolved local
  // branch name (bare name triggers DWIM for remote-only refs); fork mode
  // forks from `base`.
  const checkoutCommitish = resolvedBranch;
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

  // Derive worktree path when not supplied. Fork mode slugs the new
  // branch name; checkout mode slugs the local name of the base ref so
  // `origin/foo` lands at `.worktrees/foo`, not `.worktrees/origin-foo`.
  let worktreePath = opts.path;
  if (!worktreePath) {
    const slug = slugifyBranch(resolvedBranch);
    if (!slug) {
      return {
        ok: false,
        error: "git_failed",
        message: `cannot derive a filesystem-safe slug from branch name "${resolvedBranch}"`,
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
      const orphanLikely = computeOrphanLikely(cwd, worktreePath);
      return {
        ok: false,
        error: "path_exists",
        message: `target path already exists and is not empty: ${worktreePath}`,
        orphanLikely,
      };
    }
  }

  // Fork mode:     git worktree add -b <newBranch> <path> <base>
  // Checkout mode: git worktree add <path> <commit-ish>   (no -b)
  // Args are quoted via single-shell-arg escaping below.
  const args = ["git", "worktree", "add"];
  if (force) args.push("--force");
  if (!checkoutMode) args.push("-b", newBranch);
  args.push(worktreePath, checkoutMode ? checkoutCommitish : base);
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
      // Enrich with the holding-worktree path when git exposes it, so the
      // UI can render a clear inline error pointing at the conflict.
      // See change: worktree-checkout-existing-branch.
      const held = stderr.match(/already used by worktree at '([^']+)'/i)?.[1];
      const message = held
        ? `branch is already checked out in another worktree at '${held}'`
        : "branch is already checked out in another worktree";
      return { ok: false, error: "branch_in_use", message, stderr };
    }
    if (/A branch named.*already exists|branch '.*' already exists/i.test(stderr)) {
      return { ok: false, error: "branch_exists", message: `branch "${resolvedBranch}" already exists`, stderr };
    }
    if (/invalid reference|unknown revision|not a valid object name/i.test(stderr)) {
      return { ok: false, error: "base_not_found", message: `base ref not found: ${base}`, stderr };
    }
    if (/'.*' already exists/i.test(stderr)) {
      const orphanLikely = computeOrphanLikely(cwd, worktreePath);
      return { ok: false, error: "path_exists", message: `target path already exists: ${worktreePath}`, stderr, orphanLikely };
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

  return { ok: true, path: worktreePath, branch: resolvedBranch, excludeAppended };
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
  type MergeCode,
  mapMergeStderr,
  mapPrStderr,
  mapPushStderr,
  mapRemoveStderr,
  type PrCode,
  type PushCode,
  parsePrUrl,
  parseShortstat,
  type RemoveCode,
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
export function resolveMainPath(cwd: string): string | null {
  const commonDirRaw = tryRun("git rev-parse --git-common-dir", cwd);
  if (!commonDirRaw) return null;
  const commonDirAbs = path.isAbsolute(commonDirRaw)
    ? commonDirRaw
    : path.resolve(cwd, commonDirRaw);
  return path.dirname(commonDirAbs);
}

/**
 * Resolve the directory that holds config (`.pi/settings.json`) for `cwd`,
 * without assuming git. Used only by the worktree init-status / init routes
 * so a declared hook is readable in a non-git directory.
 *
 * - git repo / worktree → `resolveMainPath(cwd)` (unchanged; may be `null` for a
 *   degenerate git state). A git dir is NEVER treated as its own config root —
 *   the non-git `cwd/.pi` branch is reachable only when `isGitRepo` is false.
 * - non-git dir with `.pi/settings.json` → `cwd` itself (no upward walk).
 * - non-git dir without it → `null`.
 *
 * See change: support-non-git-init-hook.
 */
export function resolveConfigRoot(cwd: string): string | null {
  if (self.isGitRepo(cwd)) return self.resolveMainPath(cwd);
  return fs.existsSync(path.join(cwd, ".pi", "settings.json")) ? cwd : null;
}

/**
 * Guarded residual-dir sweep. Deletes a leftover physical directory at a
 * removed worktree path ONLY when every safety condition holds:
 *   - the path exists on disk (else no-op → `false`);
 *   - its resolved realpath is strictly INSIDE `<mainPath>/.worktrees/`
 *     (symlink-resolved via the parent dir + basename, so a symlinked
 *     `.worktrees/<name>` pointing outside cannot escape the subtree);
 *   - it is not the `.worktrees/` root itself and never the main checkout.
 *
 * Returns `true` when a directory was removed, `false` on any refusal or
 * no-op. Destructive by design — the guard is the core safety control.
 * See change: sweep-worktree-residual-on-remove.
 */
export function sweepResidualWorktreeDir(mainPath: string, cwd: string): boolean {
  if (!fs.existsSync(cwd)) return false;
  const worktreesRoot = path.join(mainPath, ".worktrees");
  // Resolve symlinks. The target may itself be a symlink, so resolve its
  // PARENT dir (real) + append the basename, then realpath the whole thing
  // when it resolves to a real entry. This defeats a symlinked leaf that
  // points outside the subtree.
  let realTarget: string;
  let realRoot: string;
  try {
    realTarget = fs.realpathSync(cwd);
    if (!fs.existsSync(worktreesRoot)) return false;
    realRoot = fs.realpathSync(worktreesRoot);
  } catch {
    return false;
  }
  const realMain = (() => {
    try { return fs.realpathSync(mainPath); } catch { return path.resolve(mainPath); }
  })();
  // Never the main checkout, never the .worktrees root.
  if (realTarget === realMain || realTarget === realRoot) return false;
  // Must be strictly inside the .worktrees/ subtree.
  const rootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (!realTarget.startsWith(rootWithSep)) return false;
  try {
    fs.rmSync(realTarget, { recursive: true, force: true });
  } catch {
    return false;
  }
  return true;
}

/**
 * `git worktree remove [--force] <cwd>` invoked from the parent repo.
 * Stderr is mapped to a stable code.
 *
 * On git-confirmed removal, sweeps any residual physical directory that
 * survives at the worktree path (a kb husk recreated during removal) —
 * hard-guarded to the parent repo's `.worktrees/` subtree. Never runs on a
 * git failure. See change: sweep-worktree-residual-on-remove.
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
  // Belt-and-suspenders: git reported success but a live kb handle may have
  // recreated the dir. Sweep it, guarded to `.worktrees/`.
  sweepResidualWorktreeDir(mainPath, cwd);
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

// ── orphan-path detection + cleanup (change: openspec-worktree-spawn-button) ──

/**
 * Internal helper: returns `true` when `worktreePath` exists on disk but
 * is NOT a registered worktree of the repo at `cwd`. Used to populate the
 * `orphanLikely` field on `addWorktree`'s `path_exists` error envelope.
 *
 * Returns `false` on any error (defensive — if we can't compute, don't
 * promise the user a Clean-up affordance).
 *
 * See change: openspec-worktree-spawn-button.
 */
function computeOrphanLikely(cwd: string, worktreePath: string): boolean {
  try {
    const list = listWorktrees(cwd);
    return isOrphanWorktreePath({
      path: worktreePath,
      worktreeList: list,
      exists: (p: string) => fs.existsSync(p),
    });
  } catch {
    return false;
  }
}

export type OrphanCleanupError =
  | "outside_repo"
  | "not_a_directory"
  | "not_orphan"
  | "looks_like_worktree"
  | "too_many_files"
  | "file_too_large"
  | "fs_failed";

export interface OrphanCleanupSuccess {
  ok: true;
}

export interface OrphanCleanupFailure {
  ok: false;
  error: OrphanCleanupError;
  message: string;
}

export interface OrphanCleanupOptions {
  /** Cwd of the parent repo (used to resolve repo root + worktree list). */
  cwd: string;
  /** Absolute path of the orphan directory to delete. */
  path: string;
  /** Maximum file count allowed in the orphan dir. Default 20. */
  maxFiles?: number;
  /** Maximum per-file size in bytes. Default 1 MB. */
  maxFileSize?: number;
}

/**
 * Conservatively delete an orphan worktree-path directory. This unblocks
 * `addWorktree` when a previous failed attempt left a non-empty dir at
 * the target path — git's worktree list doesn't know about it (so the
 * dialog's existing-worktree list never shows it), but the fs-level
 * collision check blocks creation.
 *
 * Refuses (with a stable error code) unless EVERY guard passes:
 *  - `path` is inside `cwd` (anti-traversal)
 *  - `path` exists and is a directory
 *  - `path` is NOT in `git worktree list --porcelain` for `cwd`
 *  - `path` does NOT contain a top-level `.git` entry (file or directory)
 *  - file count is ≤ `maxFiles` (default 20)
 *  - no file exceeds `maxFileSize` (default 1 MB)
 *
 * On pass: `fs.rmSync(path, {recursive: true, force: true})`.
 *
 * See change: openspec-worktree-spawn-button.
 */
export function orphanCleanup(
  opts: OrphanCleanupOptions,
): OrphanCleanupSuccess | OrphanCleanupFailure {
  const { cwd } = opts;
  const targetPath = opts.path;
  const maxFiles = opts.maxFiles ?? 20;
  const maxFileSize = opts.maxFileSize ?? 1_048_576; // 1 MB

  // Resolve repo root via git common-dir (works from any worktree).
  const commonDirRaw = tryRun("git rev-parse --git-common-dir", cwd);
  if (!commonDirRaw) {
    return { ok: false, error: "outside_repo", message: "cwd is not inside a git repository" };
  }
  const commonDirAbs = path.isAbsolute(commonDirRaw)
    ? commonDirRaw
    : path.resolve(cwd, commonDirRaw);
  const repoRoot = path.dirname(commonDirAbs);

  // Anti-traversal: `targetPath` MUST be inside repoRoot. We resolve both
  // and compare prefixes (with separator) to avoid `/repo` matching
  // `/repository`.
  const absTarget = path.resolve(targetPath);
  const absRoot = path.resolve(repoRoot);
  const rootWithSep = absRoot.endsWith(path.sep) ? absRoot : absRoot + path.sep;
  if (absTarget !== absRoot && !absTarget.startsWith(rootWithSep)) {
    return { ok: false, error: "outside_repo", message: `path is not inside repo root: ${absTarget}` };
  }

  // Path must exist and be a directory.
  let stat;
  try {
    stat = fs.statSync(absTarget);
  } catch {
    return { ok: false, error: "not_a_directory", message: `path does not exist: ${absTarget}` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: "not_a_directory", message: `path is not a directory: ${absTarget}` };
  }

  // Must NOT be a registered worktree.
  let isOrphan = false;
  try {
    const list = listWorktrees(cwd);
    isOrphan = isOrphanWorktreePath({
      path: absTarget,
      worktreeList: list,
      exists: () => true, // we already confirmed via statSync above
    });
  } catch {
    return { ok: false, error: "fs_failed", message: "failed to list worktrees" };
  }
  if (!isOrphan) {
    return { ok: false, error: "not_orphan", message: `path is a registered worktree: ${absTarget}` };
  }

  // Must NOT contain a top-level `.git` entry of any kind.
  let topEntries: fs.Dirent[];
  try {
    topEntries = fs.readdirSync(absTarget, { withFileTypes: true });
  } catch {
    return { ok: false, error: "fs_failed", message: "failed to read directory" };
  }
  if (topEntries.some((e) => e.name === ".git")) {
    return { ok: false, error: "looks_like_worktree", message: "directory contains a .git entry; refuse to delete" };
  }

  // Walk the tree: count files + check each file size. Bound by maxFiles.
  // We do this recursively so a sneaky `subdir/big.bin` is also caught.
  let fileCount = 0;
  const stack: string[] = [absTarget];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return { ok: false, error: "fs_failed", message: `failed to read ${dir}` };
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      fileCount += 1;
      if (fileCount > maxFiles) {
        return { ok: false, error: "too_many_files", message: `directory contains more than ${maxFiles} files` };
      }
      try {
        const fileStat = fs.statSync(full);
        if (fileStat.size > maxFileSize) {
          return { ok: false, error: "file_too_large", message: `file exceeds ${maxFileSize} bytes: ${full}` };
        }
      } catch {
        return { ok: false, error: "fs_failed", message: `failed to stat ${full}` };
      }
    }
  }

  // All checks pass. Delete.
  try {
    fs.rmSync(absTarget, { recursive: true, force: true });
  } catch (err: any) {
    return { ok: false, error: "fs_failed", message: `rm failed: ${err?.message ?? String(err)}` };
  }
  return { ok: true };
}

// ── Pull request helpers (change: add-worktree-from-pull-request) ──────────

import type { PullRequestInfo } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

export type ListPrCode = "gh_not_authed" | "no_remote" | "git_failed";

export interface ListPrSuccess {
  ok: true;
  data: PullRequestInfo[];
}

export interface ListPrFailure {
  ok: false;
  code: ListPrCode;
  stderr?: string;
}

/**
 * Collapse GitHub's `statusCheckRollup` array into a single summary.
 * Each entry has a `status` and/or `conclusion`; we derive a rollup:
 *   - any failing  → "failing"
 *   - any pending  → "pending"
 *   - all success  → "passing"
 *   - empty / null → "none"
 */
function collapseCheckRollup(
  rollup: Array<{ status?: string; conclusion?: string }> | null | undefined,
): PullRequestInfo["checkRollup"] {
  if (!rollup || rollup.length === 0) return "none";
  let hasPending = false;
  for (const check of rollup) {
    const conclusion = check.conclusion?.toUpperCase();
    const status = check.status?.toUpperCase();
    if (
      conclusion === "FAILURE" ||
      conclusion === "TIMED_OUT" ||
      conclusion === "CANCELLED" ||
      conclusion === "ACTION_REQUIRED" ||
      conclusion === "STARTUP_FAILURE" ||
      status === "FAILURE" ||
      status === "ERROR"
    ) {
      return "failing";
    }
    if (
      status === "PENDING" ||
      status === "QUEUED" ||
      status === "IN_PROGRESS" ||
      status === "WAITING" ||
      status === "REQUESTED" ||
      conclusion === "" ||
      conclusion === undefined ||
      conclusion === null
    ) {
      hasPending = true;
    }
  }
  return hasPending ? "pending" : "passing";
}

/**
 * List open pull requests for the repo at `cwd` via `gh pr list`.
 * Returns typed `PullRequestInfo[]` with a collapsed `checkRollup`.
 */
export function listPullRequests(opts: {
  cwd: string;
  ghPath: string;
}): ListPrSuccess | ListPrFailure {
  const { cwd, ghPath } = opts;
  const args = [
    ghPath,
    "pr", "list",
    "--json", "number,title,headRefName,headRefOid,author,isDraft,isCrossRepository,statusCheckRollup",
    "--limit", "100",
  ];
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
    const stderr = [err?.stderr, err?.stdout, err?.message]
      .map((v) => (v == null ? "" : String(v)))
      .filter((s) => s.length > 0)
      .join("\n");
    const s = stderr.toLowerCase();
    if (
      /not logged in|authentication required|gh auth login|http 401/i.test(s)
    ) {
      return { ok: false, code: "gh_not_authed", stderr };
    }
    if (
      /no such remote|does not appear to be a git repository|could not determine repo/i.test(s)
    ) {
      return { ok: false, code: "no_remote", stderr };
    }
    return { ok: false, code: "git_failed", stderr };
  }
  let raw: any[];
  try {
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) {
      return { ok: false, code: "git_failed", stderr: "gh returned non-array JSON" };
    }
    raw = parsed;
  } catch {
    return { ok: false, code: "git_failed", stderr: "malformed JSON from gh" };
  }
  const data: PullRequestInfo[] = raw.map((pr: any) => ({
    number: pr.number,
    title: pr.title ?? "",
    headRefName: pr.headRefName ?? "",
    headRefOid: pr.headRefOid ?? "",
    author: pr.author?.login ?? "",
    isDraft: pr.isDraft === true,
    isCrossRepository: pr.isCrossRepository === true,
    checkRollup: collapseCheckRollup(pr.statusCheckRollup),
  }));
  return { ok: true, data };
}

// ── Create worktree from PR (change: add-worktree-from-pull-request) ──────

export type AddWorktreeFromPrError =
  | AddWorktreeError
  | "pr_not_found"
  | "gh_not_authed";

export interface AddWorktreeFromPrSuccess {
  ok: true;
  path: string;
  branch: string;
  prNumber: number;
}

export interface AddWorktreeFromPrFailure {
  ok: false;
  error: AddWorktreeFromPrError;
  message: string;
  stderr?: string;
  orphanLikely?: boolean;
}

/**
 * Create a new worktree checked out at a pull request's head commit.
 *
 * Mechanic (Candidate B from design.md):
 *   1. `git fetch origin refs/pull/<N>/head:refs/pr/<N>`
 *   2. `git worktree add <path> -b pr-<N> refs/pr/<N>`
 *
 * Works for both same-repo and fork PRs because GitHub serves
 * `refs/pull/<N>/head` from the base repo.
 */
export function addWorktreeFromPr(opts: {
  cwd: string;
  prNumber: number;
  path?: string;
}): AddWorktreeFromPrSuccess | AddWorktreeFromPrFailure {
  const { cwd, prNumber } = opts;
  if (!isGitRepo(cwd)) {
    return { ok: false, error: "not_a_repo", message: "not a git repository" };
  }

  // Resolve repo root (same as addWorktree).
  const commonDirRaw = tryRun("git rev-parse --git-common-dir", cwd);
  if (!commonDirRaw) {
    return { ok: false, error: "not_a_repo", message: "unable to resolve git common-dir" };
  }
  const commonDirAbs = path.isAbsolute(commonDirRaw)
    ? commonDirRaw
    : path.resolve(cwd, commonDirRaw);
  const repoRoot = path.dirname(commonDirAbs);

  const localRef = `refs/pr/${prNumber}`;
  const localBranch = `pr-${prNumber}`;
  const worktreePath = opts.path ?? path.join(repoRoot, ".worktrees", `pr-${prNumber}`);

  // Step 1: Fetch the PR head ref.
  const fetchCmd = [
    "git", "fetch", "origin",
    `refs/pull/${prNumber}/head:${localRef}`,
  ].map(shellEscape).join(" ");
  try {
    execSync(fetchCmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: GIT_TIMEOUT,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  } catch (err: any) {
    const stderr = String(err?.stderr ?? err?.message ?? "");
    if (/couldn.t find remote ref|no such ref/i.test(stderr)) {
      return { ok: false, error: "pr_not_found", message: `PR #${prNumber} not found`, stderr };
    }
    if (/authentication|permission denied|terminal prompts disabled/i.test(stderr)) {
      return { ok: false, error: "gh_not_authed", message: "git fetch auth failed", stderr };
    }
    return { ok: false, error: "git_failed", message: "git fetch failed", stderr };
  }

  // Step 2: Pre-flight path check.
  if (fs.existsSync(worktreePath)) {
    const isEmpty = (() => {
      try { return fs.readdirSync(worktreePath).length === 0; } catch { return false; }
    })();
    if (!isEmpty) {
      const orphanLikely = computeOrphanLikely(cwd, worktreePath);
      return {
        ok: false,
        error: "path_exists",
        message: `target path already exists and is not empty: ${worktreePath}`,
        orphanLikely,
      };
    }
  }

  // Step 3: Create the worktree.
  const addArgs = ["git", "worktree", "add", "-b", localBranch, worktreePath, localRef];
  try {
    execSync(addArgs.map(shellEscape).join(" "), {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: GIT_TIMEOUT,
    });
  } catch (err: any) {
    const stderr = String(err?.stderr ?? err?.message ?? "");
    if (/already used by worktree at|is already checked out at/i.test(stderr)) {
      return { ok: false, error: "branch_in_use", message: `branch pr-${prNumber} is already checked out in another worktree`, stderr };
    }
    if (/A branch named.*already exists|branch '.*' already exists/i.test(stderr)) {
      return { ok: false, error: "branch_exists", message: `branch "${localBranch}" already exists`, stderr };
    }
    if (/'.*' already exists/i.test(stderr)) {
      const orphanLikely = computeOrphanLikely(cwd, worktreePath);
      return { ok: false, error: "path_exists", message: `target path already exists: ${worktreePath}`, stderr, orphanLikely };
    }
    return { ok: false, error: "git_failed", message: "git worktree add failed", stderr };
  }

  // Housekeeping: append .worktrees/ to .git/info/exclude (same as addWorktree).
  if (!opts.path) {
    const excludePath = path.join(commonDirAbs, "info", "exclude");
    try {
      const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf-8") : "";
      const result = ensureWorktreeExcludeLine(existing);
      if (result.appended) {
        fs.mkdirSync(path.dirname(excludePath), { recursive: true });
        fs.writeFileSync(excludePath, result.content);
      }
    } catch {
      // Non-fatal.
    }
  }

  // Rewrite .pi/settings.json for the new worktree.
  rewriteWorktreePiSettings(worktreePath, repoRoot);

  return { ok: true, path: worktreePath, branch: localBranch, prNumber };
}
