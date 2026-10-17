/**
 * Manifest-level `shouldRender` callback for flows-plugin's
 * `session-card-flows` claim (`SessionFlowActionsClaim`).
 *
 * The FLOWS subcard carries flow STATUS only, so it renders IFF the session has
 * any flow event (live or replayed). It no longer depends on `flowsList`, edit
 * mode or extension presence — those gate the flow ACTIONS, which live in the
 * `session-card-action-bar` claim (see `flowsActionsGate.ts`).
 *
 * Must be synchronous and side-effect-free (manifest-level `shouldRender`
 * contract). Reads the live event stream directly via `sessionHasFlowEvents`.
 *
 * See change: fix-empty-flows-subcard, add-session-actions-flyout.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { sessionHasFlowEvents } from "./flowsAvailability.js";

export function shouldRenderFlowsSubcard(
  session: DashboardSession | null | undefined,
): boolean {
  if (!session) return false;
  return sessionHasFlowEvents(session.id);
}
