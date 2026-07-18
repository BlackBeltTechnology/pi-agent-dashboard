/**
 * In-memory FIFO queue of pending automation-run stamps per cwd — sibling
 * to `pending-worktree-base-registry.ts`, same lifecycle semantics.
 *
 * Lifecycle:
 *   1. The automation-plugin's scheduler fires a trigger and spawns a run
 *      session via the `ServerPluginContext` spawn hook → server enqueues
 *      the run stamp keyed by the run's cwd (worktree or repo root).
 *   2. Bridge later issues `session_register { sessionId, cwd }` → server
 *      consumes the head stamp for that cwd and:
 *        a. stamps `DashboardSession.kind="automation"` + `automationRun`,
 *        b. persists both to the session's `.meta.json` sidecar so the
 *           classification survives server restart.
 *
 * Constraints mirror `pending-worktree-base-registry`:
 *  - FIFO per cwd, capped at 8 entries.
 *  - 60 s TTL; stale entries dropped on every touch.
 *  - Cwd normalized via `safeRealpathSync` + trailing-sep strip.
 *  - In-memory only.
 *
 * See change: add-automation-plugin.
 */
import { safeRealpathSync } from "../resolve-path.js";

/** The automation-run identity stamped onto a registering session. */
export interface AutomationRunStamp {
  name: string;
  runId: string;
  visibility?: "hidden" | "shown";
}

interface PendingStamp {
  stamp: AutomationRunStamp;
  enqueuedAt: number;
}

export const PENDING_AUTOMATION_RUN_TTL_MS = 60_000;
export const PENDING_AUTOMATION_RUN_CAP = 8;

export interface PendingAutomationRunRegistry {
  enqueue(cwd: string, stamp: AutomationRunStamp): boolean;
  consume(cwd: string): AutomationRunStamp | null;
  size(cwd: string): number;
}

export interface PendingAutomationRunOptions {
  now?: () => number;
  normalize?: (cwd: string) => string;
  warn?: (msg: string) => void;
}

export function createPendingAutomationRunRegistry(
  opts: PendingAutomationRunOptions = {},
): PendingAutomationRunRegistry {
  const now = opts.now ?? (() => Date.now());
  const normalize = opts.normalize ?? ((cwd: string) => safeRealpathSync(stripTrailingSep(cwd)));
  const warn = opts.warn ?? ((m: string) => console.warn(m));

  const store = new Map<string, PendingStamp[]>();

  function pruneStale(key: string): PendingStamp[] {
    const queue = store.get(key);
    if (!queue) return [];
    const cutoff = now() - PENDING_AUTOMATION_RUN_TTL_MS;
    while (queue.length > 0 && queue[0]!.enqueuedAt < cutoff) {
      const stale = queue.shift()!;
      warn(
        `[pending-automation-run-registry] dropping stale stamp: cwd=${key} run=${stale.stamp.name}:${stale.stamp.runId} ageMs=${now() - stale.enqueuedAt}`,
      );
    }
    if (queue.length === 0) {
      store.delete(key);
      return [];
    }
    return queue;
  }

  return {
    enqueue(cwd: string, stamp: AutomationRunStamp): boolean {
      if (!stamp || !stamp.name || !stamp.runId) return false;
      const key = normalize(cwd);
      const queue = pruneStale(key);
      if (queue.length >= PENDING_AUTOMATION_RUN_CAP) {
        warn(
          `[pending-automation-run-registry] queue cap reached (${PENDING_AUTOMATION_RUN_CAP}) for cwd=${key}; dropping run=${stamp.name}:${stamp.runId}`,
        );
        return false;
      }
      queue.push({ stamp, enqueuedAt: now() });
      store.set(key, queue);
      return true;
    },

    consume(cwd: string): AutomationRunStamp | null {
      const key = normalize(cwd);
      const queue = pruneStale(key);
      if (queue.length === 0) return null;
      const head = queue.shift()!;
      if (queue.length === 0) store.delete(key);
      return head.stamp;
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
