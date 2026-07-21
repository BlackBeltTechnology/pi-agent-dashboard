/**
 * In-memory FIFO count of pending "spawn hidden" markers per cwd — sibling to
 * `pending-automation-run-registry.ts`, same lifecycle semantics but the
 * payload is just a marker (no data).
 *
 * Lifecycle:
 *   1. A trusted plugin spawns a worker session via the `ServerPluginContext`
 *      spawn hook with `opts.hidden === true` → server enqueues a marker
 *      keyed by the session's cwd.
 *   2. Bridge later issues `session_register { sessionId, cwd }` → server
 *      consumes the head marker for that cwd and stamps
 *      `DashboardSession.hidden = true` (+ persists to `.meta.json`) so the
 *      session stays out of the sidebar list (the existing `filterSessions`
 *      already drops `hidden` sessions).
 *
 * Constraints mirror the automation-run registry: FIFO per cwd, cap 8, 60 s
 * TTL, cwd normalized via `safeRealpathSync`, in-memory only.
 *
 * See change: hide-council-explorer-sessions.
 */
import { safeRealpathSync } from "./resolve-path.js";

interface PendingMarker {
  enqueuedAt: number;
}

export const PENDING_HIDDEN_TTL_MS = 60_000;
export const PENDING_HIDDEN_CAP = 8;

export interface PendingHiddenRegistry {
  enqueue(cwd: string): boolean;
  consume(cwd: string): boolean;
  size(cwd: string): number;
}

export interface PendingHiddenOptions {
  now?: () => number;
  normalize?: (cwd: string) => string;
  warn?: (msg: string) => void;
}

export function createPendingHiddenRegistry(
  opts: PendingHiddenOptions = {},
): PendingHiddenRegistry {
  const now = opts.now ?? (() => Date.now());
  const normalize = opts.normalize ?? ((cwd: string) => safeRealpathSync(stripTrailingSep(cwd)));
  const warn = opts.warn ?? ((m: string) => console.warn(m));

  const store = new Map<string, PendingMarker[]>();

  function pruneStale(key: string): PendingMarker[] {
    const queue = store.get(key);
    if (!queue) return [];
    const cutoff = now() - PENDING_HIDDEN_TTL_MS;
    while (queue.length > 0 && queue[0]!.enqueuedAt < cutoff) queue.shift();
    if (queue.length === 0) {
      store.delete(key);
      return [];
    }
    return queue;
  }

  return {
    enqueue(cwd: string): boolean {
      const key = normalize(cwd);
      const queue = pruneStale(key);
      if (queue.length >= PENDING_HIDDEN_CAP) {
        warn(`[pending-hidden-registry] queue cap reached (${PENDING_HIDDEN_CAP}) for cwd=${key}`);
        return false;
      }
      queue.push({ enqueuedAt: now() });
      store.set(key, queue);
      return true;
    },

    consume(cwd: string): boolean {
      const key = normalize(cwd);
      const queue = pruneStale(key);
      if (queue.length === 0) return false;
      queue.shift();
      if (queue.length === 0) store.delete(key);
      return true;
    },

    size(cwd: string): number {
      const key = normalize(cwd);
      return pruneStale(key).length;
    },
  };
}

function stripTrailingSep(p: string): string {
  if (p.length > 1 && (p.endsWith("/") || p.endsWith("\\"))) {
    return p.replace(/[/\\]+$/, "");
  }
  return p;
}
