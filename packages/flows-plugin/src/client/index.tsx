/**
 * Client entry barrel for the flows plugin.
 *
 * Re-exports every flow-related React component so the dashboard shell
 * can import them via `@blackbelt-technology/pi-dashboard-flows-plugin/client`.
 *
 * Also exports the `hasActiveFlow` predicate consumed by the
 * `pi-dashboard-plugin` manifest's `session-card-badge` claim.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export { FlowDashboard } from "./FlowDashboard.js";
export { FlowAgentCard } from "./FlowAgentCard.js";
export { FlowAgentDetail } from "./FlowAgentDetail.js";
export { FlowSummary } from "./FlowSummary.js";
export { FlowGraph, flowStateToGraphSteps, architectStepsToGraphSteps, computeLayout } from "./FlowGraph.js";
export { FlowArchitect, FlowArchitectDetail, ArchitectInputPrompt } from "./FlowArchitect.js";
export { FlowActivityBadge } from "./FlowActivityBadge.js";
export { FlowLaunchDialog } from "./FlowLaunchDialog.js";
export { FlowTabBar } from "./FlowTabBar.js";
export { SessionFlowActions } from "./SessionFlowActions.js";

/**
 * Predicate for the `session-card-badge` slot claim.
 * The slot consumer skips claims whose predicate returns false.
 */
export function hasActiveFlow(session: DashboardSession): boolean {
  return Boolean(session.activeFlowName);
}
