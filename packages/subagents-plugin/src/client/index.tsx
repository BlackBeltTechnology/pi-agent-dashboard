/**
 * Client entry for @blackbelt-technology/pi-dashboard-subagents-plugin.
 *
 * Re-exports the subagent inspector components, types, and timeline-entry
 * helpers so the shell can import them via a single package path.
 *
 * Phase 1 (this change — add-subagent-inspector / WIP):
 *   - Exports SubagentDetailView, SubagentPopoutPage, types.
 *   - Shell continues to register the Agent tool renderer via its own
 *     registry.ts; that renderer imports SubagentDetailView from here.
 *
 * Phase 2 (extract-subagents-as-plugin — separate change, future):
 *   - Add slot claims for `tool-renderer` ("Agent", "get_subagent_result",
 *     "steer_subagent") once the slot's prop interface widens.
 *   - Move the subagent_* reducer slice here as plugin-owned.
 *   - Remove the corresponding hardcoded entries from the shell.
 */

export { SubagentDetailView } from "./SubagentDetailView.js";
export type { SubagentDetailMode, SubagentDetailViewProps } from "./SubagentDetailView.js";

export { SubagentPopoutPage } from "./SubagentPopoutPage.js";
export type { SubagentPopoutPageProps } from "./SubagentPopoutPage.js";

export { SubagentPopoutClaim } from "./SubagentPopoutClaim.js";
export type { SubagentPopoutClaimProps } from "./SubagentPopoutClaim.js";

export { SubagentsSettings } from "./SubagentsSettings.js";

export type { SubagentTimelineEntry, SubagentState } from "./types.js";
