/**
 * Pending-prompt desync detector (design D10 of
 * fix-pending-prompt-lost-on-replay).
 *
 * When a session is reported as blocked on `ask_user` but the client holds no
 * interactive request for it, the view is desynced: the agent waits on an
 * answer the user cannot see. The boolean decision is a PURE function over a
 * plain input object (directly unit-testable, test-plan #E14); only the
 * condition-held timer lives in a small hook (#E15).
 *
 * Gates — the affordance is true only when ALL hold:
 *   - `currentTool === "ask_user"`, AND
 *   - no `pending` entry in `interactiveRequests`, AND
 *   - session NOT ended, AND
 *   - no replay in flight, AND
 *   - the condition held continuously for PROMPT_DESYNC_GRACE_MS.
 *
 * The grace period covers the normal `tool_execution_start(ask_user)` →
 * `prompt_request` window (and the answer → `tool_execution_end` transient)
 * with margin, so a healthy session never surfaces the affordance. The
 * replay-in-flight flag has a 15 s safety timer that can expire mid-replay on
 * very large sessions — the grace period, not that flag alone, carries the
 * guarantee.
 */
import { useEffect, useReducer, useState } from "react";

/** How long the desync condition must hold before the affordance surfaces. */
export const PROMPT_DESYNC_GRACE_MS = 5000;

/** The four instantaneous gates (everything but the held-duration). */
export interface PromptDesyncGates {
  /** The session's reported current tool, e.g. `"ask_user"`. */
  currentTool?: string;
  /** True when `interactiveRequests` holds a `pending` entry for the session. */
  hasPendingInteractiveRequest: boolean;
  /** Reduced session status; `"ended"` suppresses the affordance. */
  status: "idle" | "streaming" | "ended";
  /** The client's replay-in-flight flag for the session. */
  replayInFlight: boolean;
}

/** Gates + how long they have held continuously. */
export interface PromptDesyncInput extends PromptDesyncGates {
  heldMs: number;
}

/** The four instantaneous gates, ignoring the grace period. */
export function promptDesyncCondition(gates: PromptDesyncGates): boolean {
  return (
    gates.currentTool === "ask_user" &&
    !gates.hasPendingInteractiveRequest &&
    gates.status !== "ended" &&
    !gates.replayInFlight
  );
}

/**
 * Derive the gates straight off a reduced `SessionState` + the client's
 * replay-in-flight flag, so component bodies carry no ad-hoc predicate.
 */
export function promptDesyncGatesFromState(
  state: {
    currentTool?: string;
    interactiveRequests: ReadonlyArray<{ status: string }>;
    status: "idle" | "streaming" | "ended";
  },
  replayInFlight: boolean,
): PromptDesyncGates {
  return {
    currentTool: state.currentTool,
    hasPendingInteractiveRequest: state.interactiveRequests.some((r) => r.status === "pending"),
    status: state.status,
    replayInFlight,
  };
}

/** The full decision: gates hold AND they have held for the grace period. */
export function isPromptDesync(input: PromptDesyncInput): boolean {
  return promptDesyncCondition(input) && input.heldMs >= PROMPT_DESYNC_GRACE_MS;
}

/**
 * Tracks how long the desync condition has held and surfaces the affordance
 * once it passes the grace period. Every failing gate RESETS the timer (a
 * replay that starts at 4.9 s zeroes the clock; when it ends, the full grace
 * period must elapse again).
 *
 * `scope` (e.g. the session id) additionally resets the clock when it CHANGES:
 * `<ChatView>` is rendered without a `key`, so its instance is reused across
 * session switches and a grace period earned against session A must not
 * surface the affordance on session B — the same cross-session bleed the
 * replay pill guards against.
 */
export function usePromptDesync(gates: PromptDesyncGates, scope?: string): boolean {
  const conditionHolds = promptDesyncCondition(gates);
  const [heldSince, setHeldSince] = useState<number | null>(null);
  const [trackedScope, setTrackedScope] = useState(scope);
  // Re-render when the grace boundary is crossed, so the affordance appears
  // without any input change.
  const [, tick] = useReducer((n: number) => n + 1, 0);

  // Adopt a changed scope DURING RENDER (React's adjust-state-on-prop-change
  // pattern), not in an effect. An effect runs post-paint, so one committed
  // frame could still report session A's earned grace for session B. The new
  // session's grace starts FRESH at the switch.
  if (scope !== trackedScope) {
    setTrackedScope(scope);
    setHeldSince(conditionHolds ? Date.now() : null);
  }

  // Reset on every failing gate; start the clock once on the rising edge.
  useEffect(() => {
    setHeldSince((prev) => (conditionHolds ? (prev ?? Date.now()) : null));
  }, [conditionHolds]);

  useEffect(() => {
    if (heldSince === null) return;
    const remaining = PROMPT_DESYNC_GRACE_MS - (Date.now() - heldSince);
    if (remaining <= 0) return;
    // ONE timeout for the grace boundary, not a repeating 250 ms interval:
    // after the boundary the value is true and stays true until a gate drops,
    // so a tick would burn renders for nothing.
    const id = setTimeout(() => tick(), remaining + 1);
    return () => clearTimeout(id);
  }, [heldSince]);

  if (!conditionHolds || heldSince === null) return false;
  return Date.now() - heldSince >= PROMPT_DESYNC_GRACE_MS;
}
