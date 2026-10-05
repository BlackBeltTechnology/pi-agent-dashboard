/**
 * Two-lane, debounced scheduler for the async `git status` probe (change:
 * optimize-polling-hot-paths, D6). Pure: clock and timers are injected.
 *
 * - `request(lane, reason)` records a wish for a probe; it never spawns.
 * - 750 ms trailing debounce, capped (MAX_WAIT) so a steady event stream
 *   cannot starve the probe.
 * - fast lane (branch-affecting events): probe starts ≥ 2 s apart;
 *   slow lane (dirtiness: tick, mutating tool, index events): ≥ 10 s apart.
 *   A request inside its window is deferred to the window's end, never dropped.
 *   A pending fast request upgrades a pending slow one; a fast probe also
 *   satisfies the slow lane's spacing.
 * - One probe in flight; requests meanwhile set a dirty bit → exactly one
 *   follow-up. A probe resolving `"discard"` (HEAD moved / stale result)
 *   requests one more fast probe.
 * - `dispose()` clears the timer; a late settle neither re-arms nor re-requests.
 */

export type ProbeLane = "fast" | "slow";
export type ProbeReason = "tick" | "tool" | "watch" | "refresh";
export type ProbeOutcome = "ok" | "discard" | void;

type Timer = ReturnType<typeof setTimeout>;

export interface GitProbeSchedulerDeps {
  /** Run one probe; never rejects. `"discard"` → run one more fast probe. */
  probe: (info: { lane: ProbeLane; reason: ProbeReason }) => Promise<ProbeOutcome>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
}

export interface GitProbeScheduler {
  request(lane: ProbeLane, reason: ProbeReason): void;
  dispose(): void;
}

const PROBE_DEBOUNCE_MS = 750;
const PROBE_MAX_WAIT_MS = 2_000;
const FAST_LANE_SPACING_MS = 2_000;
const SLOW_LANE_SPACING_MS = 10_000;

interface Pending {
  lane: ProbeLane;
  reason: ProbeReason;
  firstAt: number;
  lastAt: number;
}

export function createGitProbeScheduler(deps: GitProbeSchedulerDeps): GitProbeScheduler {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));

  let disposed = false;
  let inFlight = false;
  let pending: Pending | undefined;
  let timer: Timer | undefined;
  const lastStart = { fast: Number.NEGATIVE_INFINITY, slow: Number.NEGATIVE_INFINITY };

  function schedule(): void {
    if (disposed || inFlight || !pending) return;
    const spacing = pending.lane === "fast" ? FAST_LANE_SPACING_MS : SLOW_LANE_SPACING_MS;
    const debounced = Math.min(pending.lastAt + PROBE_DEBOUNCE_MS, pending.firstAt + PROBE_MAX_WAIT_MS);
    const due = Math.max(debounced, lastStart[pending.lane] + spacing);
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      timer = undefined;
      start().catch(() => {
        /* start() never rejects: the probe contract is non-throwing */
      });
    }, Math.max(0, due - now()));
  }

  async function start(): Promise<void> {
    if (disposed || inFlight || !pending) return;
    const { lane, reason } = pending;
    pending = undefined;
    inFlight = true;
    const t = now();
    lastStart[lane] = t;
    if (lane === "fast") lastStart.slow = t; // a fast probe refreshes status too
    let outcome: ProbeOutcome;
    try {
      outcome = await deps.probe({ lane, reason });
    } catch {
      outcome = undefined; // probe never rejects; defensive
    }
    inFlight = false;
    if (disposed) return;
    if (outcome === "discard") request("fast", "watch");
    else schedule();
  }

  function request(lane: ProbeLane, reason: ProbeReason): void {
    if (disposed) return;
    const t = now();
    if (!pending) {
      pending = { lane, reason, firstAt: t, lastAt: t };
    } else {
      pending.lastAt = t;
      if (lane === "fast" && pending.lane === "slow") {
        pending.lane = "fast";
        pending.reason = reason;
      }
    }
    schedule();
  }

  return {
    request,
    dispose() {
      disposed = true;
      if (timer) clearTimer(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}
