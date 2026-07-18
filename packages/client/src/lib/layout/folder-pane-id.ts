/**
 * Namespaced localStorage key for the folder-scoped internal editor pane.
 *
 * The internal Monaco pane state (`useEditorPaneState`, `useSplitState`,
 * `useTreeVisible`) keys on an opaque string id. Session panes key on a session
 * UUID; folder panes key on `folder:<cwd>`. The `folder:` prefix is not a valid
 * session UUID, so the two key spaces are disjoint by construction — a folder
 * pane can never collide with a real session's persisted pane state.
 *
 * See change: remove-external-editor-integration.
 */

export const FOLDER_PANE_PREFIX = "folder:";

/** Build the namespaced pane id for a folder cwd. */
export function folderPaneId(cwd: string): string {
  return `${FOLDER_PANE_PREFIX}${cwd}`;
}

/** True when a pane id refers to a folder-scoped pane (not a session). */
export function isFolderPaneId(id: string): boolean {
  return id.startsWith(FOLDER_PANE_PREFIX);
}
