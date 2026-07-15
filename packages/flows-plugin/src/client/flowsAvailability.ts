/**
 * Flow-event probe backing part of flows-plugin's `shouldRenderFlowsSubcard`
 * predicate.
 *
 * The former per-session availability cache (populated from `commandsList` via a
 * module-level subscriber) is retired: the gate now reads live per-session-data
 * + plugin config directly in `shouldRender.ts`, so a mirrored cache is no
 * longer needed. Only the flow-event memo survives here.
 *
 * See change: fix-empty-flows-subcard.
 */
import { getSessionEvents } from "@blackbelt-technology/dashboard-plugin-runtime";
import { isFlowEvent } from "../reducer.js";

// Per-session memo for "has this session seen any flow event?". Keyed on the
// session-events array reference (stable until the next publish) so the scan
// runs only when the event list grows; once true it stays true (flow events
// are append-only). Lets the FLOWS subcard reattach on cold load after replay,
// where the `flowsList`/`commandsList` availability signal is NOT replayed and
// is closed-by-default. See change: replay-persisted-flow-runs (task 5.5).
const flowEventMemo = new Map<string, { ref: readonly unknown[]; has: boolean }>();

/**
 * True when the session's replayed/live event stream contains any `flow_*`
 * event. Synchronous, cheap (ref-memoized + sticky-true), safe to call from
 * the `shouldRenderFlowsSubcard` predicate.
 */
export function sessionHasFlowEvents(sessionId: string): boolean {
  const events = getSessionEvents(sessionId);
  const cached = flowEventMemo.get(sessionId);
  if (cached && (cached.has || cached.ref === events)) return cached.has;
  const has = events.some((e) => isFlowEvent((e as { eventType: string }).eventType));
  flowEventMemo.set(sessionId, { ref: events, has });
  return has;
}

/**
 * Test-only: clear the flow-event memo so cases start from a clean slate.
 *
 * @internal
 */
export function __resetFlowsAvailabilityForTests(): void {
  flowEventMemo.clear();
}
