/**
 * Per-repository async mutex for worktree create-or-reuse. Keyed by the
 * repository's resolved common git dir, so every worktree of one repo shares a
 * key. `POST /api/git/worktree` and `ensureWorktree` both take it, so a dialog
 * create and a plugin create for one repo serialize.
 *
 * See change: add-plugin-spawn-worktree (D4).
 */
import { safeRealpathSync } from "../resolve-path.js";
import { resolveCommonDirAbs } from "./git-operations.js";

const tails = new Map<string, Promise<unknown>>();
const depths = new Map<string, number>();

/** Calls currently holding or waiting for `key`'s lock (0 when idle). Lets a test observe that a caller has queued. */
export function repoLockDepth(key: string): number {
  return depths.get(key) ?? 0;
}

/** Lock key for the repository containing `cwd` (falls back to `cwd` when it has no resolvable common dir). */
export function repoLockKey(cwd: string): string {
  const common = resolveCommonDirAbs(cwd);
  return safeRealpathSync(common ?? cwd);
}

/** Run `fn` once every earlier holder of `key` has finished. A throwing `fn` releases the lock and rethrows. */
export async function withRepoLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  depths.set(key, repoLockDepth(key) + 1);
  try {
    return await run;
  } finally {
    const left = repoLockDepth(key) - 1;
    if (left > 0) depths.set(key, left);
    else depths.delete(key);
    // Drop the entry once nobody queued behind us, so the map stays bounded.
    if (tails.get(key) === tail) tails.delete(key);
  }
}
