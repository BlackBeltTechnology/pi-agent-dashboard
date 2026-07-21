/**
 * Per-folder filesystem watcher on the directory holding a folder's git
 * `HEAD` file. Modeled byte-for-byte on `openspec-change-watcher.ts`: same
 * `attach`/`detach`/`detachAll`/`size` surface, same debounce, same
 * graceful-degrade-on-throw contract.
 *
 * Trigger-only: on a `HEAD`-file event it invokes `onChange(cwd)`, which the
 * caller (folder-head poll wiring) fans into the SAME read → diff → broadcast
 * path used by the periodic poll. The watcher NEVER bypasses the diff cache,
 * NEVER forms a second broadcast path — it is a faster trigger, not a parallel
 * poll.
 *
 * HEAD directory resolution (the one wrinkle vs the openspec watcher, which
 * watches a fixed `openspec/changes` dir): use `git rev-parse --git-dir` (run
 * in `cwd`) so the per-worktree gitdir is watched for worktrees and
 * `<cwd>/.git` for main checkouts. Atomic checkouts replace HEAD via rename,
 * so we watch the DIRECTORY (non-recursively) and filter `filename === "HEAD"`.
 *
 * Failure mode: if `git rev-parse --git-dir` returns null (not a git repo) or
 * `fs.watch(...)` throws (ENOENT, EMFILE, EACCES, EPERM), the folder silently
 * degrades to "not attached" and the periodic poll still guarantees
 * correctness — just at the slower cadence.
 *
 * See change: refresh-folder-header-branch.
 */
import * as fs from "node:fs";
import { resolveGitDir as defaultResolveGitDir } from "./git-operations.js";

/**
 * Filename filter for watcher events. Only the `HEAD` file changing in the
 * watched gitdir means a branch/checkout change. Exported for unit tests.
 */
export function matchesHeadFile(name: string | null | undefined): boolean {
  return name === "HEAD";
}

export interface FolderHeadWatcher {
  /**
   * Attach watcher to the gitdir of `cwd`. Returns `true` iff a watcher was
   * newly attached. Returns `false` when already attached OR when the gitdir
   * could not be resolved OR `fs.watch(...)` failed. Callers treat `false` as
   * "retry later" — do NOT mark this cwd as permanently attached.
   */
  attach(cwd: string): boolean;
  /** Detach watcher + clear pending debounce timer. Idempotent. */
  detach(cwd: string): void;
  /** Detach every attached cwd. */
  detachAll(): void;
  /** Test helper: number of currently-attached cwds. */
  size(): number;
}

export interface FolderHeadWatcherDeps {
  /** Called after the debounce window for a cwd whose HEAD changed. */
  onChange: (cwd: string) => void;
  /** Debounce window in ms (default 300). */
  debounceMs?: number;
  /** Resolve the gitdir to watch for `cwd`. Override for tests. */
  resolveGitDir?: (cwd: string) => string | null;
  /** Optional logger; defaults to `console.warn` for failures only. */
  logger?: (msg: string) => void;
}

type WatcherEntry = {
  watcher: fs.FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
};

export function createFolderHeadWatcher(
  deps: FolderHeadWatcherDeps,
): FolderHeadWatcher {
  const debounceMs = deps.debounceMs ?? 300;
  const log = deps.logger ?? ((msg: string) => console.warn(msg));
  const resolveGitDir = deps.resolveGitDir ?? defaultResolveGitDir;
  const attached = new Map<string, WatcherEntry>();
  // Track cwds where attach failed so we don't spam logs on repeated calls.
  const failedOnce = new Set<string>();

  function scheduleFire(cwd: string) {
    const entry = attached.get(cwd);
    if (!entry) return; // detached during burst
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => {
      const current = attached.get(cwd);
      if (!current) return; // post-detach race
      current.debounceTimer = null;
      try {
        deps.onChange(cwd);
      } catch (err) {
        log(`[folder-head-watcher] onChange threw for ${cwd}: ${(err as Error).message}`);
      }
    }, debounceMs);
  }

  function attach(cwd: string): boolean {
    if (attached.has(cwd)) return false;
    let gitDir: string | null;
    try {
      gitDir = resolveGitDir(cwd);
    } catch (err) {
      gitDir = null;
      if (!failedOnce.has(cwd)) {
        failedOnce.add(cwd);
        log(`[folder-head-watcher] resolveGitDir threw for ${cwd}: ${(err as Error).message}; periodic poll will cover this cwd`);
      }
      return false;
    }
    if (!gitDir) {
      if (!failedOnce.has(cwd)) {
        failedOnce.add(cwd);
        log(`[folder-head-watcher] ${cwd} is not a git repo; periodic poll will cover this cwd`);
      }
      return false;
    }
    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(gitDir, { persistent: false });
    } catch (err) {
      if (!failedOnce.has(cwd)) {
        failedOnce.add(cwd);
        const code = (err as NodeJS.ErrnoException).code ?? "ERR";
        log(`[folder-head-watcher] attach failed for ${cwd} (${code}); periodic poll will cover this cwd`);
      }
      return false;
    }
    const entry: WatcherEntry = { watcher, debounceTimer: null };
    attached.set(cwd, entry);
    failedOnce.delete(cwd);

    const onEvent = (_eventType: string, filename: string | Buffer | null) => {
      const name = filename ? filename.toString() : null;
      if (!matchesHeadFile(name)) return;
      scheduleFire(cwd);
    };
    watcher.on("change", onEvent);
    // Atomic checkout swaps HEAD via rename; some platforms emit `rename`.
    watcher.on("rename", onEvent);
    watcher.on("error", (err) => {
      log(`[folder-head-watcher] error on ${cwd}: ${err.message}`);
      detach(cwd);
    });
    return true;
  }

  function detach(cwd: string): void {
    const entry = attached.get(cwd);
    if (!entry) return;
    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = null;
    }
    try {
      entry.watcher.close();
    } catch {
      // close() is best-effort; ignore errors.
    }
    attached.delete(cwd);
  }

  function detachAll(): void {
    for (const cwd of Array.from(attached.keys())) detach(cwd);
  }

  function size(): number {
    return attached.size;
  }

  return { attach, detach, detachAll, size };
}
