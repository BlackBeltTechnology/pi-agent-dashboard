/**
 * Client entry barrel for the flows plugin.
 *
 * Re-exports every flow-related React component so the dashboard shell
 * can import them via `@blackbelt-technology/pi-dashboard-flows-plugin/client`.
 *
 * Also exports the `hasActiveFlow` predicate consumed by the
 * `pi-dashboard-plugin` manifest's `session-card-badge` claim.
 */


// Existing presentation components — still used directly by App.tsx
// during the cutover (Part H removes those call sites).
// i18n catalog — merged under `plugin.flows.*` by the shell via the
// manifest's `i18nCatalog: "catalog"` declaration. See change: make-all-ui-text-i18n.
export { catalog } from "../i18n.js";
export { FlowActivityBadge } from "./FlowActivityBadge.js";
export { FlowAgentCard } from "./FlowAgentCard.js";
export { FlowAgentDetail } from "./FlowAgentDetail.js";
export { FlowAgentsToolRenderer } from "./FlowAgentsToolRenderer.js";
// Slot-claim wrappers — the plugin's manifest references these.
// Each derives state from the plugin-internal contexts and dispatches
// via pluginContext.send. See change: pluginize-flows-via-registry.
// FlowActivityBadgeClaim removed in fix-flows-plugin-polish (A5) — the
// session-card-badge claim was dropped because the badge belongs in the
// FLOWS subcard, not WORKSPACE. SessionFlowActions now renders the badge
// directly via the FlowActivityBadge component.
export { FlowDashboard, FlowDashboardClaim } from "./FlowDashboard.js";
export { computeLayout, FlowGraph, flowStateToGraphSteps } from "./FlowGraph.js";
// Input-wiring editor claimed into automation-plugin's `automation-action-editor`
// slot for `flows.run`. See change: wire-flow-inputs-in-automation.
export { FlowInputWiring, FlowInputWiringClaim } from "./FlowInputWiring.js";
export { FlowLaunchDialog } from "./FlowLaunchDialog.js";
export { FlowSummary, FlowSummaryClaim } from "./FlowSummary.js";
export type { FlowsPluginConfig } from "./FlowsSettings.js";

// Settings section (global edit-mode default) — manifest `settings-section` claim.
export { FlowsSettings } from "./FlowsSettings.js";
export { FlowTabBar } from "./FlowTabBar.js";
// Authoring tool-renderers (main-session timeline) — referenced by the
// manifest's `tool-renderer` claims. See change: rework-flows-plugin-for-new-pi-flows.
export { FlowWriteToolRenderer } from "./FlowWriteToolRenderer.js";
export { FlowYamlPreviewClaim } from "./FlowYamlPreview.js";
export { SessionFlowActions, SessionFlowActionsClaim } from "./SessionFlowActions.js";

// Manifest-level shouldRender predicate for the `session-card-flows` claim.
// See change: add-flows-subcard.
export { shouldRenderFlowsSubcard } from "./shouldRender.js";

// Flow slash commands (`/flows`, `/flows:new`, `/flows:edit`, `/flows:delete`)
// are no longer claimed by the dashboard plugin manifest. Flow operations
// surface through buttons only (`SessionFlowActions`, `FlowLaunchDialog`,
// `FlowDashboard` Abort). pi-flows itself continues to register the slash
// commands for TUI users. See change: fix-pi-flows-end-to-end (Group 8).
//
// The FlowsCommandRoutes module is no longer exported from this barrel.
// Restore the exports here if/when the dashboard re-introduces command-route
// claims for flows.

export type { FlowsSessionState } from "./FlowsSessionStateContext.js";
// Plugin-internal state hooks. Components consume these in place of
// props that previously came from App.tsx. See change:
// pluginize-flows-via-registry.
export {
  reduceFlowsSessionState,
  useFlowsSessionState,
} from "./FlowsSessionStateContext.js";

import { registerPromptComponent } from "@blackbelt-technology/dashboard-plugin-runtime";
import { getFlowsUiStateSnapshot } from "./FlowsUiStateContext.js";

// Register the `flow-question` prompt component type so the shell knows to
// route flow-tagged prompts to the widget-bar placement instead of inline
// chat. Idempotent under HMR — `registerPromptComponent` replaces prior
// entries without throwing. See change: route-flow-asks-to-upper-slot.
registerPromptComponent({ type: "flow-question", placement: "widget-bar" });

export type { FlowsUiActions, FlowsUiState } from "./FlowsUiStateContext.js";
export {getFlowsUiStateSnapshot, 
  useFlowsUiActions,
  useFlowsUiState
} from "./FlowsUiStateContext.js";

// hasActiveFlow predicate removed: the manifest no longer references
// it because FlowActivityBadgeClaim self-gates inside the component
// body via useFlowsSessionState. See change:
// pluginize-flows-via-registry.

// ── content-view claim predicates ─────────────────────────────────
//
// Each `content-view` claim in the manifest references one of these
// predicates via the `predicate` field. The slot consumer calls the
// predicate at render time; the first claim (priority order) whose
// predicate returns `true` renders. If none return `true`, the slot
// renders nothing and the shell's fallback shows the chat.
//
// Each predicate reads the plugin's UI-state store imperatively (via
// `getFlowsUiStateSnapshot` — not a hook, safe outside React) so it
// can run from the slot-registry filter. The `_session` argument is
// passed by the slot system per the predicate contract
// (`(props) => boolean`) but is unused here because activation lives
// in plugin state, not session state.
//
// See change: pluginize-flows-via-registry (design.md Decision 3
// RECONSIDERED — predicates over routes).



export function isFlowYamlPreviewActive(_session?: unknown): boolean {
  return getFlowsUiStateSnapshot().flowYamlPreview !== null;
}
