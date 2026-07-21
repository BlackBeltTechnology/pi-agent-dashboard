/**
 * In-memory FIFO queue of pending `goalId` link intents per cwd — sibling to
 * `pending-worktree-base-registry.ts`, same lifecycle semantics.
 *
 * Lifecycle:
 *   1. Goal route's `+ New session` spawn path enqueues `{ cwd, goalId }`
 *      then spawns a headless pi session.
 *   2. Bridge later issues `session_register { sessionId, cwd }` → server
 *      consumes the head intent for that cwd and:
 *        a. writes `goalId` to the session's `.meta.json` sidecar,
 *        b. links the new sessionId into the `GoalRecord` via the goal store.
 *
 * Constraints mirror `pending-worktree-base-registry`:
 *  - FIFO per cwd, capped at 8 entries.
 *  - 60 s TTL; stale entries dropped on every touch.
 *  - Cwd normalized via `safeRealpathSync` + trailing-sep strip.
 *  - In-memory only.
 *
 * See change: add-goals-folder-page (task 1.4 / 4.4).
 */
import { safeRealpathSync } from "../resolve-path.js";

interface PendingGoal {
  goalId: string;
  enqueuedAt: number;
}

export const PENDING_GOAL_LINK_TTL_MS = 60_000;
export const PENDING_GOAL_LINK_CAP = 8;

export interface PendingGoalLinkRegistry {
  enqueue(cwd: string, goalId: string): boolean;
  consume(cwd: string): string | null;
  size(cwd: string): number;
}

export interface PendingGoalLinkOptions {
  now?: () => number;
  normalize?: (cwd: string) => string;
  warn?: (msg: string) => void;
}

export function createPendingGoalLinkRegistry(
  opts: PendingGoalLinkOptions = {},
): PendingGoalLinkRegistry {
  const now = opts.now ?? (() => Date.now());
  const normalize = opts.normalize ?? ((cwd: string) => safeRealpathSync(stripTrailingSep(cwd)));
  const warn = opts.warn ?? ((m: string) => console.warn(m));

  const store = new Map<string, PendingGoal[]>();

  function pruneStale(key: string): PendingGoal[] {
    const queue = store.get(key);
    if (!queue) return [];
    const cutoff = now() - PENDING_GOAL_LINK_TTL_MS;
    while (queue.length > 0 && queue[0]!.enqueuedAt < cutoff) {
      const stale = queue.shift()!;
      warn(
        `[pending-goal-link-registry] dropping stale goalId: cwd=${key} goalId=${stale.goalId} ageMs=${now() - stale.enqueuedAt}`,
      );
    }
    if (queue.length === 0) {
      store.delete(key);
      return [];
    }
    return queue;
  }

  return {
    enqueue(cwd: string, goalId: string): boolean {
      if (!goalId) return false;
      const key = normalize(cwd);
      const queue = pruneStale(key);
      if (queue.length >= PENDING_GOAL_LINK_CAP) {
        warn(
          `[pending-goal-link-registry] queue cap reached (${PENDING_GOAL_LINK_CAP}) for cwd=${key}; dropping goalId=${goalId}`,
        );
        return false;
      }
      queue.push({ goalId, enqueuedAt: now() });
      store.set(key, queue);
      return true;
    },

    consume(cwd: string): string | null {
      const key = normalize(cwd);
      const queue = pruneStale(key);
      if (queue.length === 0) return null;
      const head = queue.shift()!;
      if (queue.length === 0) store.delete(key);
      return head.goalId;
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
