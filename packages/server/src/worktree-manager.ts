/**
 * Git worktree lifecycle manager.
 *
 * Encapsulates git worktree operations used by the worktree-session-spawn
 * flow. All operations use `git worktree` CLI via execSync — no new
 * dependencies. Branch names and paths are validated before shell use
 * to prevent injection.
 *
 * See change: worktree-session-spawn.
 */
import { execSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { existsSync, mkdirSync, appendFileSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isGitRepo } from "./git-operations.js";

// ── Constants ─────────────────────────────────────────────────────────────

const GIT_TIMEOUT = 15_000;

/**
 * Directory name for dashboard-managed worktrees (relative to repo
 * parent). Created on first worktree addition.
 */
export const WORKTREES_DIR = ".pi/worktrees";

/**
 * Branch name validation regex. Only allow safe characters to prevent
 * shell injection when passed to `git worktree add`.
 */
const BRANCH_RE = /^[a-zA-Z0-9._\-/]+$/;

// ── Helpers ───────────────────────────────────────────────────────────────

/** Run a git command, return stdout (may have trailing whitespace). Throws on failure. */
function run(command: string, cwd: string): string {
  return execSync(command, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: GIT_TIMEOUT,
  });
}

/** Run a git command, return stdout or undefined on failure. */
function tryRun(command: string, cwd: string): string | undefined {
  try {
    return run(command, cwd);
  } catch {
    return undefined;
  }
}

/** Slugify a string for filesystem path use. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Resolve the git repository root from any path inside the repo. */
export function resolveRepoRoot(cwd: string): string {
  const raw = run("git rev-parse --show-toplevel", cwd).trim();
  // Use path.resolve for consistent normalization (handles trailing slashes, symlinks etc.)
  return path.resolve(raw);
}

/**
 * Resolve the MAIN repository root from a worktree path.
 * Parses the `.git` file to find the primary checkout.
 * For non-worktree paths, returns the regular repo root.
 */
export function resolveMainRepoRoot(cwd: string): string {
  // Walk up to find .git file
  let dir = path.resolve(cwd);
  for (let i = 0; i < 64; i++) {
    const gitPath = path.join(dir, ".git");
    try {
      const st = statSync(gitPath);
      if (st.isFile()) {
        // Worktree: .git file contains gitdir: /main/repo/.git/worktrees/name
        const content = readFileSync(gitPath, "utf-8");
        const match = content.match(/^gitdir:\s*(.+)$/m);
        if (match) {
          // gitdir is .../main-repo/.git/worktrees/name
          // Go up 2 levels to get main-repo root
          const gitDir = match[1].trim();
          const worktreesDir = path.dirname(gitDir); // .../main-repo/.git/worktrees
          const dotGit = path.dirname(worktreesDir);  // .../main-repo/.git
          return path.resolve(path.dirname(dotGit));  // .../main-repo
        }
        return resolveRepoRoot(dir); // fallback
      }
      if (st.isDirectory()) {
        // Main worktree — just resolve normally
        return resolveRepoRoot(dir);
      }
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolveRepoRoot(cwd);
}

/** Check if the given cwd is inside a git repository. */
export function isInsideWorkTree(cwd: string): boolean {
  return isGitRepo(cwd);
}

/**
 * Detect if a path is inside a git worktree and extract metadata.
 * Worktrees have `.git` as a file (not a directory).
 * Walks up from cwd to find the `.git` file.
 *
 * @returns `{ branch, path }` if inside a worktree, `undefined` otherwise.
 */
export function detectWorktree(cwd: string): { branch: string; path: string } | undefined {
  if (!isInsideWorkTree(cwd)) return undefined;

  // Walk up from cwd to find .git
  let dir = path.resolve(cwd);
  for (let i = 0; i < 64; i++) {
    const gitPath = path.join(dir, ".git");
    try {
      const st = statSync(gitPath);
      if (st.isFile()) {
        // .git is a FILE — this is a worktree (spec: worktree detection §4.1)
        // Read the gitdir reference to find the actual repo path
        const gitdirContent = readFileSync(gitPath, "utf-8");
        const match = gitdirContent.match(/^gitdir:\s*(.+)$/m);
        if (!match) return undefined;

        // The worktree root is the directory containing the .git file
        const worktreePath = dir;

        // Extract branch name (spec: worktree detection §4.2)
        const branch = tryRun("git branch --show-current", worktreePath)?.trim();
        if (!branch) return undefined;

        return { branch, path: worktreePath };
      }
      // .git is a directory — this is the main worktree; keep walking up
    } catch {
      // .git not found at this level — keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface WorktreeInfo {
  /** Absolute path to the worktree */
  path: string;
  /** Branch name (or HEAD for detached) */
  branch: string;
  /** HEAD commit SHA (may be empty for unborn branches) */
  head: string;
  /** True if this is the main working tree (bare = true means bare repo) */
  bare: boolean;
  /** True if the worktree is currently locked */
  locked: boolean;
  /** True if this is the primary (main) worktree */
  isMain: boolean;
}

export interface AddWorktreeResult {
  /** Absolute path to the created worktree */
  path: string;
  /** Branch name the worktree is checked out on */
  branch: string;
}

export interface WorktreeErrorResult {
  success: false;
  error: string;
  /** Structured error code for client classification */
  code:
    | "dirty_working_tree"
    | "branch_not_found"
    | "not_a_git_repo"
    | "git_unavailable"
    | "path_exists";
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Ensure the `.pi-worktrees/` directory exists under the repo parent,
 * and that it is gitignored.
 */
export function ensureWorktreesDir(repoRoot: string): void {
  const worktreesDir = path.join(repoRoot, WORKTREES_DIR);
  if (!existsSync(worktreesDir)) {
    mkdirSync(worktreesDir, { recursive: true });
  }

  // Append to .gitignore if not already present (uses .pi/ prefix so whole .pi dir is gitignored)
  const gitignorePath = path.join(repoRoot, ".gitignore");
  let gitignoreContent = "";
  try {
    gitignoreContent = readFileSync(gitignorePath, "utf-8");
  } catch {
    // No .gitignore yet — will be created
  }
  const lines = gitignoreContent.split("\n");
  const needle = `.pi/`;
  if (!lines.some((line) => line.trim() === needle)) {
    const toWrite = gitignoreContent
      ? (gitignoreContent.endsWith("\n") ? `${needle}\n` : `\n${needle}\n`)
      : `${needle}\n`;
    appendFileSync(gitignorePath, toWrite, "utf-8");
  }
}

/**
 * Generate a unique worktree path inside `.pi-worktrees/`.
 *
 * Format: `<repoRoot>/../.pi-worktrees/<label-slug>-<branch-slug>-<timestamp>/`
 * When label is omitted, only branch-slug + timestamp are used.
 */
export function generateWorktreePath(
  repoRoot: string,
  branch: string,
  label?: string,
): string {
  const worktreesDir = path.join(repoRoot, WORKTREES_DIR);
  // Strip known remote prefix (origin/) for cleaner directory names
  const shortBranch = branch.startsWith("origin/") ? branch.slice("origin/".length) : branch;
  const branchSlug = slugify(shortBranch);
  const ts = Date.now();
  const labelSlug = label ? slugify(label) : null;
  const dirName = labelSlug
    ? `${labelSlug}-${branchSlug}-${ts}`
    : `${branchSlug}-${ts}`;
  return path.join(worktreesDir, dirName);
}

/**
 * Validate a path fragment is safe for shell interpolation.
 * Only allows alphanumeric, dots, dashes, underscores, forward slashes.
 */
function validatePathSafe(fragment: string, context: string): void {
  if (!/^[a-zA-Z0-9._\-/]+$/.test(fragment)) {
    throw Object.assign(
      new Error(`Unsafe ${context}: "${fragment}". Allowed: [a-zA-Z0-9._/-]`),
      { code: "git_unavailable" },
    );
  }
}

/**
 * Validate branch name against the allowed character set.
 * Throws if the branch name contains unsafe characters.
 */
function validateBranch(branch: string): void {
  if (!branch || branch.length === 0) {
    throw Object.assign(new Error("Branch name must not be empty"), { code: "branch_not_found" });
  }
  if (!BRANCH_RE.test(branch)) {
    throw Object.assign(
      new Error(`Invalid branch name: "${branch}". Allowed: [a-zA-Z0-9._/-]`),
      { code: "branch_not_found" },
    );
  }
}

/**
 * Add a git worktree for the given branch.
 *
 * The worktree is created at `<repoRoot>/../.pi-worktrees/<branch-slug>-<timestamp>/`
 * (with optional label prepended). The `.pi-worktrees/` directory is created
 * and gitignored on first use.
 *
 * @param repoRoot — absolute path to the repository root
 * @param branch — branch name (validated against `[a-zA-Z0-9._/-]+`)
 * @param label — optional human-readable label slugified and prepended to path
 * @returns `{ path, branch }` on success
 * @throws `WorktreeErrorResult`-shaped error with `.code` on failure
 */
export function addWorktree(
  repoRoot: string,
  branch: string,
  opts?: { label?: string; baseBranch?: string },
): AddWorktreeResult {
  const label = opts?.label;
  const baseBranch = opts?.baseBranch;

  // ── Pre-flight validations ──────────────────────────────────────────

  // 1. Check git is available
  if (
    !tryRun("git --version", repoRoot) &&
    !tryRun("git --version", process.cwd())
  ) {
    throw Object.assign(new Error("git binary not found on PATH"), {
      code: "git_unavailable",
    });
  }

  // 2. Check it's a git repo
  if (!isInsideWorkTree(repoRoot)) {
    throw Object.assign(new Error("Not a git repository"), {
      code: "not_a_git_repo",
    });
  }

  // 3. Validate new branch name
  validateBranch(branch);

  // 4. If baseBranch provided: verify it exists and create new branch from it
  //    If no baseBranch: branch must already exist
  if (baseBranch) {
    validateBranch(baseBranch);
    const isRemote = baseBranch.includes("/");
    const baseExists =
      tryRun(`git rev-parse --verify refs/heads/${baseBranch}`, repoRoot) !== undefined;
    const remoteExists = isRemote
      ? tryRun(`git rev-parse --verify refs/remotes/${baseBranch}`, repoRoot) !== undefined
      : tryRun(`git rev-parse --verify refs/remotes/origin/${baseBranch}`, repoRoot) !== undefined;
    if (!baseExists && !remoteExists) {
      throw Object.assign(new Error(`Base branch "${baseBranch}" not found`), {
        code: "branch_not_found",
      });
    }
  } else {
    const isRemote = branch.includes("/");
    const branchExists =
      tryRun(`git rev-parse --verify refs/heads/${branch}`, repoRoot) !== undefined;
    const remoteExists = isRemote
      ? tryRun(`git rev-parse --verify refs/remotes/${branch}`, repoRoot) !== undefined
      : tryRun(`git rev-parse --verify refs/remotes/origin/${branch}`, repoRoot) !== undefined;
    if (!branchExists && !remoteExists) {
      throw Object.assign(new Error(`Branch "${branch}" not found`), {
        code: "branch_not_found",
      });
    }
  }

  // 5. Ensure .pi-worktrees/ dir and .gitignore
  ensureWorktreesDir(repoRoot);

  // 6. Generate path (slug is based on `branch`, which is the new/target branch name)
  const worktreePath = generateWorktreePath(repoRoot, branch, label);

  // 7. Check path doesn't already exist
  if (existsSync(worktreePath)) {
    throw Object.assign(new Error(`Path already exists: ${worktreePath}`), {
      code: "path_exists",
    });
  }

  // ── Run git worktree add ────────────────────────────────────────────
  // Validate path safety before shell interpolation (spec: shell-escape §1.4)
  validatePathSafe(worktreePath, "worktree path");
  try {
    if (baseBranch) {
      // Create NEW branch from base → `git worktree add -b <new> <path> <base>`
      run(`git worktree add -b "${branch}" "${worktreePath}" "${baseBranch}"`, repoRoot);
    } else if (branch.includes("/")) {
      // Remote branch (e.g. origin/feature-x): create local tracking branch
      const localBranch = branch.split("/").slice(1).join("/");
      const localExists = tryRun(`git rev-parse --verify refs/heads/${localBranch}`, repoRoot) !== undefined;
      if (localExists) {
        run(`git worktree add "${worktreePath}" "${localBranch}"`, repoRoot);
      } else {
        run(`git worktree add -b "${localBranch}" "${worktreePath}" "${branch}"`, repoRoot);
      }
    } else {
      // Local branch — direct checkout
      run(`git worktree add "${worktreePath}" "${branch}"`, repoRoot);
    }
  } catch (err: any) {
    const msg: string = [
      err.stdout?.toString("utf-8") ?? "",
      err.stderr?.toString("utf-8") ?? "",
      err.message ?? "",
    ]
      .filter(Boolean)
      .join("\n");

    if (
      msg.includes("dirty") ||
      msg.includes("modified") ||
      msg.includes("uncommitted") ||
      msg.includes("would be overwritten") ||
      msg.includes("checkout would overwrite")
    ) {
      throw Object.assign(
        new Error(`dirty_working_tree: ${msg}`),
        { code: "dirty_working_tree" },
      );
    }

    if (
      msg.includes("already used by worktree") ||
      msg.includes("already checked out") ||
      msg.includes("already exists")
    ) {
      throw Object.assign(
        new Error(`Branch "${branch}" already exists or is checked out.`),
        { code: "branch_already_checked_out" },
      );
    }

    // Generic git error
    throw Object.assign(new Error(`git worktree add failed: ${msg}`), {
      code: "git_unavailable",
    });
  }

  // Return the actual branch name used in the worktree
  // For remote refs without baseBranch: returns the local tracking name
  // For baseBranch mode: returns the new branch name as-is
  // For local branch: returns the branch as-is
  const finalBranch = (!baseBranch && branch.includes("/"))
    ? branch.split("/").slice(1).join("/")
    : branch;
  return { path: worktreePath, branch: finalBranch };
}

/**
 * List all git worktrees for the repository containing `repoRoot`.
 *
 * Parses `git worktree list --porcelain` output.
 * External (non-dashboard-managed) worktrees are included.
 *
 * @param repoRoot — absolute path to the repository root
 * @returns array of WorktreeInfo
 */
export function listWorktrees(repoRoot: string): WorktreeInfo[] {
  if (!isInsideWorkTree(repoRoot)) {
    return [];
  }

  const output = tryRun("git worktree list --porcelain", repoRoot);
  if (!output) return [];

  const results: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};
  let isFirst = true; // first entry is the main worktree

  for (const line of output.split("\n")) {
    if (line === "") {
      // End of entry — flush
      if (current.path) {
        results.push({
          path: current.path,
          branch: current.branch ?? "(detached)",
          head: current.head ?? "",
          bare: current.bare ?? false,
          locked: current.locked ?? false,
          isMain: isFirst,
        });
      }
      current = {};
      isFirst = false;
      continue;
    }

    if (line.startsWith("worktree ")) {
      current.path = line.slice("worktree ".length);
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line.startsWith("bare")) {
      current.bare = true;
    } else if (line.startsWith("locked")) {
      current.locked = true;
    }
  }

  return results;
}

/**
 * Remove a git worktree.
 *
 * Only allows removal of worktrees inside the `.pi-worktrees/` directory
 * managed by the dashboard. Refuses to remove the main worktree.
 *
 * @param repoRoot — absolute path to the repository root
 * @param worktreePath — absolute path to the worktree to remove
 * @param force — if true, use `--force` (default: true)
 * @throws `WorktreeErrorResult`-shaped error on failure
 */
export function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  force = true,
): void {
  // 1. Check it's a git repo
  if (!isInsideWorkTree(repoRoot)) {
    throw Object.assign(new Error("Not a git repository"), {
      code: "not_a_git_repo",
    });
  }

  // 2. Verify path is a valid worktree (exists in list)
  const worktrees = listWorktrees(repoRoot);
  const found = worktrees.find((w) => w.path === worktreePath);
  if (!found) {
    throw Object.assign(new Error(`Not a worktree: ${worktreePath}`), {
      code: "not_a_worktree",
    });
  }

  // 3. Refuse to remove main worktree
  if (found.isMain) {
    throw Object.assign(
      new Error("Cannot remove the main worktree"),
      { code: "cannot_remove_main_worktree" },
    );
  }

  // 4. Refuse to remove worktrees outside .pi/worktrees/
  const worktreesDir = path.join(repoRoot, WORKTREES_DIR);
  if (!worktreePath.startsWith(worktreesDir + path.sep)) {
    throw Object.assign(
      new Error("Cannot remove worktrees outside .pi/worktrees/"),
      { code: "external_worktree_readonly" },
    );
  }

  // 5. Run git worktree remove
  // Validate path safety before shell interpolation (spec: shell-escape §1.4)
  validatePathSafe(worktreePath, "worktree path");
  try {
    const forceFlag = force ? " --force" : "";
    run(`git worktree remove${forceFlag} "${worktreePath}"`, repoRoot);
  } catch (err: any) {
    const msg: string = [
      err.stdout?.toString("utf-8") ?? "",
      err.stderr?.toString("utf-8") ?? "",
      err.message ?? "",
    ]
      .filter(Boolean)
      .join("\n");
    throw Object.assign(new Error(`git worktree remove failed: ${msg}`), {
      code: "git_unavailable",
    });
  }
}
