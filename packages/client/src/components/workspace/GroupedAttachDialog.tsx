/**
 * Grouped attach dialog for selecting an OpenSpec change.
 * Shows pills + group sections when groups exist.
 *
 * See change: add-openspec-change-grouping (task 9.1).
 */

import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { OpenSpecChange, OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, deriveChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiMagnify } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useMemo, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { OpenSpecGroupPills } from "../openspec/OpenSpecGroupPills.js";
import { OpenSpecGroupSection } from "../openspec/OpenSpecGroupSection.js";

interface Props {
  changes: OpenSpecChange[];
  groups: OpenSpecGroup[];
  assignments: Record<string, string>;
  onSelect: (changeName: string) => void;
  onCancel: () => void;
}

export function GroupedAttachDialog({ changes, groups, assignments, onSelect, onCancel }: Props) {
  const [search, setSearch] = useState("");
  const [activePill, setActivePill] = useState<string | null>(null);
  const [collapseState, setCollapseState] = useState<Record<string, boolean>>({});

  const sortedGroups = useMemo(() => [...groups].sort((a, b) => a.order - b.order), [groups]);
  const sortedChanges = useMemo(() => [
    ...changes.filter((c) => c.status !== "complete"),
    ...changes.filter((c) => c.status === "complete"),
  ], [changes]);

  const getGroupId = (c: OpenSpecChange): string | null =>
    assignments[c.name] ?? c.groupId ?? null;

  // Filter by search + pill
  const filtered = useMemo(() => {
    let result = sortedChanges;
    if (search) {
      const lower = search.toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(lower));
    }
    if (activePill !== null) {
      if (activePill === "__ungrouped__") {
        result = result.filter((c) => getGroupId(c) === null);
      } else {
        result = result.filter((c) => getGroupId(c) === activePill);
      }
    }
    return result;
  }, [sortedChanges, search, activePill, assignments]);

  const stateLabel = (c: OpenSpecChange): string => {
    const state = deriveChangeState(c);
    const labels: Record<string, string> = {
      PLANNING: "Planning",
      READY: "Ready",
      IMPLEMENTING: `${c.completedTasks}/${c.totalTasks} tasks`,
      COMPLETE: `✓ ${c.completedTasks}/${c.totalTasks}`,
    };
    return labels[state] || c.status;
  };

  const renderChangeRow = (c: OpenSpecChange) => (
    <button
      key={c.name}
      type="button"
      onClick={() => onSelect(c.name)}
      className="flex items-center gap-2 w-full text-left px-3 py-1.5 rounded hover:bg-[var(--bg-hover)]"
      data-testid={`attach-option-${c.name}`}
    >
      <span className="text-[12px] text-[var(--text-primary)] truncate flex-1">{c.name}</span>
      <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">{stateLabel(c)}</span>
    </button>
  );

  // Partition
  const partitioned = new Map<string, OpenSpecChange[]>();
  const ungrouped: OpenSpecChange[] = [];
  for (const c of filtered) {
    const gId = getGroupId(c);
    if (gId && groups.find((g) => g.id === gId)) {
      const list = partitioned.get(gId) ?? [];
      list.push(c);
      partitioned.set(gId, list);
    } else {
      ungrouped.push(c);
    }
  }

  return (
    <Dialog open onClose={onCancel} title={i18nT("openspec.attachChange", undefined, "Attach Change")} size="sm" testId="grouped-attach-dialog">
          {/* Pills */}
          <div className="px-3 pt-1">
            <OpenSpecGroupPills
              groups={sortedGroups}
              activeGroupId={activePill}
              onSelect={setActivePill}
            />
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-1.5">
            <Icon path={mdiMagnify} size={0.5} className="text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={i18nT("common.searchChanges", undefined, "Search changes...")}
              className="flex-1 text-xs bg-transparent border-none outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              autoFocus
              data-testid="grouped-attach-search"
            />
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {filtered.length === 0 ? (
              <p className="text-[11px] text-[var(--text-muted)] text-center py-4">{i18nT("common.noMatchingChanges", undefined, "No matching changes")}</p>
            ) : (
              <div className="space-y-1">
                {sortedGroups.map((g) => {
                  const items = partitioned.get(g.id) ?? [];
                  if (activePill !== null && activePill !== g.id) return null;
                  return (
                    <OpenSpecGroupSection
                      key={g.id}
                      name={g.name}
                      color={g.color}
                      count={items.length}
                      expanded={collapseState[g.id] !== false}
                      onToggle={() => setCollapseState((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
                    >
                      {items.length > 0
                        ? items.map(renderChangeRow)
                        : <p className="text-[10px] text-[var(--text-muted)] px-2 py-1">{i18nT("common.noChangesInThisGroup", undefined, "No changes in this group")}</p>}
                    </OpenSpecGroupSection>
                  );
                })}
                {(activePill === null || activePill === "__ungrouped__") && (
                  <OpenSpecGroupSection
                    name="Ungrouped"
                    color={null}
                    count={ungrouped.length}
                    expanded={collapseState["__ungrouped__"] !== false}
                    onToggle={() => setCollapseState((prev) => ({ ...prev, ["__ungrouped__"]: !prev["__ungrouped__"] }))}
                  >
                    {ungrouped.length > 0
                      ? ungrouped.map(renderChangeRow)
                      : <p className="text-[10px] text-[var(--text-muted)] px-2 py-1">{i18nT("common.noUngroupedChanges", undefined, "No ungrouped changes")}</p>}
                  </OpenSpecGroupSection>
                )}
              </div>
            )}
          </div>
    </Dialog>
  );
}
