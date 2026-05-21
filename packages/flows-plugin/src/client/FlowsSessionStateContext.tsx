/**
 * Plugin-internal per-session flow/architect state.
 *
 * Replaces what `packages/client/src/lib/event-reducer.ts` does today
 * for `flowState`, `flowStates`, and `architectState` — but lives
 * inside flows-plugin so the dashboard shell carries no flow knowledge.
 *
 * Wiring:
 *   - `useSessionEvents(sessionId)` (from dashboard-plugin-runtime) is
 *     the only read into shell state. It returns the raw event stream
 *     for the session.
 *   - `useMemo` runs `reduceFlowEvent` and `reduceArchitectEvent` over
 *     the events, producing `{ flowState, flowStates, architectState }`.
 *   - The hook `useFlowsSessionState(sessionId)` returns the derived
 *     state. Components self-gate on null returns.
 *
 * Per-session caching is handled by React's natural per-component
 * memo: each consumer component calls `useFlowsSessionState(session.id)`
 * inside its own render and gets a `useMemo`-stable reference. There
 * is intentionally no shared `Map<sessionId, ...>` because such a cache
 * would either leak (unbounded growth as sessions come and go) or
 * require eviction, neither of which is necessary when the reducer is
 * cheap and React already memoizes per-render.
 *
 * See change: pluginize-flows-via-registry.
 */
import { useMemo } from "react";
import type {
  ArchitectState,
  FlowState,
  DashboardEvent,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useSessionEvents } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  isFlowEvent,
  reduceFlowEvent,
  isArchitectEvent,
  reduceArchitectEvent,
} from "../reducer.js";

/** Shape exposed to flows-plugin components for a single session. */
export interface FlowsSessionState {
  /** The currently-displayed flow's state, or null when no flow is active. */
  flowState: FlowState | null;
  /**
   * All flows seen for this session keyed by `flow.flowName`. Used by
   * components that need to render multiple concurrent flows
   * (FlowDashboard's multi-flow tab bar).
   */
  flowStates: ReadonlyMap<string, FlowState>;
  /** Active architect state, or null when no architect is running. */
  architectState: ArchitectState | null;
}

const EMPTY_STATE: FlowsSessionState = Object.freeze({
  flowState: null,
  flowStates: new Map() as ReadonlyMap<string, FlowState>,
  architectState: null,
});

/**
 * Reduce a session's event stream into flow + architect state. Pure
 * function — no React, no side effects. Exported for tests and for
 * future server-side rendering. The reduction matches the shell's
 * current behavior in `event-reducer.ts` exactly:
 *
 *   - flow events → reduceFlowEvent updates flowState; flowStates is
 *     resynced after each flow event so the active flow is also stored
 *     under its name. `flow_summary_dismissed` clears flowStates.
 *   - architect events → reduceArchitectEvent updates architectState.
 *
 * Iterating the full event stream on every render is fine: the event
 * stream's reference is stable (returned from `useSessionEvents`) and
 * the calling hook is wrapped in `useMemo` keyed on that reference,
 * so the reduction only re-runs when a new event arrives.
 */
export function reduceFlowsSessionState(
  events: readonly DashboardEvent[],
): FlowsSessionState {
  let flowState: FlowState | null = null;
  let architectState: ArchitectState | null = null;
  let flowStates: Map<string, FlowState> = new Map();
  let flowStatesMutated = false;

  // Diagnostic counters for C1 — see fix-flows-plugin-polish. Gated to dev.
  let flowEventCount = 0;
  let architectEventCount = 0;

  for (const event of events) {
    if (isFlowEvent(event.eventType)) {
      flowEventCount++;
      flowState = reduceFlowEvent(flowState, event);
      if (flowState) {
        if (!flowStatesMutated) {
          flowStates = new Map(flowStates);
          flowStatesMutated = true;
        }
        flowStates.set(flowState.flowName, flowState);
      } else if (event.eventType === "flow_summary_dismissed") {
        if (flowStates.size > 0) {
          flowStates = new Map();
          flowStatesMutated = true;
        }
      }
    }
    if (isArchitectEvent(event.eventType)) {
      architectEventCount++;
      architectState = reduceArchitectEvent(architectState, event);
    }
  }

  if (typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    if (flowEventCount > 0 || architectEventCount > 0) {
      // eslint-disable-next-line no-console
      console.debug(
        "[flows] reduceFlowsSessionState",
        {
          totalEvents: events.length,
          flowEvents: flowEventCount,
          architectEvents: architectEventCount,
          resolvedFlowName: flowState?.flowName,
          resolvedFlowStatus: flowState?.status,
          flowsCount: flowStates.size,
          architectPhase: architectState?.phase,
        },
      );
    }
  }

  if (flowState === null && architectState === null && flowStates.size === 0) {
    return EMPTY_STATE;
  }

  return {
    flowState,
    flowStates,
    architectState,
  };
}

/**
 * Hook — derive flow + architect state for a session from its event
 * stream. Result is `useMemo`-stable across renders that don't bring
 * a new event for this session.
 *
 * Plugin components SHALL call this with their `session.id` (from the
 * standard slot prop contract) and self-gate on null returns:
 *
 * ```tsx
 * const { flowState } = useFlowsSessionState(session.id);
 * if (!flowState) return null;
 * ```
 *
 * Returns the frozen `EMPTY_STATE` constant when no flow / architect
 * activity has happened for this session, so the same reference is
 * shared across many same-state renders.
 */
export function useFlowsSessionState(sessionId: string): FlowsSessionState {
  const events = useSessionEvents(sessionId);
  return useMemo(() => reduceFlowsSessionState(events), [events]);
}
