/**
 * Client entry barrel for the automation-plugin.
 *
 * Re-exports the React slot-claim components + predicates referenced by the
 * `pi-dashboard-plugin` manifest's `claims[]`. The vite plugin's
 * plugin-registry generator resolves each `component` / `predicate` string
 * in the manifest against this module's named exports — names MUST match.
 *
 * Slots claimed:
 *   - sidebar-folder-section → FolderAutomationSection
 *   - shell-overlay-route /folder/:encodedCwd/automations → AutomationBoard
 *   - shell-overlay-route /automation/run/:sid → AutomationRunMonitor
 *   - session-card-badge → AutomationBadge (predicate: isAutomationRun)
 *   - settings-section (general) → AutomationSettings
 *
 * See change: add-automation-plugin.
 */
export { catalog } from "../i18n.js";
export type {
  AutomationConfig,
  AutomationScope,
  DiscoveredAutomation,
  RunRecord,
  RunStatus,
  Visibility,
} from "../shared/automation-types.js";
export { AutomationBadge } from "./AutomationBadge.js";
export { AutomationBoard } from "./AutomationBoard.js";
export { AutomationRunMonitor } from "./AutomationRunMonitor.js";
export { AutomationSettings } from "./AutomationSettings.js";
export { CreateAutomationDialog } from "./CreateAutomationDialog.js";
export { FolderAutomationSection } from "./FolderAutomationSection.js";
export { isAutomationRun } from "./predicates.js";
