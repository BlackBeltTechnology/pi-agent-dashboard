/**
 * `ensureWorktree` — the worktree of one change, created (or reused) BEFORE `spawnMember` (design D4, tasks
 * 3.3 / 8.11-8.14). It drives the dashboard git routes by loopback inject, like ship-batch's runner:
 *   1. reuse a registered worktree at the explicit path `<repo>/.worktrees/os-<change>` when it is on
 *      `os/<change>`; else
 *   2. check out an existing local branch `os/<change>`; else an `origin/` one (best-effort fetch first); else
 *   3. fork `os/<change>` from `base` (`refs/heads/<base>`, else `origin/<base>`);
 *   4. one orphan-cleanup retry on `path_exists`; 5. the init hook (`init_untrusted` fails the launch, it is
 *      never auto-trusted).
 * Safety: every untrusted value (change, base, repo) is validated BEFORE any git or inject call, so an
 * option-like or malformed value never reaches an argv; local git calls use literal flags and positionals
 * only; the path is always explicit; the returned `data.path` and the `.worktrees` directory are checked by
 * realpath on BOTH sides (a symlinked `.worktrees`, another basename or a path outside the lead cwd is
 * `worktree_path_unexpected`, never a fallback to the lead cwd). Typed codes pass through verbatim from the
 * route (`git_failed`, `branch_in_use`, `init_untrusted`, `path_exists`, …).
 * The 120 s launch bound is the launcher's: it aborts `signal`; an aborted call answers `aborted`, a late
 * success is ignored and the worktree left.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import { isValidBranchRef } from "./config.js";
import { type GitRunner, runGit } from "./git.js";
import type { InjectFn } from "./inject.js";
import { isChangeName } from "./inputs.js";
import type { OpenspecApi } from "./profiles.js";

export interface EnsureWorktreeInput {
  /** Real path of the lead cwd (the main checkout root). */
  repo: string;
  change: string;
  /** Fork base (`openspecWorktreeBase`). */
  base: string;
  signal?: AbortSignal;
}

export type EnsureWorktreeResult = { ok: true; path: string; branch: string } | { ok: false; code: string; message?: string };

export interface EnsureWorktreeOptions {
  /** Local git runner (tests). */
  git?: GitRunner;
  /** Bound of the best-effort `git fetch` (default 30 s). */
  fetchTimeoutMs?: number;
}

const FETCH_TIMEOUT_MS = 30_000;

/** One answer of a route call, flattened (`failure` set when the call did not produce an HTTP answer). */
interface RouteReply {
  status: number;
  json: unknown;
  failure?: "aborted" | "transport";
}

const reply2xx = (res: RouteReply): boolean => {
  if (res.status < 200 || res.status >= 300) return false;
  const body = res.json as { success?: unknown } | undefined | null;
  return !(body && typeof body === "object" && body.success === false);
};

/**
 * The stable `code` of a failure body restricted to a safe token, else `fallback`: `code`, then (for a guard
 * refusal, 403) the machine-readable `reason` — `local_proof_required` under the strict `requireLocalProof`
 * default, where a credential-less loopback write is refused — then `error`.
 */
function replyCode(res: RouteReply, fallback: string): string {
  const body = res.json as { code?: unknown; error?: unknown; reason?: unknown } | undefined | null;
  for (const v of [body?.code, res.status === 403 ? body?.reason : undefined, body?.error]) if (typeof v === "string" && /^[a-z][a-z0-9_]{0,47}$/.test(v)) return v;
  return fallback;
}

/** Call a route; an abort settles at once (a late answer is ignored), a rejection is a transport failure. */
async function callRoute(inject: InjectFn, method: "POST", url: string, payload: unknown, signal?: AbortSignal): Promise<RouteReply> {
  if (signal?.aborted) return { status: 0, json: undefined, failure: "aborted" };
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<RouteReply>((resolve) => {
    onAbort = () => resolve({ status: 0, json: undefined, failure: "aborted" });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  const call = inject({ method, url, payload }).then(
    (r): RouteReply => ({ status: r.statusCode, json: r.body }),
    (): RouteReply => ({ status: 0, json: undefined, failure: "transport" }),
  );
  try {
    return await Promise.race([call, aborted]);
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

const fail = (code: string, message?: string): EnsureWorktreeResult => ({ ok: false, code, ...(message ? { message } : {}) });

const realOrUndefined = (p: string): string | undefined => {
  try {
    return fs.realpathSync(p);
  } catch {
    return undefined;
  }
};

/** `.worktrees` must be a real directory (not a symlink) directly under the real repo root, when it exists. */
function checkWorktreesDir(realRepo: string): { ok: true; root: string } | { ok: false } {
  const root = path.join(realRepo, ".worktrees");
  let st: fs.Stats;
  try {
    st = fs.lstatSync(root);
  } catch {
    return { ok: true, root }; // absent: the route creates it
  }
  if (st.isSymbolicLink() || !st.isDirectory() || realOrUndefined(root) !== root) return { ok: false };
  return { ok: true, root };
}

/** Is `p` the real directory `<root>/os-<change>`? Both sides are realpath'd. */
function isExpectedWorktree(p: unknown, root: string, change: string): string | undefined {
  if (typeof p !== "string" || p === "") return undefined;
  const realP = realOrUndefined(p);
  const realRoot = realOrUndefined(root);
  if (!realP || !realRoot) return undefined;
  return realP === path.join(realRoot, `os-${change}`) && path.basename(realP) === `os-${change}` ? realP : undefined;
}

/** Registered worktree paths (real) of the repo. */
async function registeredWorktrees(git: GitRunner, repo: string, signal?: AbortSignal): Promise<string[] | undefined> {
  const r = await git(repo, ["worktree", "list", "--porcelain"], signal ? { signal } : {});
  if (!r.ok) return undefined;
  return r.stdout
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length).trim())
    .map((p) => realOrUndefined(p) ?? p);
}

const refExists = async (git: GitRunner, repo: string, ref: string, signal?: AbortSignal): Promise<boolean> => (await git(repo, ["rev-parse", "--verify", "--quiet", ref], signal ? { signal } : {})).ok;

function failure(res: RouteReply, fallback: string): EnsureWorktreeResult {
  if (res.failure === "aborted") return fail("aborted", "the launch was aborted");
  if (res.failure === "transport") return fail("inject_failed", "the dashboard route could not be reached");
  return fail(replyCode(res, fallback), `HTTP ${res.status}`);
}

export async function ensureWorktree(api: Pick<OpenspecApi, "inject">, input: EnsureWorktreeInput, opts: EnsureWorktreeOptions = {}): Promise<EnsureWorktreeResult> {
  const { repo, change, base, signal } = input;
  // 1. untrusted values are refused before anything runs
  if (!isChangeName(change) || change === "archive") return fail("invalid_args", "not a change name");
  if (!isValidBranchRef(base)) return fail("invalid_config", "openspecWorktreeBase is not a valid ref");
  if (typeof repo !== "string" || !path.isAbsolute(repo) || /[\u0000-\u001f\u007f]/.test(repo)) return fail("invalid_args", "repo must be an absolute path");
  const inject = api.inject;
  if (!inject) return fail("inject_unavailable", "the host exposes no route inject");
  const git = opts.git ?? runGit;
  const branch = `os/${change}`;

  const realRepo = realOrUndefined(repo);
  if (!realRepo) return fail("git_failed", "the repository path does not exist");
  const dir = checkWorktreesDir(realRepo);
  if (!dir.ok) return fail("worktree_path_unexpected", ".worktrees is not a real directory under the repository");
  const wt = path.join(dir.root, `os-${change}`);
  try {
    if (fs.lstatSync(wt).isSymbolicLink()) return fail("worktree_path_unexpected", "the worktree path is a symlink");
  } catch {
    /* absent: fine */
  }
  if (signal?.aborted) return fail("aborted");

  const finish = async (p: unknown): Promise<EnsureWorktreeResult> => {
    const real = isExpectedWorktree(p, dir.root, change);
    if (!real) return fail("worktree_path_unexpected", "the worktree is not at <repo>/.worktrees/os-<change>");
    const init = await callRoute(inject, "POST", "/api/git/worktree/init", { cwd: real }, signal);
    if (!reply2xx(init)) return failure(init, "init_failed");
    return { ok: true, path: real, branch };
  };

  // 2. reuse a registered worktree on the expected branch
  const registered = await registeredWorktrees(git, realRepo, signal);
  if (!registered) return fail("git_failed", "git worktree list failed");
  if (registered.includes(realOrUndefined(wt) ?? wt)) {
    const head = await git(wt, ["symbolic-ref", "--short", "-q", "HEAD"], signal ? { signal } : {});
    if (head.ok && head.stdout.trim() !== branch) return fail("worktree_branch_mismatch", `the worktree has another branch checked out (expected ${branch})`);
    return finish(wt);
  }

  // 3. checkout an existing branch, else fork from the base
  let body: Record<string, string>;
  if (await refExists(git, realRepo, `refs/heads/${branch}`, signal)) body = { cwd: realRepo, base: branch, path: wt };
  else {
    await git(realRepo, ["fetch", "--no-tags", "--", "origin", branch], { timeoutMs: opts.fetchTimeoutMs ?? FETCH_TIMEOUT_MS, ...(signal ? { signal } : {}) }); // best effort
    if (await refExists(git, realRepo, `refs/remotes/origin/${branch}`, signal)) body = { cwd: realRepo, base: `origin/${branch}`, path: wt };
    else {
      const forkBase = (await refExists(git, realRepo, `refs/heads/${base}`, signal)) ? base : `origin/${base}`;
      body = { cwd: realRepo, base: forkBase, newBranch: branch, path: wt };
    }
  }
  if (signal?.aborted) return fail("aborted");

  const create = (): Promise<RouteReply> => callRoute(inject, "POST", "/api/git/worktree", body, signal);
  let res = await create();
  if (res.status === 409 && replyCode(res, "") === "path_exists") {
    // one orphan-cleanup retry (a half-created directory of an earlier crash)
    const cleaned = await callRoute(inject, "POST", "/api/git/worktree/orphan-cleanup", { cwd: realRepo, path: wt }, signal);
    if (!reply2xx(cleaned)) return failure(cleaned, "git_failed");
    res = await create();
  }
  if (!reply2xx(res)) return failure(res, "git_failed");
  return finish((res.json as { data?: { path?: unknown } } | undefined)?.data?.path);
}
