/**
 * In-memory FIFO queue of pending automation-run stamps per cwd — sibling
 * to `pending-worktree-base-registry.ts`, same lifecycle semantics.
 *
 * Lifecycle:
 *   1. The automation-plugin's scheduler fires a trigger and spawns a run
 *      session via the `ServerPluginContext` spawn hook → server enqueues
 *      the run stamp keyed by the run's cwd (worktree or repo root).
 *   1b. Once `spawnPiSession` resolves, the hook calls `bindToken(cwd, runId,
 *      spawnToken)` so the queued stamp knows WHICH spawn owns it. Enqueue must
 *      still happen BEFORE the spawn resolves — a fast bridge can register first.
 *   2. Bridge later issues `session_register { sessionId, cwd, spawnToken? }` →
 *      server claims the stamp for that cwd and:
 *        a. stamps `DashboardSession.kind="automation"` + `automationRun`,
 *        b. persists both to the session's `.meta.json` sidecar so the
 *           classification survives server restart.
 *
 * Claim resolution is TWO-TIER (see change: fix-automation-stamp-correlation):
 *   1. exact `spawnToken` match anywhere in the cwd queue;
 *   2. else the oldest entry with NO bound token.
 * A token-bound entry is never claimable by a foreign token nor by tier 2.
 * Plain cwd-FIFO was provenance-blind: several first-party plugins spawn
 * stamped sessions into the SAME cwd, so the queue interleaved owners and a
 * registering session could take another spawn's `runId`. Its owner plugin then
 * failed to correlate the stamp and never delivered the action, wedging the run
 * `running` until the max-age reaper.
 *
 * Constraints mirror `pending-worktree-base-registry`:
 *  - FIFO per cwd (within the unbound tier), capped at 8 entries.
 *  - 60 s TTL; stale entries dropped on every touch.
 *  - Cwd normalized via `safeRealpathSync` + trailing-sep strip.
 *  - In-memory only.
 *
 * See change: add-automation-plugin, fix-automation-stamp-correlation.
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
  /** Spawn correlation token of the process this stamp belongs to, once known. */
  spawnToken?: string;
}

export const PENDING_AUTOMATION_RUN_TTL_MS = 60_000;
export const PENDING_AUTOMATION_RUN_CAP = 8;

export interface PendingAutomationRunRegistry {
  enqueue(cwd: string, stamp: AutomationRunStamp): boolean;
  /**
   * Bind an already-queued stamp to the spawn token of the process that owns
   * it. Returns false when the run is unknown for that cwd (already claimed or
   * TTL-pruned). Idempotent per runId.
   */
  bindToken(cwd: string, runId: string, spawnToken: string): boolean;
  /**
   * Claim a stamp for a registering session. `spawnToken` is the token the
   * bridge echoed on its first `session_register`; when it matches a bound
   * entry that entry is claimed, else the oldest UNBOUND entry is claimed.
   */
  consume(cwd: string, spawnToken?: string): AutomationRunStamp | null;
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

    bindToken(cwd: string, runId: string, spawnToken: string): boolean {
      if (!runId || !spawnToken) return false;
      const key = normalize(cwd);
      const queue = pruneStale(key);
      const entry = queue.find((e) => e.stamp.runId === runId);
      if (!entry) return false;
      entry.spawnToken = spawnToken;
      return true;
    },

    consume(cwd: string, spawnToken?: string): AutomationRunStamp | null {
      const key = normalize(cwd);
      const queue = pruneStale(key);
      if (queue.length === 0) return null;
      // Tier 1: exact owner. Tier 2: oldest entry whose owner is not yet known
      // (spawn still resolving, or a spawn path that mints no token).
      let index = spawnToken ? queue.findIndex((e) => e.spawnToken === spawnToken) : -1;
      if (index < 0) index = queue.findIndex((e) => e.spawnToken === undefined);
      if (index < 0) return null;
      const [claimed] = queue.splice(index, 1);
      if (queue.length === 0) store.delete(key);
      return claimed!.stamp;
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
