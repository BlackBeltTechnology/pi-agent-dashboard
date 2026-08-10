/**
 * Pill row for filtering OpenSpec changes by group.
 * Shows "All" + one pill per group + "Manage groups…" link.
 *
 * See change: add-openspec-change-grouping (task 6.2).
 */

import type { OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import React from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { resolveGroupColor } from "../../lib/openspec/openspec-group-palette.js";

interface Props {
  groups: OpenSpecGroup[];
  activeGroupId: string | null;
  onSelect: (groupId: string | null) => void;
  onManageGroups?: () => void;
}

export function OpenSpecGroupPills({
  groups,
  activeGroupId,
  onSelect,
  onManageGroups,
}: Props) {
  if (groups.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1 flex-wrap py-1"
      data-testid="group-pills"
    >
      {/* "All" pill */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onSelect(null); }}
        className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
          activeGroupId === null
            ? "border-blue-500/50 text-blue-400 bg-blue-500/10"
            : "border-[var(--border-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        }`}
        data-testid="group-pill-all"
      >
        {i18nT("common.all", undefined, "All")}
      </button>

      {/* Group pills */}
      {groups.map((g) => {
        const active = activeGroupId === g.id;
        const hex = resolveGroupColor(g.color);
        return (
          <button
            key={g.id}
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect(g.id); }}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors flex items-center gap-1 ${
              active
                ? "border-blue-500/50 text-blue-400 bg-blue-500/10"
                : "border-[var(--border-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
            data-testid={`group-pill-${g.id}`}
          >
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: hex }}
            />
            {g.name}
          </button>
        );
      })}

      {/* Manage link */}
      {onManageGroups && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onManageGroups(); }}
          className="text-[10px] text-[var(--text-muted)] hover:text-blue-400 ml-1"
          data-testid="manage-groups-link"
        >
          {i18nT("common.manageGroups", undefined, "Manage groups…")}
        </button>
      )}
    </div>
  );
}
