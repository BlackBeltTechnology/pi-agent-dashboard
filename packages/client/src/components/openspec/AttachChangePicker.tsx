/**
 * The attach-change picker shared by the session card and the composer
 * strip: `GroupedAttachDialog` when folder groups exist, else a flat
 * searchable list (open changes first, completed last).
 * See change: redesign-composer-session-strip (D3).
 */
import type { OpenSpecChange, OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { deriveChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { SearchableSelectDialog, type SelectOption } from "../primitives/SearchableSelectDialog.js";
import { GroupedAttachDialog } from "../workspace/GroupedAttachDialog.js";

function changeOptions(changes: OpenSpecChange[]): SelectOption[] {
  return [
    ...changes.filter((c) => c.status !== "complete"),
    ...changes.filter((c) => c.status === "complete"),
  ].map((c) => {
    const state = deriveChangeState(c);
    const stateLabels: Record<string, string> = {
      PLANNING: i18nT("openspec.statePlanning", undefined, "Planning"),
      READY: i18nT("openspec.stateReady", undefined, "Ready to implement"),
      IMPLEMENTING: i18nT("openspec.stateImplementing", { completed: c.completedTasks, total: c.totalTasks }, "Implementing — {completed}/{total} tasks"),
      COMPLETE: i18nT("openspec.stateComplete", { completed: c.completedTasks, total: c.totalTasks }, "Complete — {completed}/{total} tasks"),
    };
    const desc = stateLabels[state] || c.status;
    const artifactNames = c.artifacts.map((a) => a.id).join(", ");
    return {
      value: c.name,
      label: c.name,
      description: artifactNames ? `${desc} · ${artifactNames}` : desc,
      badge: c.status === "complete" ? "✓" : c.status === "in-progress" ? `${c.completedTasks}/${c.totalTasks}` : undefined,
      badgeColor: c.status === "complete" ? "text-green-400" : "text-blue-400",
    };
  });
}

export function AttachChangePicker({
  changes,
  groups,
  assignments,
  onSelect,
  onCancel,
}: {
  changes: OpenSpecChange[];
  groups?: OpenSpecGroup[];
  assignments?: Record<string, string>;
  onSelect: (changeName: string) => void;
  onCancel: () => void;
}) {
  if (groups && groups.length > 0) {
    return (
      <GroupedAttachDialog changes={changes} groups={groups} assignments={assignments ?? {}} onSelect={onSelect} onCancel={onCancel} />
    );
  }
  return (
    <SearchableSelectDialog
      title={i18nT("openspec.attachOpenspecChange2", undefined, "Attach OpenSpec Change")}
      options={changeOptions(changes)}
      placeholder={i18nT("common.searchChanges", undefined, "Search changes...")}
      emptyMessage={i18nT("openspec.noChangesAvailable", undefined, "No changes available")}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
}
