/**
 * Per-session host-pressure tracker: server-side silence verdict, emitted only
 * on a STATE TRANSITION.
 *
 * Why the server owns this: the browser has no way to observe bridge silence.
 * `processMetrics` reaches it once, in the connect `sessions_snapshot`, and is
 * never refreshed — nothing broadcasts it. A client deriving silence from that
 * frozen timestamp reads EVERY live session as unresponsive roughly a minute
 * after page load. The last-frame fact lives here, next to the heartbeat
 * timers, so the verdict is derived here and pushed as a transition.
 *
 * Transition-only keeps the original capability's cost promise: a healthy
 * session costs zero frames, and a pressured one costs two (in, and out).
 * See change: fix-false-unresponsive-badge.
 */

/** Silence past this reads as degraded (≈2 missed 15 s bridge heartbeats). */
export const HOST_PRESSURE_DEGRADED_MS = 35_000;
/** Silence at/after this reads as unresponsive. */
export const HOST_PRESSURE_UNRESPONSIVE_MS = 60_000;

export type HostPressureState = "degraded" | "unresponsive";

export interface HostPressure {
  state: HostPressureState;
  /** Server receipt time of the last frame — the anchor the pill counts from. */
  since: number;
}

export interface HostPressureTrackerDeps {
  /** Fires on every transition. `null` means "recovered — clear the badge". */
  onChange: (sessionId: string, pressure: HostPressure | null) => void;
  degradedMs?: number;
  unresponsiveMs?: number;
}

export interface HostPressureTracker {
  /** Any frame received from a bridge proves its event loop is running. */
  noteFrame(sessionId: string): void;
  /** Forget a session (unregister/disconnect). Emits nothing. */
  clear(sessionId: string): void;
  /** Cancel every pending timer (server shutdown). */
  stop(): void;
}

interface Entry {
  since: number;
  state: HostPressureState | null;
  timers: ReturnType<typeof setTimeout>[];
}

export function createHostPressureTracker(deps: HostPressureTrackerDeps): HostPressureTracker {
  const degradedMs = deps.degradedMs ?? HOST_PRESSURE_DEGRADED_MS;
  const unresponsiveMs = deps.unresponsiveMs ?? HOST_PRESSURE_UNRESPONSIVE_MS;
  const entries = new Map<string, Entry>();

  function cancel(entry: Entry) {
    for (const t of entry.timers) clearTimeout(t);
    entry.timers = [];
  }

  function arm(sessionId: string, entry: Entry) {
    const fire = (state: HostPressureState) => {
      entry.state = state;
      deps.onChange(sessionId, { state, since: entry.since });
    };
    entry.timers = [
      setTimeout(() => fire("degraded"), degradedMs),
      setTimeout(() => fire("unresponsive"), unresponsiveMs),
    ];
  }

  return {
    noteFrame(sessionId) {
      const existing = entries.get(sessionId);
      if (existing) {
        cancel(existing);
        if (existing.state !== null) {
          existing.state = null;
          deps.onChange(sessionId, null);
        }
        existing.since = Date.now();
        arm(sessionId, existing);
        return;
      }
      const entry: Entry = { since: Date.now(), state: null, timers: [] };
      entries.set(sessionId, entry);
      arm(sessionId, entry);
    },

    clear(sessionId) {
      const entry = entries.get(sessionId);
      if (!entry) return;
      cancel(entry);
      entries.delete(sessionId);
    },

    stop() {
      for (const entry of entries.values()) cancel(entry);
      entries.clear();
    },
  };
}
