/**
 * Bridge-side drain of non-message usage entries (design D2).
 *
 * pi records model-attributed usage that is not an assistant message as
 * session entries: `usage` entries (cache warming, …) and the `usage` of
 * compaction / branch-summary entries. pi dispatches no event for them to
 * extensions, so the bridge reads `ctx.sessionManager.getEntries()` past a
 * cursor `{ sessionId, lastEntryId }` at its drain points (`turn_end`,
 * `agent_settled`, `cache_warming_decision`, `session_shutdown`) and forwards
 * each allowlisted entry as a `usage_recorded` message.
 *
 * Invariants:
 * - Baseline + seed share ONE snapshot: `baseline()` sets the cursor to the
 *   snapshot's last entry and returns that snapshot's full totals (every kind)
 *   — the `usageSeed` sent with `session_register`. Nothing in the snapshot is
 *   ever forwarded.
 * - Keyed by session id, not session-file path (pi creates the file lazily).
 * - A reconnect never touches the cursor.
 * - A vanished `lastEntryId` (or a different session id) re-baselines and
 *   forwards nothing; no seed is resent.
 * - Message entries are never forwarded (tool-result usage's live source is
 *   the forwarded `message_end`).
 *
 * See change: count-non-message-usage.
 */
import type { UsageRecordedMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import {
  drainableEntryUsage,
  sumEntryUsage,
  type UsageTotals,
} from "@blackbelt-technology/pi-dashboard-shared/usage-totals.js";

/** The slice of pi's `ReadonlySessionManager` the drain reads. */
export interface DrainSessionManager {
  getSessionId(): string;
  getEntries(): readonly unknown[];
}

interface Cursor {
  sessionId: string;
  lastEntryId: string | null;
}

function lastIdOf(entries: readonly unknown[]): string | null {
  const last = entries[entries.length - 1] as { id?: unknown } | undefined;
  return typeof last?.id === "string" ? last.id : null;
}

export class UsageDrain {
  private cursor: Cursor | null = null;

  /**
   * Take one `getEntries()` snapshot, move the cursor to its end, and return
   * its full usage totals (the `usageSeed`).
   */
  baseline(sm: DrainSessionManager): UsageTotals {
    const entries = sm.getEntries();
    this.cursor = { sessionId: sm.getSessionId(), lastEntryId: lastIdOf(entries) };
    return sumEntryUsage(entries);
  }

  /** Cursor snapshot (tests / diagnostics). */
  getCursor(): Readonly<Cursor> | null {
    return this.cursor ? { ...this.cursor } : null;
  }

  /**
   * Collect the `usage_recorded` messages for allowlisted usage-bearing entries
   * appended after the cursor, then advance it. One `getEntries()` copy plus a
   * reverse scan to `lastEntryId`.
   */
  drain(sm: DrainSessionManager): UsageRecordedMessage[] {
    const sessionId = sm.getSessionId();
    const entries = sm.getEntries();
    const cursor = this.cursor;
    if (!cursor || cursor.sessionId !== sessionId) {
      this.cursor = { sessionId, lastEntryId: lastIdOf(entries) };
      return [];
    }
    let start = 0;
    if (cursor.lastEntryId !== null) {
      start = -1;
      for (let i = entries.length - 1; i >= 0; i--) {
        if ((entries[i] as { id?: unknown } | undefined)?.id === cursor.lastEntryId) {
          start = i + 1;
          break;
        }
      }
      if (start === -1) {
        // The last forwarded entry is gone (tree rewrite): re-baseline, forward nothing.
        this.cursor = { sessionId, lastEntryId: lastIdOf(entries) };
        return [];
      }
    }
    const out: UsageRecordedMessage[] = [];
    for (let i = start; i < entries.length; i++) {
      const entry = entries[i] as { id?: unknown };
      const u = drainableEntryUsage(entry);
      if (!u) continue;
      out.push({
        type: "usage_recorded",
        sessionId,
        kind: u.kind,
        usage: u.usage,
        ...(u.provider !== undefined ? { provider: u.provider } : {}),
        ...(u.model !== undefined ? { model: u.model } : {}),
        ...(typeof entry.id === "string" ? { entryId: entry.id } : {}),
      });
    }
    if (start < entries.length) cursor.lastEntryId = lastIdOf(entries);
    return out;
  }
}

/**
 * Drain and send. Never throws: a drain point must not disturb the pi event it
 * piggybacks on (`cache_warming_decision` in particular).
 */
export function drainUsageAndSend(
  drain: UsageDrain,
  sm: DrainSessionManager | undefined | null,
  send: (msg: UsageRecordedMessage) => void,
): void {
  try {
    if (!sm) return;
    for (const msg of drain.drain(sm)) send(msg);
  } catch (err) {
    console.error("[dashboard] usage drain failed:", err);
  }
}

/**
 * Observe-only `cache_warming_decision` handler: a drain point that returns
 * no decision override (`undefined`), so pi applies its own `warm`/`stop`.
 * Synchronous and self-guarded — never throws back into pi.
 */
export function makeCacheWarmingDecisionHandler(runDrain: (ctx: unknown) => void) {
  return (_event: unknown, ctx: unknown): undefined => {
    try {
      runDrain(ctx);
    } catch (err) {
      console.error("[dashboard] cache_warming_decision drain failed:", err);
    }
    return undefined;
  };
}

/**
 * Shutdown ordering: flush undrained usage for the outgoing session BEFORE its
 * `session_unregister` (which ends the session server-side and drives the
 * final sidecar write), on the same socket.
 */
export function sendShutdownUsageThenUnregister(
  runDrain: () => void,
  sendUnregister: () => void,
): void {
  try {
    runDrain();
  } catch (err) {
    console.error("[dashboard] shutdown usage drain failed:", err);
  }
  sendUnregister();
}
