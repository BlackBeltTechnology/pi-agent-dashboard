/**
 * Client entry barrel for the jj-plugin.
 *
 * Component slots claimed by `pi-dashboard-plugin` in package.json:
 *   - session-card-badge       → JjWorkspaceBadge   (predicate: isInJjWorkspace)
 *   - session-card-action-bar  → JjActionBar        (predicate: isInJjRepo)
 *   - sidebar-folder-section   → JjWorkspaceList    (per-folder)
 *   - command-route /jj        → JjWorkspaceView    (content area)
 *   - settings-section         → JjPluginSettings   (general tab)
 *
 * See change: add-jj-workspace-plugin.
 */

export { isInJjRepo, isInJjWorkspace, isInGitRepoButNotJj } from "./predicates.js";

export { JjWorkspaceBadge } from "./JjWorkspaceBadge.js";
export { JjActionBar } from "./JjActionBar.js";
export { JjInitAffordance } from "./JjInitAffordance.js";
export { buildFoldBackPrompt } from "./JjActionBar.js";
export { JjWorkspaceList } from "./JjWorkspaceList.js";
export { JjWorkspaceView } from "./JjWorkspaceView.js";
export { JjPluginSettings } from "./JjPluginSettings.js";

export type {
  JjWorkspaceListEntry,
  JjAddWorkspaceArgs,
  JjAddWorkspaceResponse,
  JjForgetWorkspaceArgs,
  JjUnfoldedWorkResponse,
} from "./api.js";
