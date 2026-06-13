/**
 * Shared goal-plugin types — used by the bridge entry (producer), the server
 * entry (cache + broadcast), and the client (reducer + chip).
 *
 * The bridge entry normalizes the `@ricoyudog/pi-goal-hermes` extension's
 * `pi-goal-hermes:event` custom-message `details` into the clean
 * `GoalStatusSnapshot` below. Nothing here depends on pi/TUI types.
 *
 * See change: add-goal-continuation-plugin.
 */

/** Stable goal lifecycle status surfaced in the dashboard. */
export type GoalStatus = "active" | "paused" | "done" | "cleared";

/** Clean per-session snapshot the chip + control read. */
export interface GoalStatusSnapshot {
  status: GoalStatus;
  /** The standing objective text. */
  goal: string;
  /** Continuation turns consumed so far. */
  turnsUsed: number;
  /** Turn budget (extension default 20). */
  maxTurns: number;
  /** Last judge verdict string, when known. */
  lastVerdict: string | null;
  /** Pause reason (budget / reload / interrupted / error), when paused. */
  lastReason: string | null;
}

/**
 * `details` shape of the extension's `pi-goal-hermes:event` custom messages.
 * Mirrors `GoalEventDetails` in @ricoyudog/pi-goal-hermes event-renderer.ts.
 */
export interface GoalHermesEventDetails {
  eventType:
    | "goal-set"
    | "goal-continuing"
    | "goal-achieved"
    | "goal-paused"
    | "goal-resumed"
    | "goal-cleared";
  goal: string;
  status: string;
  turnsUsed: number;
  maxTurns: number;
  lastVerdict: string | null;
  lastReason: string | null;
  pausedReason: string | null;
}

/** Plugin identity + handler-key constants shared across entries. */
export const GOAL_PLUGIN_ID = "goal";
/** registerPiHandler key for the bridge-mirrored snapshot. */
export const GOAL_STATUS_MESSAGE = "goal_status";
/** customType emitted by the @ricoyudog/pi-goal-hermes extension. */
export const GOAL_HERMES_EVENT_CUSTOM_TYPE = "pi-goal-hermes:event";
/** Synthetic dashboard event type the client reducer folds. */
export const GOAL_STATUS_EVENT_TYPE = "goal_status";

/** Map an extension event's `details` to a clean snapshot. */
export function detailsToSnapshot(d: GoalHermesEventDetails): GoalStatusSnapshot {
  const status: GoalStatus =
    d.eventType === "goal-achieved"
      ? "done"
      : d.eventType === "goal-paused"
        ? "paused"
        : d.eventType === "goal-cleared"
          ? "cleared"
          : "active"; // goal-set / goal-continuing / goal-resumed
  return {
    status,
    goal: d.goal,
    turnsUsed: d.turnsUsed,
    maxTurns: d.maxTurns,
    lastVerdict: d.lastVerdict,
    lastReason: d.pausedReason ?? d.lastReason,
  };
}
