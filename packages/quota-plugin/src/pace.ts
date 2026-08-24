/**
 * Burn-rate / pace math for a single quota window — shared, pure, unit-tested.
 *
 * A raw "45% used" number is not actionable: 45% at hour 1 of a 5h window is a
 * fire; 45% at hour 4 is fine. This derives whether usage is outrunning the
 * clock (`projected`) and a `now` tick marking elapsed fraction of the window.
 *
 * ALL guards return BEFORE any division so the result never carries
 * `Infinity`/`NaN` and never raises a spurious warning. See design.md
 * "Burn-rate / pace (client-side, safe math)".
 */

/** Below this elapsed fraction a window has effectively just reset — pace is not yet meaningful. */
export const PACE_EPS = 0.01;

/** Projected-final threshold above which a window is treated as critically over pace. */
const CRITICAL_PROJECTED = 150;
/** Absolute utilization above which a window is red regardless of pace. */
const CRITICAL_USED_PERCENT = 90;

type PaceState = "unavailable" | "stale" | "ok";
export type PaceSeverity = "muted" | "green" | "orange" | "red";

export interface QuotaWindowInput {
  usedPercent: number;
  /** ISO timestamp string. */
  resetsAt: string;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface Pace {
  state: PaceState;
  /** `now` tick position, 0..100 (% of the track). `null` when unavailable/stale. */
  elapsedPercent: number | null;
  /** Projected final utilization if the current rate holds. `null` when unavailable/stale. */
  projected: number | null;
  /** `max(0, projected - 100)`. `null` when unavailable/stale. */
  overage: number | null;
  /** True only when `projected >= 100` (on track to exhaust before reset). */
  warn: boolean;
  severity: PaceSeverity;
}

const UNAVAILABLE: Pace = {
  state: "unavailable",
  elapsedPercent: null,
  projected: null,
  overage: null,
  warn: false,
  severity: "muted",
};

/**
 * Compute the pace signal for a window. `now` is epoch ms (injectable for tests).
 */
export function computePace(win: QuotaWindowInput, now: number = Date.now()): Pace {
  const { usedPercent, windowSeconds } = win;

  // Guard: caller-supplied clock must be a finite epoch (a NaN `now` would
  // propagate through every subtraction/division).
  if (!Number.isFinite(now)) return UNAVAILABLE;

  // Guard: window length must be a positive finite number.
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return UNAVAILABLE;

  // Guard: reset timestamp must be a finite parse.
  const resetMs = Date.parse(win.resetsAt);
  if (!Number.isFinite(resetMs)) return UNAVAILABLE;

  const secondsToReset = (resetMs - now) / 1000;

  // Stale: the reset moment is already in the past. Grey, never "on pace".
  if (secondsToReset <= 0) {
    return { state: "stale", elapsedPercent: null, projected: null, overage: null, warn: false, severity: "muted" };
  }

  const elapsedRaw = (windowSeconds - secondsToReset) / windowSeconds;

  // Guard: window just reset — no meaningful elapsed fraction to divide by yet.
  if (elapsedRaw <= PACE_EPS) return UNAVAILABLE;

  const elapsed = Math.min(elapsedRaw, 1);
  const used = Number.isFinite(usedPercent) ? Math.max(0, usedPercent) : 0;
  const projected = used / elapsed;
  const overage = Math.max(0, projected - 100);

  const severity: PaceSeverity =
    projected >= CRITICAL_PROJECTED || used >= CRITICAL_USED_PERCENT
      ? "red"
      : projected >= 100
        ? "orange"
        : "green";

  return {
    state: "ok",
    elapsedPercent: elapsed * 100,
    projected,
    overage,
    warn: projected >= 100,
    severity,
  };
}

/** Short tooltip label: `over by X%` when warning, `on pace` when green, else a neutral state. */
export function paceLabel(pace: Pace): string {
  switch (pace.state) {
    case "unavailable":
      return "pace unavailable";
    case "stale":
      return "reset pending";
    case "ok":
      return pace.warn ? `over by ${Math.round(pace.overage ?? 0)}%` : "on pace";
  }
}
