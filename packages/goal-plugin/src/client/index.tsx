/**
 * Client entry barrel for the goal-plugin.
 *
 * Exports the slot components + predicate referenced by the
 * `pi-dashboard-plugin` manifest claims. The generated plugin-registry
 * imports these by name. See change: add-goal-continuation-plugin.
 */
export { GoalChip } from "./GoalChip.js";
export { GoalControl } from "./GoalControl.js";
export { GoalPluginSettings } from "./GoalPluginSettings.js";
export { hasGoal } from "./predicates.js";
export { deriveSnapshot } from "./goal-state.js";
