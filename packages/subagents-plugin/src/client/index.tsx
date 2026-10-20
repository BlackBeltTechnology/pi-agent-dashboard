/**
 * Client entry for @blackbelt-technology/pi-dashboard-subagents-plugin.
 *
 * Re-exports the subagent inspector components, types, and timeline-entry
 * helpers so the shell can import them via a single package path.
 *
 * Declarative contributions the shell registers on the plugin's behalf (no
 * import side effect — see `dashboard-plugin-runtime` `session-event-reducers`):
 *   - `sessionEventReducer`: folds `subagent_created|started|entry|delta` into
 *     `SessionState.subagents` (and owns `subagent_completed|failed`).
 *   - `toolRowFinalizers`: the `Agent` finalizer — the only other writer of
 *     `SessionState.subagents` (terminal events, `partialResult` hydration,
 *     `/resume` backfill, orphan-heal guards).
 *   - `isAgentResultNotReceived`: the `Agent` tool-renderer claim's
 *     `resultPending` predicate (the `AgentToolRenderer` itself is a lazy claim
 *     `module`, not exported here).
 *
 * See change: decouple-plugins-from-core (Phase 3).
 */


export { catalog } from "../i18n.js";
export { isAgentResultNotReceived } from "./resultPending.js";
export type { SubagentDetailMode, SubagentDetailViewProps } from "./SubagentDetailView.js";
export { SubagentDetailView } from "./SubagentDetailView.js";
export type { SubagentPopoutClaimProps } from "./SubagentPopoutClaim.js";
export type { SubagentPopoutPageProps } from "./SubagentPopoutPage.js";
export { SubagentPopoutPage } from "./SubagentPopoutPage.js";
export { sessionEventReducer } from "./sessionEventReducer.js";
export { toolRowFinalizers } from "./toolRowFinalizer.js";
export type { SubagentLiveBlock, SubagentLiveTail, SubagentState, SubagentTimelineEntry } from "./types.js";
