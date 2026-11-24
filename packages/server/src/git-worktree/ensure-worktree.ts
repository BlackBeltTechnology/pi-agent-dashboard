/**
 * `ensureWorktree`: create-or-reuse a worktree for a branch on behalf of a
 * plugin spawn. A thin, never-throwing wrapper over `listWorktrees` +
 * `addWorktree` (the functions `POST /api/git/worktree` uses), adding known-folder
 * admission, ref validation, reuse containment under `<main>/.worktrees/`, and a
 * per-repo lock. Returns a typed result; every failure maps to a public code.
 *
 * See change: add-plugin-spawn-worktree (design D1, D3, D4, D5).
 */
import fs from "node:fs";
import path from "node:path";
import { type Admission, type AdmitCwdOptions, admissionAllows, releaseAdmission } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import { slugifyBranch } from "@blackbelt-technology/pi-dashboard-shared/git-worktree-helpers.js";
import { execFileSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { admitRouteCwd } from "../lib/route-admission.js";
import { safeRealpathSync } from "../resolve-path.js";
import {
  type AddWorktreeError,
  addWorktree,
  listWorktrees,
  pruneWorktrees,
  resolveDefaultBase,
  resolveMainPath,
} from "./git-operations.js";
import type { WorktreeEntry } from "./git-worktree.js";
import { isValidRefArg } from "./ref-arg.js";
import { repoLockKey, withRepoLock } from "./repo-lock.js";

export type EnsureWorktreeCode =
  | "not_git"
  | "admission_unavailable"
  | "branch_invalid"
  | "exists"
  | "base_not_found"
  | "branch_in_use"
  | "policy_mismatch"
  | "git_failed";

export type EnsureWorktreeResult =
  | { ok: true; path: string; branch: string; created: boolean }
  | { ok: false; code: EnsureWorktreeCode; message: string };

export interface EnsureWorktreeOptions {
  /** Directory inside the repository (a plugin's spawn `cwd`). Admitted against `knownCwds`. */
  cwd: string;
  branch: string;
  /** Fork point for a brand-new branch only; ignored when the branch or worktree already exists. */
  base?: string;
  ifExists: "reuse" | "fail";
  /** Host cwd-policy check on the target worktree path; `false` → `policy_mismatch`. Runs before any git write. */
  checkTarget?: (target: string) => boolean;
  /** Live known-folder set (same set the git routes admit against). Fail-closed default: nothing is known. */
  knownCwds?: () => string[];
  admitOptions?: AdmitCwdOptions;
}

/** Seams for tests; every default is the real implementation. */
export interface EnsureWorktreeDeps {
  admit?: (cwd: string) => Promise<Admission>;
  listWorktrees?: typeof listWorktrees;
  addWorktree?: typeof addWorktree;
  prune?: (cwd: string) => unknown;
  resolveDefaultBase?: typeof resolveDefaultBase;
}

const GIT_TIMEOUT = 15_000;

/** Run git with argv (no shell); true iff it exits 0. */
function gitOk(args: string[], cwd: string): boolean {
  try {
    execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: GIT_TIMEOUT });
    return true;
  } catch {
    return false;
  }
}

const fail = (code: EnsureWorktreeCode, message: string): EnsureWorktreeResult => ({ ok: false, code, message });

/** True iff `child` is strictly inside `dir` (both resolved; symlink-safe for existing paths). */
function isInside(dir: string, child: string): boolean {
  const rel = path.relative(safeRealpathSync(dir), safeRealpathSync(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Branch name safe to hand to git as a positional ref: argv-safe, a legal ref name, no `@{…}` shorthand. */
function isLegalBranch(branch: string, cwd: string): boolean {
  if (!isValidRefArg(branch) || branch.includes("@{")) return false;
  return gitOk(["check-ref-format", "--branch", branch], cwd);
}

const ADD_ERROR_CODE: Record<AddWorktreeError, EnsureWorktreeCode> = {
  not_a_repo: "not_git",
  cwd_invalid: "not_git",
  invalid_ref: "branch_invalid",
  branch_in_use: "branch_in_use",
  branch_exists: "git_failed",
  path_exists: "git_failed",
  base_not_found: "base_not_found",
  git_failed: "git_failed",
  git_not_found: "git_failed",
};

export async function ensureWorktree(opts: EnsureWorktreeOptions, deps: EnsureWorktreeDeps = {}): Promise<EnsureWorktreeResult> {
  try {
    return await run(opts, deps);
  } catch (err) {
    return fail("git_failed", err instanceof Error ? err.message : String(err));
  }
}

async function run(opts: EnsureWorktreeOptions, deps: EnsureWorktreeDeps): Promise<EnsureWorktreeResult> {
  const { branch, base, ifExists } = opts;
  const admit = deps.admit ?? ((c: string) => admitRouteCwd(c, { knownCwds: opts.knownCwds, admitOptions: opts.admitOptions }));
  const list = deps.listWorktrees ?? listWorktrees;
  const add = deps.addWorktree ?? addWorktree;
  const prune = deps.prune ?? pruneWorktrees;
  const defaultBase = deps.resolveDefaultBase ?? resolveDefaultBase;

  // Admission: the same known-folder rule the route applies, released in `finally`.
  const admission = await admit(opts.cwd);
  try {
    if (admission.kind === "indeterminate") return fail("admission_unavailable", "cwd admission could not be decided right now");
    if (admission.kind !== "admit" || !admissionAllows(admission, opts.cwd)) return fail("not_git", "cwd is not a known git folder");
    const cwd = admission.token.canonCwd;
    if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) return fail("not_git", "cwd is not a directory");

    const main = resolveMainPath(cwd);
    if (!main) return fail("not_git", "not a git repository");

    // Validation: every check below runs before any mutating git call.
    if (!isLegalBranch(branch, cwd)) return fail("branch_invalid", "invalid branch name");
    if (base !== undefined && !isValidRefArg(base)) return fail("branch_invalid", "invalid base ref");
    const slug = slugifyBranch(branch);
    const worktreesDir = path.join(main, ".worktrees");
    const derived = path.join(worktreesDir, slug);
    if (!slug || !isInside(worktreesDir, derived) || path.resolve(derived) !== derived) {
      return fail("branch_invalid", "branch does not map to a path under .worktrees/");
    }

    return await withRepoLock(repoLockKey(cwd), async () => {
      const policyOk = (target: string) => opts.checkTarget?.(target) !== false;

      // Step 1: an existing registration for the branch (bare-name match).
      let entries: WorktreeEntry[] = list(cwd);
      let match = entries.find((e) => e.branch === branch);
      if (match && (match.isMain || !isInside(worktreesDir, match.path))) {
        return fail("branch_in_use", "branch is checked out outside the worktree directory");
      }
      if (match && match.exists === false) {
        if (!policyOk(derived)) return fail("policy_mismatch", "target is outside the caller's cwd policy");
        prune(cwd);
        entries = list(cwd);
        match = entries.find((e) => e.branch === branch);
        if (match && match.exists === false) return fail("git_failed", "stale worktree registration could not be pruned");
      }
      if (match) {
        if (ifExists === "fail") return fail("exists", "a worktree for this branch already exists");
        if (!policyOk(match.path)) return fail("policy_mismatch", "target is outside the caller's cwd policy");
        return { ok: true, path: match.path, branch, created: false };
      }

      if (!policyOk(derived)) return fail("policy_mismatch", "target is outside the caller's cwd policy");

      // Steps 2-4: pick the add mode. An existing local branch is checked out, an origin-only
      // branch is continued from `origin/<branch>`, anything else forks `base` (verified here only).
      let added: ReturnType<typeof addWorktree>;
      if (gitOk(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cwd)) {
        added = add({ cwd, base: branch });
      } else if (gitOk(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], cwd)) {
        added = add({ cwd, base: `origin/${branch}`, newBranch: branch });
      } else {
        const from = base ?? defaultBase(cwd);
        if (!from || !gitOk(["rev-parse", "--verify", "--end-of-options", `${from}^{commit}`], cwd)) {
          return fail("base_not_found", "base ref not found");
        }
        added = add({ cwd, base: from, newBranch: branch });
      }
      if (!added.ok) return fail(ADD_ERROR_CODE[added.error] ?? "git_failed", added.message);
      return { ok: true, path: added.path, branch, created: true };
    });
  } finally {
    if (admission.kind === "admit") releaseAdmission(admission.token);
  }
}
