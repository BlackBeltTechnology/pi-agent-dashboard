/**
 * Bounded, `stopped`-protecting retention of the last auto-naming outcome per
 * session.
 *
 * Auto-naming can stop a session permanently with nobody watching: the toast
 * only reaches a subscribed client, so an operator who opens the dashboard
 * later has no way to learn why a session was never named short of reading
 * `server.log`. This map is what the diagnostics surface fetches on mount.
 *
 * Deliberately IN-MEMORY only — a diagnostic readout of the current process's
 * observations, not a record worth surviving a restart (design D9).
 *
 * Two properties are in tension and both are honoured:
 * - the bound is ABSOLUTE (a misconfigured naming model can stop thousands of
 *   sessions, so "protect every stopped entry" would be unbounded), and
 * - protection is a preference ORDER: non-`stopped` entries are evicted first,
 *   and only when `stopped` entries alone reach the bound does the OLDEST
 *   stopped entry go.
 *
 * See change: fix-auto-naming-reasoning-model (design D9, task 9.1).
 */
import type { AutoNameOutcome } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

/** Maximum retained entries. Normative. */
const AUTO_NAME_OUTCOME_BOUND = 500;

export interface RetainedOutcome {
  sessionId: string;
  outcome: AutoNameOutcome;
  reason: string;
  modelRef?: string;
  at: number;
}

export class AutoNameOutcomeStore {
  /** Insertion-ordered (Map preserves it), so the first match is the oldest. */
  private readonly entries = new Map<string, RetainedOutcome>();

  constructor(private readonly bound: number = AUTO_NAME_OUTCOME_BOUND) {}

  /** Retain the latest outcome for a session, replacing any previous one. */
  record(entry: RetainedOutcome): void {
    // Delete first so a re-report moves the session to the newest position;
    // otherwise a repeatedly-reporting session would stay artificially old.
    this.entries.delete(entry.sessionId);
    this.entries.set(entry.sessionId, entry);
    while (this.entries.size > this.bound) this.evictOne();
  }

  private evictOne(): void {
    let oldestStopped: string | undefined;
    for (const [id, e] of this.entries) {
      if (e.outcome !== "stopped") {
        this.entries.delete(id);
        return;
      }
      if (oldestStopped === undefined) oldestStopped = id;
    }
    // Every entry is `stopped` — the bound still wins, oldest goes.
    if (oldestStopped !== undefined) this.entries.delete(oldestStopped);
  }

  list(): RetainedOutcome[] {
    return [...this.entries.values()];
  }

  get(sessionId: string): RetainedOutcome | undefined {
    return this.entries.get(sessionId);
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Process-wide retention, read by the diagnostics request handler. */
export const autoNameOutcomes = new AutoNameOutcomeStore();
