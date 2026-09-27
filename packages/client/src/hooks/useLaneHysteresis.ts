/**
 * Status-lane hysteresis (design D3). A session demoted out of `working`
 * (to `review` / `idle`) stays DISPLAYED in `working` for `holdMs`; if it
 * re-enters `working` within the hold it never moves. Every other transition
 * (incl. promotion to `needs-you` / `error`) applies immediately. The pure
 * `stepLaneHysteresis` carries the logic; the hook only owns the wake timer.
 * See change: session-list-group-by.
 */
import type { StatusLaneId } from "@blackbelt-technology/pi-dashboard-shared/session-group-by.js";
import { useEffect, useMemo, useRef, useState } from "react";

const LANE_HOLD_MS = 3000;

interface LaneHold {
  /** Epoch ms when the hold expires and the card moves to `dest`. */
  until: number;
  dest: StatusLaneId;
}

export interface LaneHysteresisState {
  displayed: Map<string, StatusLaneId>;
  holds: Map<string, LaneHold>;
}

export const EMPTY_HYSTERESIS: LaneHysteresisState = { displayed: new Map(), holds: new Map() };

/** Pure transition: previous state + raw lanes at `now` → next state. */
export function stepLaneHysteresis(
  prev: LaneHysteresisState,
  raw: Map<string, StatusLaneId>,
  now: number,
  holdMs: number = LANE_HOLD_MS,
): LaneHysteresisState {
  const displayed = new Map<string, StatusLaneId>();
  const holds = new Map<string, LaneHold>();
  for (const [id, cur] of raw) {
    const shown = prev.displayed.get(id);
    const demotion = shown === "working" && (cur === "review" || cur === "idle");
    if (!demotion) {
      displayed.set(id, cur);
      continue;
    }
    const until = prev.holds.get(id)?.until ?? now + holdMs;
    if (now >= until) {
      displayed.set(id, cur);
      continue;
    }
    displayed.set(id, "working");
    holds.set(id, { until, dest: cur });
  }
  return { displayed, holds };
}

/** Earliest hold expiry, or `null` when nothing is held. */
function nextHoldWake(state: LaneHysteresisState): number | null {
  let min: number | null = null;
  for (const h of state.holds.values()) if (min === null || h.until < min) min = h.until;
  return min;
}

/**
 * Hook form. `raw` should be referentially stable while lane-relevant fields
 * are unchanged (memoize it on a lane fingerprint), so unrelated session ticks
 * do not step the machine.
 */
export function useLaneHysteresis(raw: Map<string, StatusLaneId>, holdMs: number = LANE_HOLD_MS): LaneHysteresisState {
  const stateRef = useRef<LaneHysteresisState>(EMPTY_HYSTERESIS);
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-steps the machine when a hold expires.
  const state = useMemo(() => {
    const next = stepLaneHysteresis(stateRef.current, raw, Date.now(), holdMs);
    stateRef.current = next;
    return next;
  }, [raw, holdMs, tick]);

  const wake = nextHoldWake(state);
  useEffect(() => {
    if (wake === null) return;
    const timer = setTimeout(() => setTick((t) => t + 1), Math.max(0, wake - Date.now()) + 16);
    return () => clearTimeout(timer);
  }, [wake]);

  return state;
}
