/**
 * VCS info gathering — detects git branch/remote and worktree state.
 * Delegates to shared platform tool modules so there's no inline execSync
 * and every call benefits from the runner's safety defaults (windowsHide,
 * timeout, tolerated exit codes).
 *
 * See change: platform-command-executor.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as git from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import type { GitWorktreeInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { buildGitLinks, type GitLinks } from "./git-link-builder.js";
import { incPollCost } from "./poll-cost.js";

export interface GitInfo {
  gitBranch: string;
  gitBranchUrl?: string;
  /**
   * Worktree identity (mainPath, name) when cwd is a git worktree.
   * Undefined for the main checkout and for any cwd where the rev-parse
   * pair fails. Never carries `base` — that field is post-create
   * metadata supplied by the server.
   */
  gitWorktree?: GitWorktreeInfo;
}

/**
 * Detect whether `cwd` is a git repository as a tri-state.
 *
 * Uses the `git.isGitRepo()` `Result` (NOT `isGitRepoOr`) to distinguish
 * *confirmed non-git* from *unknown*:
 *   - `ok` → the boolean value (`git rev-parse --is-inside-work-tree`);
 *   - `error kind:"exit" code:128` → `false` (git ran and definitively
 *     reported "not a repository");
 *   - any other failure (missing binary, timeout, signal, other exit code)
 *     → `undefined` (unknown).
 *
 * Returns `undefined` — never `false` — on an inconclusive probe so a real
 * git repo whose probe failed never loses its truthy signal (the client
 * gate hides the `+Worktree` button only on a confirmed `false`).
 * See change: gate-session-worktree-button-on-git.
 */
export function detectIsGitRepo(cwd: string): boolean | undefined {
  const res = git.isGitRepo({ cwd });
  if (res.ok) return res.value;
  if (res.error.kind === "exit" && res.error.code === 128) return false;
  return undefined;
}

/** Detect the current git branch. Returns short SHA for detached HEAD. */
export function detectBranch(cwd: string): string | undefined {
  const ref = git.currentBranchOr({ cwd });
  if (!ref) return undefined;
  if (ref === "HEAD") {
    // Detached HEAD — return short commit SHA
    return git.headShaOr({ cwd, short: true }) ?? "HEAD";
  }
  return ref;
}

/** Detect the remote origin URL. */
export function detectRemoteUrl(cwd: string): string | undefined {
  return git.remoteUrlOr({ cwd });
}

/**
 * Detect whether `cwd` is a git worktree (not the main checkout).
 *
 * Delegates to the shared checkout-root resolver, whose worktree signal is
 * `--git-dir != --git-common-dir`. The superseded test — "is the common dir
 * outside `--show-toplevel`" — reported a SUBMODULE as a worktree and then
 * derived `mainPath` as the parent of the common dir, i.e. a
 * `…/.git/modules/<name>` path that does not exist.
 *
 * Returns `undefined` when:
 *   - a required rev-parse invocation fails (not a repo, git missing, timeout);
 *   - the cwd is not a linked worktree — which now covers a submodule, a
 *     `--separate-git-dir` checkout, and a bare repository alike;
 *   - no main checkout resolves (a worktree of a bare hub has none);
 *   - the resolved main checkout is implausible.
 *
 * That last check is this consumer's own obligation: the resolver returns a
 * user-controlled `core.worktree` value verbatim and does not judge it. Being
 * a DISPLAY consumer, the safe response here is to omit the field rather than
 * put a `.git`-internal path on the wire.
 *
 * See change: add-git-checkout-root-resolver.
 */
export function detectWorktree(cwd: string): GitWorktreeInfo | undefined {
  return worktreeFromRoots(git.checkoutRoots({ cwd }));
}

/** Pure worktree-identity derivation from a resolver verdict (see {@link detectWorktree}). */
export function worktreeFromRoots(roots: git.GitCheckoutRoots | null | undefined): GitWorktreeInfo | undefined {
  if (!roots?.isLinkedWorktree) return undefined;

  const mainPath = roots.mainCheckout;
  if (!mainPath || git.hasGitPathSegment(mainPath)) return undefined;

  // `thisCheckout`, not `cwd`: a session can sit in a SUBDIRECTORY of the
  // worktree, and `basename(cwd)` would then label the card with the subdir
  // name. The verdict already carries the worktree root.
  //
  // A LINKED WORKTREE ALWAYS HAS A WORKING TREE, so a null `thisCheckout` here
  // means `--show-toplevel` failed — an inconclusive probe, not a nameless
  // worktree. Falling back to `cwd` would silently reintroduce the subdirectory
  // mislabel for exactly the case we cannot verify, so omit the field instead.
  if (!roots.thisCheckout) return undefined;
  return { mainPath, name: path.basename(roots.thisCheckout) };
}

/**
 * Static git facts for a cwd: everything that changes only on a git
 * operation that rewrites the repo layout (remote edit, worktree move/repair,
 * `git init`). Cached per cwd and re-probed on a stamp change, on demand and
 * every 10th tick. See change: optimize-polling-hot-paths (D4).
 */
export interface StaticGitFacts {
  remoteUrl?: string;
  roots: git.GitCheckoutRoots | null;
  gitDir?: string;
  /** Existence/type/mtime stamp of `<thisCheckout>/.git` and `gitDir` (or `<cwd>/.git`). */
  dotGitStamp: string;
}

/** Injectable stat for the stamp (tests). */
export type StatFn = (p: string) => { isDirectory(): boolean; mtimeMs: number };

/**
 * Existence + type for a directory, existence + mtime for a FILE. Directory
 * mtimes are deliberately excluded: they change whenever an entry inside is
 * created/renamed (`index.lock` on every `git add`), which would turn routine
 * git activity into a full facts re-probe. A worktree's `.git` pointer FILE and
 * `<gitDir>/gitdir` are files, so `git worktree repair/move` still shows.
 */
function statToken(p: string, stat: StatFn): string {
  try {
    const st = stat(p);
    return st.isDirectory() ? "d" : `f${st.mtimeMs}`;
  } catch {
    return "-";
  }
}

/** Cheap (a few `stat`s, no spawn) change detector for worktree identity. */
export function dotGitStampOf(cwd: string, roots: git.GitCheckoutRoots | null, stat: StatFn = statSync): string {
  if (!roots) return `none:${statToken(path.join(cwd, ".git"), stat)}`;
  const top = roots.thisCheckout ?? cwd;
  const gitDir = roots.gitDir ? statToken(roots.gitDir, stat) : "-";
  const pointer = roots.gitDir ? statToken(path.join(roots.gitDir, "gitdir"), stat) : "-";
  return `${statToken(path.join(top, ".git"), stat)}|${gitDir}|${pointer}`;
}

/** Synchronous facts probe (first evaluation: ~3-5 git spawns, once per cwd). */
function evaluateFacts(cwd: string): StaticGitFacts {
  const roots = git.checkoutRoots({ cwd }) ?? null;
  incPollCost("pollGitSpawns", 4); // gitDir/commonDir/toplevel + remote (approximate; linked worktrees +2)
  const remoteUrl = detectRemoteUrl(cwd);
  return { remoteUrl, roots, gitDir: roots?.gitDir, dotGitStamp: dotGitStampOf(cwd, roots) };
}

/** Async twin used for background re-probes; never blocks pi's loop. */
async function evaluateFactsAsync(cwd: string): Promise<StaticGitFacts> {
  const [roots, remoteUrl] = await Promise.all([
    git.checkoutRootsAsync({ cwd }).catch(() => null),
    git.remoteUrlOrAsync({ cwd }).catch(() => undefined),
  ]);
  incPollCost("pollGitSpawns", 4);
  return { remoteUrl, roots: roots ?? null, gitDir: roots?.gitDir, dotGitStamp: dotGitStampOf(cwd, roots ?? null) };
}

export interface GitFactsDeps {
  evaluate: (cwd: string) => StaticGitFacts;
  evaluateAsync: (cwd: string) => Promise<StaticGitFacts>;
  stamp: (cwd: string, roots: git.GitCheckoutRoots | null) => string;
}

const sameFacts = (a: StaticGitFacts, b: StaticGitFacts) =>
  a.remoteUrl === b.remoteUrl && JSON.stringify(a.roots) === JSON.stringify(b.roots);

/** Per-cwd cache of {@link StaticGitFacts}. */
export class GitFactsCache {
  private readonly map = new Map<string, StaticGitFacts>();
  constructor(
    private readonly deps: GitFactsDeps = { evaluate: evaluateFacts, evaluateAsync: evaluateFactsAsync, stamp: (c, r) => dotGitStampOf(c, r) },
  ) {}

  /** Synchronous probe + store. */
  evaluate(cwd: string): StaticGitFacts {
    const facts = this.deps.evaluate(cwd);
    this.map.set(cwd, facts);
    return facts;
  }

  get(cwd: string): StaticGitFacts | undefined {
    return this.map.get(cwd);
  }

  /** True when the cheap `.git` stamp no longer matches the cached one. */
  stampChanged(cwd: string): boolean {
    const cached = this.map.get(cwd);
    return !!cached && this.deps.stamp(cwd, cached.roots) !== cached.dotGitStamp;
  }

  /**
   * Async re-probe. The result is committed only when `accept()` (checked AFTER
   * the await) still says the caller's context is current — a session/cwd
   * change that installed fresh facts meanwhile must not be overwritten by an
   * older in-flight probe. Reports whether the facts changed and whether they
   * were committed.
   */
  async reprobe(
    cwd: string,
    accept: () => boolean = () => true,
  ): Promise<{ facts: StaticGitFacts; changed: boolean; committed: boolean }> {
    const facts = await this.deps.evaluateAsync(cwd);
    if (!accept()) return { facts, changed: false, committed: false };
    const before = this.map.get(cwd);
    this.map.set(cwd, facts);
    return { facts, changed: !before || !sameFacts(before, facts), committed: true };
  }

  clear(): void {
    this.map.clear();
  }
}

/** Injected reads for {@link createHeadBranchReader}. */
export interface HeadBranchDeps {
  readFile: (p: string) => string;
  /** mtime of `p`, or 0 when it cannot be statted. */
  mtimeOf: (p: string) => number;
  /** Async CLI branch detection (symbolic name, or git's own short SHA when detached). */
  fallback: (cwd: string) => Promise<string | undefined>;
}

const defaultHeadDeps: HeadBranchDeps = {
  readFile: (p) => readFileSync(p, "utf8"),
  mtimeOf: (p) => {
    try {
      return statSync(p).mtimeMs;
    } catch {
      return 0;
    }
  },
  fallback: async (cwd) => {
    incPollCost("pollGitSpawns");
    const ref = await git.currentBranchOrAsync({ cwd });
    if (!ref) return undefined;
    if (ref !== "HEAD") return ref;
    incPollCost("pollGitSpawns");
    return (await git.headShaOrAsync({ cwd, short: true })) ?? "HEAD";
  },
};

export interface HeadBranchReader {
  /**
   * Current branch from `<gitDir>/HEAD` — a pure file read for the common
   * `ref: refs/heads/<name>` case. Anything else (SHA, other ref, unreadable)
   * uses an async CLI fallback memoised per HEAD content; while it is pending
   * the previous value is returned. `undefined` = not resolved yet.
   */
  read(cwd: string, gitDir: string | undefined): string | undefined;
  /** Forget the previous value (cwd/session change). */
  reset(): void;
}

/**
 * See change: optimize-polling-hot-paths (D5). `onResolved` fires when a
 * fallback settles with a value, so the caller can request a probe.
 */
export function createHeadBranchReader(
  onResolved: () => void = () => {},
  deps: HeadBranchDeps = defaultHeadDeps,
): HeadBranchReader {
  const memo = new Map<string, string | undefined>();
  const pending = new Set<string>();
  let last: string | undefined;
  return {
    read(cwd, gitDir) {
      let key: string;
      if (gitDir) {
        try {
          const content = deps.readFile(path.join(gitDir, "HEAD")).trim();
          const m = content.match(/^ref:\s*refs\/heads\/(.+)$/);
          if (m) {
            last = m[1];
            return last;
          }
          key = `c:${gitDir}:${content}`;
        } catch (e) {
          key = `e:${gitDir}:${(e as NodeJS.ErrnoException)?.code ?? "?"}:${deps.mtimeOf(path.join(gitDir, "HEAD"))}`;
        }
      } else {
        key = `e:nogitdir:${cwd}`;
      }
      if (memo.has(key)) {
        const v = memo.get(key);
        if (v !== undefined) last = v;
        return last;
      }
      if (!pending.has(key)) {
        pending.add(key);
        deps.fallback(cwd).then(
          (v) => {
            pending.delete(key);
            memo.set(key, v);
            if (v !== undefined) onResolved();
          },
          () => {
            pending.delete(key);
            memo.set(key, undefined);
          },
        );
      }
      return last;
    },
    reset() {
      last = undefined;
      memo.clear();
      pending.clear();
    },
  };
}

/** Assemble the wire-shaped info from a resolved branch + cached facts. */
export function gitInfoFrom(branch: string, facts: StaticGitFacts): GitInfo {
  const links: GitLinks = facts.remoteUrl ? buildGitLinks(facts.remoteUrl, branch) : {};
  return { gitBranch: branch, gitBranchUrl: links.branchUrl, gitWorktree: worktreeFromRoots(facts.roots) };
}

/**
 * Gather all git info for a directory SYNCHRONOUSLY (first evaluation only:
 * registration, cwd/session change). Returns undefined if not a git repo.
 * No PR lookup here: PR status is probed asynchronously by `pr-status.ts`.
 * See changes: redesign-composer-session-strip (D5), optimize-polling-hot-paths.
 */
export function gatherGitInfo(cwd: string): GitInfo | undefined {
  const branch = detectBranch(cwd);
  if (!branch) return undefined;
  incPollCost("pollGitSpawns", 1);
  return gitInfoFrom(branch, evaluateFacts(cwd));
}
