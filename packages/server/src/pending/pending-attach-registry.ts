/**
 * In-memory FIFO queue of pending `attachProposal` intents per cwd.
 *
 * Lifecycle:
 *   1. Browser sends `spawn_session { cwd, attachProposal }` → server enqueues.
 *   2. Bridge later issues `session_register { sessionId, cwd }` → server
 *      consumes the head intent for that cwd and applies the same idempotent
 *      attach + auto-rename logic as `handleAttachProposal`.
 *
 * Constraints (see openspec/changes/add-folder-task-checker-and-spawn-attach):
 *  - Per-cwd queue is FIFO, capped at 8 entries (silent drop + warn on overflow).
 *  - Entries older than 60 s are discarded on every read or write touching that
 *    cwd, so a failed spawn cannot strand an intent that would later attach to
 *    an unrelated session.
 *  - Cwd is normalized via `safeRealpathSync` before keying the queue, so
 *    trailing-slash / symlink variants collapse onto the same key.
 *
 * In-memory only. NOT persisted across server restarts.
 */
import { safeRealpathSync } from "../resolve-path.js";

interface PendingAttach {
  changeName: string;
  enqueuedAt: number;
}

export const PENDING_ATTACH_TTL_MS = 60_000;
export const PENDING_ATTACH_QUEUE_CAP = 8;

export interface PendingAttachRegistry {
  enqueue(cwd: string, changeName: string): boolean;
  consume(cwd: string): string | null;
  size(cwd: string): number;
}

export interface PendingAttachRegistryOptions {
  /** Override `Date.now` for tests. */
  now?: () => number;
  /** Override the cwd normalizer (defaults to `safeRealpathSync`). */
  normalize?: (cwd: string) => string;
  /** Override warning sink (defaults to `console.warn`). */
  warn?: (msg: string) => void;
}

export function createPendingAttachRegistry(
  opts: PendingAttachRegistryOptions = {},
): PendingAttachRegistry {
  const now = opts.now ?? (() => Date.now());
  const normalize = opts.normalize ?? ((cwd: string) => safeRealpathSync(stripTrailingSep(cwd)));
  const warn = opts.warn ?? ((m: string) => console.warn(m));

  const store = new Map<string, PendingAttach[]>();

  function pruneStale(key: string): PendingAttach[] {
    const queue = store.get(key);
    if (!queue) return [];
    const cutoff = now() - PENDING_ATTACH_TTL_MS;
    let dropped = 0;
    while (queue.length > 0 && queue[0]!.enqueuedAt < cutoff) {
      const stale = queue.shift()!;
      dropped += 1;
      warn(
        `[pending-attach-registry] dropping stale intent: cwd=${key} change=${stale.changeName} ageMs=${now() - stale.enqueuedAt}`,
      );
    }
    if (queue.length === 0) {
      store.delete(key);
      return [];
    }
    void dropped;
    return queue;
  }

  return {
    enqueue(cwd: string, changeName: string): boolean {
      if (!changeName) return false;
      const key = normalize(cwd);
      const queue = pruneStale(key);
      if (queue.length >= PENDING_ATTACH_QUEUE_CAP) {
        warn(
          `[pending-attach-registry] queue cap reached (${PENDING_ATTACH_QUEUE_CAP}) for cwd=${key}; dropping change=${changeName}`,
        );
        return false;
      }
      queue.push({ changeName, enqueuedAt: now() });
      store.set(key, queue);
      return true;
    },

    consume(cwd: string): string | null {
      const key = normalize(cwd);
      const queue = pruneStale(key);
      if (queue.length === 0) return null;
      const head = queue.shift()!;
      if (queue.length === 0) store.delete(key);
      return head.changeName;
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
