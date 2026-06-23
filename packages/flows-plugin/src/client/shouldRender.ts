/**
 * Manifest-level `shouldRender` callback for flows-plugin's
 * `session-card-flows` claim (`SessionFlowActionsClaim`).
 *
 * Returns `false` when the session has no flows AND no `flows:new` command.
 * The shell's `FlowsSubcard` wrapper gates on `useSlotHasClaimsForSession`,
 * which consults this predicate, so the subcard hides cleanly when there's
 * nothing to render.
 *
 * Must be synchronous (manifest-level `shouldRender` contract). Reads from the
 * sync cache populated by the module-level subscriber installed at plugin
 * registration (`installFlowsAvailabilitySubscriber`). Default is `false`
 * (closed-by-default) until the first `flowsList` or `commandsList` publish
 * arrives for the session — prevents flicker on cold boot.
 *
 * See change: add-flows-subcard.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getFlowsAvailabilitySync, sessionHasFlowEvents } from "./flowsAvailability.js";

export function shouldRenderFlowsSubcard(
  session: DashboardSession | null | undefined,
): boolean {
  if (!session) return false;
  // Available flows (live `flowsList`/`commandsList`) OR a flow already ran in
  // this session (replayed/live flow events). The latter keeps the subcard
  // visible on cold load when the availability signal has not been re-published.
  // See change: replay-persisted-flow-runs (task 5.5).
  return getFlowsAvailabilitySync(session.id) || sessionHasFlowEvents(session.id);
}
