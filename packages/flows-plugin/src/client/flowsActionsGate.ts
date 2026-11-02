/**
 * Actions gate for flows-plugin's `session-card-action-bar` claim
 * (`SessionFlowMenuClaim`). Distinct from the FLOWS-subcard gate in
 * `shouldRender.ts` (flow events only).
 *
 * Open iff pi-flows is active in the session's cwd — a command named `flows` or
 * starting with `flows:` in `commandsList`, the removed `flows:new` alone NOT
 * counting — OR the session has any flow event (live or replayed). Never gates on
 * flow catalog length, so an active-but-empty cwd still offers New / Edit….
 * Closed by default: no `commandsList` published yet → closed.
 *
 * Synchronous and side-effect-free; reads `getSessionData` directly like
 * `shouldRender.ts`.
 *
 * See change: add-session-actions-flyout (D12).
 */
import { getSessionData } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { sessionHasFlowEvents } from "./flowsAvailability.js";

/** True when `commands` carries a `flows` / `flows:*` signal (`flows:new` ignored). */
export function hasFlowsCommand(commands: readonly CommandInfo[] | null | undefined): boolean {
  if (!Array.isArray(commands)) return false;
  return commands.some(
    (c) => c.name !== "flows:new" && (c.name === "flows" || c.name.startsWith("flows:")),
  );
}

/** Whether the flows actions (menu claim) are available for `sessionId`. */
export function flowsActionsAvailable(sessionId: string): boolean {
  return (
    hasFlowsCommand(getSessionData<CommandInfo[]>(sessionId, "commandsList")) ||
    sessionHasFlowEvents(sessionId)
  );
}
