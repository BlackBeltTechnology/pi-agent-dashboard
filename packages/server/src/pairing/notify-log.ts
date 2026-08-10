/**
 * Bounded per-session notify log.
 *
 * Deliberately distinct from `pendingPromptRequests`: a notify is transcript
 * history, not an unanswered ask. This log MUST NEVER feed
 * `hasPendingPromptRequests`, the embed-lifecycle `hasPendingAsk` union, or the
 * `currentTool` derivation — an ended session keeps its rows and stays reapable
 * because the reaper never reads this store.
 *
 * Retention: entries survive session end (Contract 2 — a transcript row visible
 * while the session was alive must not vanish after it ends). Bounded to
 * `NOTIFY_LOG_CAP` entries per session, oldest evicted first.
 *
 * See change: split-notify-from-prompt-request.
 */
import { normalizeNotifyLevel } from "@blackbelt-technology/pi-dashboard-shared/notify.js";
import type { NotifyLogEntry } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Max retained notifications per session. Oldest evicted first. */
export const NOTIFY_LOG_CAP = 50;

/** Silent-loss counters for the cap. Mirrors the `storeTrim` health surface. */
export interface NotifyLogStats {
  /** Entries dropped by the cap, all sessions. */
  evictedEntries: number;
  /** Entries dropped per session (only sessions that ever evicted). */
  bySession: Record<string, number>;
}

export interface NotifyLog {
  /** Append one entry, evicting the oldest past the cap. Returns the new list. */
  append(sessionId: string, entry: NotifyLogEntry): NotifyLogEntry[];
  /** Entries for a session, oldest first. Empty when none. */
  get(sessionId: string): NotifyLogEntry[];
  /** Seed a session's entries (cold hydration from the persisted record). */
  hydrate(sessionId: string, entries: readonly NotifyLogEntry[]): void;
  /** True when the session has no entries in memory. */
  isEmpty(sessionId: string): boolean;
  /** Eviction counters for `/api/health`. */
  getStats(): NotifyLogStats;
}

/**
 * Normalize a pre-split bridge's `prompt_request { prompt.type: "notify" }`
 * into a notify entry. An already-published bridge carries the message and an
 * unvalidated `level` in `component.props`, and the new send-site normalization
 * cannot retro-fix it — so the server owns this normalization.
 * See change: split-notify-from-prompt-request (Decision 2).
 */
export function fromLegacyPromptRequest(msg: Record<string, unknown>): NotifyLogEntry {
  const props = ((msg.component as Record<string, unknown> | undefined)?.props ??
    {}) as Record<string, unknown>;
  const prompt = (msg.prompt ?? {}) as Record<string, unknown>;
  const message =
    typeof props.message === "string"
      ? props.message
      : typeof prompt.question === "string"
        ? prompt.question
        : "";
  return {
    notifyId: typeof msg.promptId === "string" ? msg.promptId : crypto.randomUUID(),
    message,
    level: normalizeNotifyLevel(props.level),
  };
}

export function createNotifyLog(cap: number = NOTIFY_LOG_CAP): NotifyLog {
  const logs = new Map<string, NotifyLogEntry[]>();
  // Eviction is silent transcript loss — count it rather than drop it blind.
  const evictedBySession = new Map<string, number>();

  return {
    append(sessionId, entry) {
      const list = logs.get(sessionId) ?? [];
      list.push(entry);
      if (list.length > cap) {
        const dropped = list.length - cap;
        list.splice(0, dropped);
        evictedBySession.set(sessionId, (evictedBySession.get(sessionId) ?? 0) + dropped);
      }
      logs.set(sessionId, list);
      return list;
    },
    get(sessionId) {
      return logs.get(sessionId) ?? [];
    },
    hydrate(sessionId, entries) {
      const list = entries.slice(-cap);
      logs.set(sessionId, list);
    },
    isEmpty(sessionId) {
      return (logs.get(sessionId)?.length ?? 0) === 0;
    },
    getStats() {
      let evictedEntries = 0;
      for (const n of evictedBySession.values()) evictedEntries += n;
      return { evictedEntries, bySession: Object.fromEntries(evictedBySession) };
    },
  };
}
