/**
 * Manifest-level `shouldRender` callback for flows-plugin's
 * `session-card-flows` claim (`SessionFlowActionsClaim`).
 *
 * Returns the SAME boolean the claim uses to decide it renders content:
 * `flowsList non-empty OR edit mode on OR a flow event exists`. This keeps the
 * subcard's visibility gate and the claim's render condition in lockstep, so the
 * shell's `FlowsSubcard` wrapper (which gates on `useSlotHasClaimsForSession`,
 * consulting this predicate) never paints an empty panel when the claim would
 * render `null`.
 *
 * Must be synchronous and side-effect-free (manifest-level `shouldRender`
 * contract). Reads live per-session-data (`getSessionData`) + plugin config
 * (`getPluginConfig`) directly — the same synchronous sources the claim reads —
 * instead of a mirrored availability cache. Closed-by-default holds: on cold
 * boot `flowsList` is empty, edit mode off, no events → `false` → hidden, then
 * visible once flows populate (the acceptable hidden→visible direction).
 *
 * See change: fix-empty-flows-subcard.
 */
import { getSessionData } from "@blackbelt-technology/dashboard-plugin-runtime";
import { getPluginConfig } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { sessionHasFlowEvents } from "./flowsAvailability.js";

export function shouldRenderFlowsSubcard(
  session: DashboardSession | null | undefined,
): boolean {
  if (!session) return false;
  const flows = getSessionData<FlowInfo[]>(session.id, "flowsList");
  const editMode = (getPluginConfig("flows") as { editFlow?: boolean }).editFlow ?? false;
  return (
    (Array.isArray(flows) && flows.length > 0) ||
    editMode ||
    sessionHasFlowEvents(session.id)
  );
}
