/**
 * Wire-protocol types consumed by the subagents plugin.
 *
 * The definitions (and the pure fold helpers beside them) live in shared
 * (`dashboard-plugin/subagent-types`) so core and plugins share one contract
 * without a core→plugin import; the types are re-exported here.
 * See change: decouple-plugins-from-core (task 2.7).
 */
export type {
  SubagentLiveBlock,
  SubagentLiveTail,
  SubagentState,
  SubagentTimelineEntry,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/subagent-types.js";
