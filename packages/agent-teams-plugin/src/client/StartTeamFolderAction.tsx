/**
 * StartTeamFolderAction — lazy `sidebar-folder-section` claim (design D11). It
 * renders nothing itself: it contributes ONE "Start team" item to the folder
 * actions menu of its folder (sidebar placement only — a session card or worktree
 * card gets none, so the action exists once per folder) and hosts the dialog the
 * item opens. The dialog chunk is imported on first open; the dialog is given the
 * folder's own cwd and nothing else. Clicks inside the dialog are stopped at the
 * wrapper so they never reach the folder card behind it (React bubbles through the
 * dialog's portal); keys are not, the dialog's Esc / Tab handling is on `document`.
 * See change: add-agent-teams-templates-hooks.
 */
import { useFolderMenuItem } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FolderDescriptor, SlotPlacement } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { mdiAccountGroupOutline } from "@mdi/js";
import { lazy, type ReactElement, Suspense, useMemo, useState } from "react";
import { useLazyT } from "./lazy-i18n.js";
import { START_TABLES } from "./start-i18n.js";

const StartTeamDialog = lazy(() => import("./StartTeamDialog.js").then((m) => ({ default: m.StartTeamDialog })));

/** Folder-menu item id (`folder-menu-item-<id>` in the host). */
export const START_TEAM_MENU_ID = "agent-teams-start";

export interface StartTeamFolderActionProps {
  folder?: FolderDescriptor;
  placement?: SlotPlacement;
}

export function StartTeamFolderAction({ folder, placement = "sidebar" }: StartTeamFolderActionProps): ReactElement | null {
  const t = useLazyT(START_TABLES);
  const cwd = folder?.cwd;
  const [open, setOpen] = useState(false);
  const label = t("folder.startTeam");
  // `null` scope = no registration (card / worktree placement, or a folder without a cwd).
  const scope = placement === "card" || !cwd ? null : cwd;
  useFolderMenuItem(
    scope,
    useMemo(() => (scope ? { id: START_TEAM_MENU_ID, group: "create" as const, label, icon: mdiAccountGroupOutline, onSelect: () => setOpen(true) } : null), [scope, label]),
  );
  if (!open || !cwd) return null;
  return (
    <div className="contents" onClick={(e) => e.stopPropagation()}>
      <Suspense fallback={null}>
        <StartTeamDialog cwd={cwd} folderLabel={folder?.label ?? cwd} onClose={() => setOpen(false)} />
      </Suspense>
    </div>
  );
}
