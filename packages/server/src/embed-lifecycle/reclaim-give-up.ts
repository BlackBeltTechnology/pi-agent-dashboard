/**
 * Bounded retry for failed unattended reclaims — shared by the idle reaper and
 * the caps gate so a wedged process is never re-attempted forever.
 *
 * `recordFailure` counts CONSECUTIVE failed attempts per session (not sweeps):
 * a session is given up at N = 3, or immediately for `no-identity` /
 * `refused-identity` (neither changes without new information). The count
 * resets only via `clear` (confirmed termination) or `prune` (session no longer
 * listed) — an ineligible sweep makes no attempt and so does not reset it.
 *
 * See change: fix-session-reclaim-tmux (design D4).
 */
import type { TerminateOutcome } from "../spawn-process/session-terminator.js";

/** Consecutive failed attempts before a session is given up. */
const RECLAIM_GIVE_UP_AFTER = 3;

export interface ReclaimGiveUpTracker {
  /** Record a failed attempt. Returns `true` only on the call that crosses into given-up. */
  recordFailure: (sessionId: string, outcome: TerminateOutcome) => boolean;
  isGivenUp: (sessionId: string) => boolean;
  /** Forget a session (confirmed termination). */
  clear: (sessionId: string) => void;
  /** Forget every tracked session not in `liveIds`. */
  prune: (liveIds: ReadonlySet<string>) => void;
}

export function createReclaimGiveUpTracker(): ReclaimGiveUpTracker {
  const failures = new Map<string, number>();
  const givenUp = new Set<string>();

  return {
    recordFailure(sessionId, outcome) {
      if (givenUp.has(sessionId)) return false;
      const count = (failures.get(sessionId) ?? 0) + 1;
      failures.set(sessionId, count);
      const immediate = outcome === "no-identity" || outcome === "refused-identity";
      if (immediate || count >= RECLAIM_GIVE_UP_AFTER) {
        givenUp.add(sessionId);
        return true;
      }
      return false;
    },
    isGivenUp: (sessionId) => givenUp.has(sessionId),
    clear(sessionId) {
      failures.delete(sessionId);
      givenUp.delete(sessionId);
    },
    prune(liveIds) {
      for (const id of [...failures.keys()]) if (!liveIds.has(id)) failures.delete(id);
      for (const id of [...givenUp]) if (!liveIds.has(id)) givenUp.delete(id);
    },
  };
}
