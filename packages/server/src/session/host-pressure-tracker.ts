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

// The thresholds live in `packages/shared` so the card escalates on exactly the
// numbers the server fires on. Re-exported here so this module stays the
// server's single import site. See change: fix-false-unresponsive-badge.
import {
  type HostPressure,
  HOST_PRESSURE_DEGRADED_MS,
  HOST_PRESSURE_UNRESPONSIVE_MS,
  type HostPressureState,
} from "@blackbelt-technology/pi-dashboard-shared/host-pressure.js";

// The SHAPE lives with the thresholds, for the same reason: `DashboardSession`
// and this module must not describe the verdict twice.
export {
  type HostPressure,
  HOST_PRESSURE_DEGRADED_MS,
  HOST_PRESSURE_UNRESPONSIVE_MS,
  type HostPressureState,
};

export interface HostPressureTrackerDeps {
  /** Fires on every transition. `null` means "recovered — clear the badge". */
  onChange: (sessionId: string, pressure: HostPressure | null) => void;
  degradedMs?: number;
  unresponsiveMs?: number;
}

export interface HostPressureTracker {
  /** Any frame received from a bridge proves its event loop is running. */
  noteFrame(sessionId: string): void;
  /**
   * Forget a session (unregister/disconnect). Emits nothing — but REPORTS
   * whether a verdict was live, so a caller that is ending the signal on a
   * still-LIVE row (carrier loss during the reconnect grace) can broadcast the
   * clear itself instead of stranding the badge.
   */
  clear(sessionId: string): boolean;
  /** Cancel every pending timer (server shutdown). */
  stop(): void;
  /** Tracked-session count — the leak oracle for the exit-path tests (X3). */
  size(): number;
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
      if (!entry) return false;
      cancel(entry);
      entries.delete(sessionId);
      return entry.state !== null;
    },

    stop() {
      for (const entry of entries.values()) cancel(entry);
      entries.clear();
    },

    size() {
      return entries.size;
    },
  };
}
