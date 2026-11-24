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
  try {
    return await run;
  } finally {
    // Drop the entry once nobody queued behind us, so the map stays bounded.
    if (tails.get(key) === tail) tails.delete(key);
  }
}
