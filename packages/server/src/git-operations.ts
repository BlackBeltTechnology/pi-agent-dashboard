/**
 * Server-side git operations — branch listing, checkout, init, stash.
 */
import { execSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

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
