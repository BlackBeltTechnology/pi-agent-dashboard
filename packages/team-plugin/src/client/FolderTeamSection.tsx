/**
 * FolderTeamSection — `sidebar-folder-section` slot claim (D17). A row
 * "Csapat · N ügynök · M aktív" only for a folder that is (or lies inside) a
 * team project; hidden otherwise. Folder-menu items: OPEN "Csapat", and for
 * admins WORKSPACE settings / disable (folder-enabled) or enable (unmatched,
 * `enableable`). One batched match call serves every visible folder.
 * See change: add-team-plugin.
 */
import { SlotPill, useFolderMenuItem, useFolderMenuRefresher, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FolderDescriptor, SlotPlacement } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { mdiAccountGroupOutline, mdiCogOutline, mdiLinkOff, mdiPlusCircleOutline } from "@mdi/js";
import type React from "react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { invalidateMatches, useFolderMatch } from "./match-store.js";
import { DisableTeamDialog, TeamProjectDialog } from "./TeamProjectDialog.js";
import { openTeam } from "./team-open.js";

export function FolderTeamSection({ folder, placement = "sidebar" }: { folder: FolderDescriptor; placement?: SlotPlacement }): React.ReactElement | null {
  const t = useT();
  const cwd = folder?.cwd;
  const [, navigate] = useLocation();
  const match = useFolderMatch(cwd);
  const [dialog, setDialog] = useState<"enable" | "settings" | "disable" | null>(null);

  const scope = placement === "card" ? null : cwd;
  const result = match.status === "ready" ? match.result : null;
  const project = result?.project ?? null;
  // A failed match shows nothing at all: no row, no menu item.
  const manageable = !!project && result?.manageable === true;
  const enableable = !project && result?.enableable === true;

  useFolderMenuRefresher(scope, invalidateMatches);
  useFolderMenuItem(
    scope,
    useMemo(
      () =>
        project
          ? { id: "team-open", group: "open" as const, label: t("openTeam", undefined, "Team"), icon: mdiAccountGroupOutline, onSelect: () => openTeam(project.id, navigate, cwd ?? "") }
          : null,
      [project, t, navigate, cwd],
    ),
  );
  useFolderMenuItem(
    scope,
    useMemo(
      () => (manageable ? { id: "team-settings", group: "workspace" as const, label: t("teamSettings", undefined, "Team settings…"), icon: mdiCogOutline, onSelect: () => setDialog("settings") } : null),
      [manageable, t],
    ),
  );
  useFolderMenuItem(
    scope,
    useMemo(
      () => (manageable ? { id: "team-disable", group: "workspace" as const, label: t("disableTeam", undefined, "Disable team"), icon: mdiLinkOff, onSelect: () => setDialog("disable") } : null),
      [manageable, t],
    ),
  );
  useFolderMenuItem(
    scope,
    useMemo(
      () => (enableable ? { id: "team-enable", group: "workspace" as const, label: t("enableTeam", undefined, "Enable team for this folder"), icon: mdiPlusCircleOutline, onSelect: () => setDialog("enable") } : null),
      [enableable, t],
    ),
  );

  if (!cwd) return null;
  const dialogs = (
    <>
      {dialog === "enable" ? (
        <TeamProjectDialog mode="enable" cwd={cwd} initialName={cwd.split("/").filter(Boolean).pop() ?? cwd} onClose={() => setDialog(null)} onDone={invalidateMatches} />
      ) : null}
      {dialog === "settings" && project ? (
        <TeamProjectDialog mode="settings" cwd={cwd} projectId={project.id} initialName={project.name} onClose={() => setDialog(null)} onDone={invalidateMatches} />
      ) : null}
      {dialog === "disable" && project ? <DisableTeamDialog name={project.name} projectId={project.id} onClose={() => setDialog(null)} onDone={invalidateMatches} /> : null}
    </>
  );
  if (!project) return dialogs;

  return (
    <div data-testid="folder-team-section" onClick={(e) => e.stopPropagation()}>
      <SlotPill
        surface={placement === "card" ? "flat" : "raised"}
        glyph={mdiAccountGroupOutline}
        accent={project.available ? "purple" : "red"}
        label={t("rowLabel", undefined, "Team")}
        activateTestId="folder-team-open"
        activateTitle={t("rowTitle", undefined, "Open this folder's AI team")}
        onActivate={() => openTeam(project.id, navigate, cwd)}
      >
        <span data-testid="folder-team-count">{t("rowCount", { agents: project.agents, active: project.active }, `${project.agents} agents · ${project.active} active`)}</span>
      </SlotPill>
      {dialogs}
    </div>
  );
}
