/**
 * In-memory FIFO queue of pending `gitWorktreeBase` intents per cwd —
 * sibling to `pending-attach-registry.ts`, same lifecycle semantics.
 *
 * Lifecycle:
 *   1. Browser sends `spawn_session { cwd, gitWorktreeBase }` after the
 *      worktree dialog created a new worktree → server enqueues.
 *   2. Bridge later issues `session_register { sessionId, cwd }` → server
 *      consumes the head intent for that cwd and:
 *        a. writes `gitWorktreeBase` to the session's `.meta.json` sidecar,
 *        b. stamps the in-memory `DashboardSession.gitWorktreeBase` so the
 *           later `git_info_update` composes `gitWorktree.base` correctly.
 *
 * Constraints mirror `pending-attach-registry`:
 *  - FIFO per cwd, capped at 8 entries.
 *  - 60 s TTL; stale entries dropped on every touch.
 *  - Cwd normalized via `safeRealpathSync` + trailing-sep strip.
 *  - In-memory only.
 *
 * See change: add-worktree-spawn-dialog.
 */
import { safeRealpathSync } from "../resolve-path.js";

interface PendingBase {
  base: string;
  enqueuedAt: number;
}

export const PENDING_WORKTREE_BASE_TTL_MS = 60_000;
export const PENDING_WORKTREE_BASE_CAP = 8;

export interface PendingWorktreeBaseRegistry {
  enqueue(cwd: string, base: string): boolean;
  consume(cwd: string): string | null;
  size(cwd: string): number;
}

export interface PendingWorktreeBaseOptions {
  now?: () => number;
  normalize?: (cwd: string) => string;
  warn?: (msg: string) => void;
}

export function createPendingWorktreeBaseRegistry(
  opts: PendingWorktreeBaseOptions = {},
): PendingWorktreeBaseRegistry {
  const now = opts.now ?? (() => Date.now());
  const normalize = opts.normalize ?? ((cwd: string) => safeRealpathSync(stripTrailingSep(cwd)));
  const warn = opts.warn ?? ((m: string) => console.warn(m));

  const store = new Map<string, PendingBase[]>();

  function pruneStale(key: string): PendingBase[] {
    const queue = store.get(key);
    if (!queue) return [];
    const cutoff = now() - PENDING_WORKTREE_BASE_TTL_MS;
    while (queue.length > 0 && queue[0]!.enqueuedAt < cutoff) {
      const stale = queue.shift()!;
      warn(
        `[pending-worktree-base-registry] dropping stale base: cwd=${key} base=${stale.base} ageMs=${now() - stale.enqueuedAt}`,
      );
    }
    if (queue.length === 0) {
      store.delete(key);
      return [];
    }
    return queue;
  }

  return {
    enqueue(cwd: string, base: string): boolean {
      if (!base) return false;
      const key = normalize(cwd);
      const queue = pruneStale(key);
      if (queue.length >= PENDING_WORKTREE_BASE_CAP) {
        warn(
          `[pending-worktree-base-registry] queue cap reached (${PENDING_WORKTREE_BASE_CAP}) for cwd=${key}; dropping base=${base}`,
        );
        return false;
      }
      queue.push({ base, enqueuedAt: now() });
      store.set(key, queue);
      return true;
    },

    consume(cwd: string): string | null {
      const key = normalize(cwd);
      const queue = pruneStale(key);
      if (queue.length === 0) return null;
      const head = queue.shift()!;
      if (queue.length === 0) store.delete(key);
      return head.base;
    },

    size(cwd: string): number {
      const key = normalize(cwd);
      const queue = pruneStale(key);
      return queue.length;
    },
  };
}

function stripTrailingSep(p: string): string {
  if (p.length > 1 && (p.endsWith("/") || p.endsWith("\\"))) {
    return p.replace(/[/\\]+$/, "");
  }
  return p;
}
