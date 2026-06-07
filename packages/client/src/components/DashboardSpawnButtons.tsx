/**
 * Elevated dashboard-scope spawn-button stack for the sidebar.
 *
 * Renders full-width stacked line buttons mirroring `FolderSpawnButtons`:
 *   - `+ Add Folder` (yellow) — always rendered; pins a top-level folder
 *     (dashboard scope) or adds a folder to a workspace (workspace scope).
 *   - `+ New Workspace` (neutral) — rendered only when `onNewWorkspace` is
 *     provided.
 *
 * Dashboard scope: rendered as the first item in the scroll list.
 * Workspace scope: rendered Add-Folder-only at the bottom of each expanded
 * workspace body.
 *
 * See change: elevate-dashboard-add-buttons.
 */
import { Icon } from "@mdi/react";
import { mdiFolderPlus, mdiViewGridPlus } from "@mdi/js";

interface Props {
  /** Disables `+ Add Folder` (e.g. while a pin is in flight). */
  addFolderDisabled?: boolean;
  onAddFolder: () => void;
  /** When provided, renders the `+ New Workspace` button below Add Folder. */
  onNewWorkspace?: () => void;
  /** `data-testid` for the Add Folder button. Defaults to dashboard scope. */
  addFolderTestId?: string;
}

export function DashboardSpawnButtons({
  addFolderDisabled,
  onAddFolder,
  onNewWorkspace,
  addFolderTestId = "dashboard-add-folder-btn",
}: Props) {
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={(e) => { e.stopPropagation(); onAddFolder(); }}
        disabled={addFolderDisabled}
        data-testid={addFolderTestId}
        className={`w-full text-xs px-2 py-1 rounded border flex items-center justify-center gap-0.5 ${
          addFolderDisabled
            ? "border-[var(--border-secondary)] text-[var(--text-secondary)] opacity-50 cursor-not-allowed"
            : "text-yellow-400 border-yellow-500/40 bg-yellow-500/5 hover:text-yellow-300 hover:border-yellow-500/70"
        }`}
        title="Add a folder"
      >
        <Icon path={mdiFolderPlus} size={0.6} /> Add Folder
      </button>

      {onNewWorkspace && (
        <button
          onClick={(e) => { e.stopPropagation(); onNewWorkspace(); }}
          data-testid="dashboard-new-workspace-btn"
          className="w-full text-xs px-2 py-1 rounded border flex items-center justify-center gap-0.5 text-[var(--text-secondary)] border-[var(--border-secondary)] bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-primary)]"
          title="New workspace"
        >
          <Icon path={mdiViewGridPlus} size={0.6} /> New Workspace
        </button>
      )}
    </div>
  );
}
