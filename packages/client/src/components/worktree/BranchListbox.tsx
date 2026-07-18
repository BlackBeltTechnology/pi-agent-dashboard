/**
 * Presentational listbox of git branches. Splits local/remote, renders
 * current-branch marker `●`, remote badge, and highlight styling.
 * Owned by the caller: `filter`, `highlightIndex`, and `onSelect`.
 *
 * Shared by `BranchPicker` (always-open dialog mode, `disableCurrent`)
 * and `BranchCombobox` (popover mode, current selectable).
 *
 * See change: worktree-base-branch-typeahead.
 */

import type { GitBranchEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

export type DisplayItem =
  | { type: "branch"; branch: GitBranchEntry }
  | { type: "separator" };

interface UseKeyboardArgs {
  branches: GitBranchEntry[];
  filter: string;
  highlightIndex: number;
  onHighlightChange: (index: number) => void;
  onSelect: (branchName: string) => void;
  disableCurrent?: boolean;
}

interface UseKeyboardResult {
  handleKey: (e: React.KeyboardEvent) => boolean;
  displayItems: DisplayItem[];
  selectableIndices: number[];
}

/** Compute the local/remote-split display list with optional separator. */
function buildDisplayItems(filtered: GitBranchEntry[]): DisplayItem[] {
  const local = filtered.filter((b) => !b.isRemote);
  const remote = filtered.filter((b) => b.isRemote);
  const items: DisplayItem[] = [];
  for (const b of local) items.push({ type: "branch", branch: b });
  if (remote.length > 0) {
    if (local.length > 0) items.push({ type: "separator" });
    for (const b of remote) items.push({ type: "branch", branch: b });
  }
  return items;
}

function filterBranches(branches: GitBranchEntry[], filter: string): GitBranchEntry[] {
  if (!filter) return branches;
  const lower = filter.toLowerCase();
  return branches.filter((b) => b.name.toLowerCase().includes(lower));
}

/**
 * Hook exposing keyboard navigation for the listbox. Returned `handleKey`
 * returns `true` when the event was consumed (caller should not treat
 * the key as text input or propagate it further as default).
 */
export function useBranchListboxKeyboard({
  branches,
  filter,
  highlightIndex,
  onHighlightChange,
  onSelect,
  disableCurrent = false,
}: UseKeyboardArgs): UseKeyboardResult {
  const filtered = useMemo(() => filterBranches(branches, filter), [branches, filter]);
  const displayItems = useMemo(() => buildDisplayItems(filtered), [filtered]);
  const selectableIndices = useMemo(
    () =>
      displayItems
        .map((item, i) =>
          item.type === "branch" && (!disableCurrent || !item.branch.isCurrent) ? i : -1,
        )
        .filter((i) => i >= 0),
    [displayItems, disableCurrent],
  );

  const handleKey = (e: React.KeyboardEvent): boolean => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (selectableIndices.length === 0) return true;
      const currentIdx = selectableIndices.indexOf(highlightIndex);
      const next =
        currentIdx < selectableIndices.length - 1
          ? selectableIndices[currentIdx + 1]!
          : selectableIndices[0]!;
      onHighlightChange(next);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (selectableIndices.length === 0) return true;
      const currentIdx = selectableIndices.indexOf(highlightIndex);
      const next =
        currentIdx > 0
          ? selectableIndices[currentIdx - 1]!
          : selectableIndices[selectableIndices.length - 1]!;
      onHighlightChange(next);
      return true;
    }
    if (e.key === "Enter") {
      if (selectableIndices.length === 0) return false;
      if (highlightIndex < 0 || highlightIndex >= displayItems.length) return false;
      const item = displayItems[highlightIndex];
      if (item && item.type === "branch" && (!disableCurrent || !item.branch.isCurrent)) {
        e.preventDefault();
        onSelect(item.branch.name);
        return true;
      }
      return false;
    }
    return false;
  };

  return { handleKey, displayItems, selectableIndices };
}

interface Props {
  branches: GitBranchEntry[];
  filter: string;
  highlightIndex: number;
  onHighlightChange: (index: number) => void;
  onSelect: (branchName: string) => void;
  disableCurrent?: boolean;
  rows?: number;
  /**
   * Committed selection (the combobox `value`). When set, the row whose
   * `branch.name` equals it carries `aria-selected="true"`, per the
   * WAI-ARIA single-select listbox contract (selected = chosen value, not
   * the keyboard-highlighted/active row). Omit for pickers with no
   * persistent committed value (e.g. `BranchPicker`'s one-shot checkout).
   */
  selectedValue?: string;
}

export function BranchListbox({
  branches,
  filter,
  highlightIndex,
  onHighlightChange,
  onSelect,
  disableCurrent = false,
  rows = 10,
  selectedValue,
}: Props) {
  const { displayItems } = useBranchListboxKeyboard({
    branches,
    filter,
    highlightIndex,
    onHighlightChange,
    onSelect,
    disableCurrent,
  });

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlightIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-branch-item]");
    items[highlightIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [highlightIndex]);

  const rowHeight = 32;
  const listHeight = rows * rowHeight;

  return (
    <div
      ref={listRef}
      className="overflow-y-auto border border-[var(--border-secondary)] rounded bg-[var(--bg-tertiary)]"
      style={{ height: listHeight }}
      role="listbox"
    >
      {displayItems.length === 0 && (
        <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">{i18nT("git.noBranchesFound", undefined, "No branches found")}</div>
      )}
      {displayItems.map((item, i) => {
        if (item.type === "separator") {
          return (
            <div
              key="sep"
              data-branch-item
              className="px-3 py-1 text-[10px] text-[var(--text-muted)] border-t border-[var(--border-secondary)] uppercase tracking-wider"
            >
              {i18nT("git.remote", undefined, "Remote")}
            </div>
          );
        }
        const { branch } = item;
        const isHighlighted = i === highlightIndex;
        const isCurrentBranch = branch.isCurrent;
        const nonSelectable = disableCurrent && isCurrentBranch;
        // aria-selected reflects the COMMITTED selection (matches the
        // combobox value), not the keyboard highlight. The highlight is a
        // visual-only cursor (bg tint). See change: worktree-base-branch-typeahead.
        const isSelected = selectedValue !== undefined && branch.name === selectedValue;
        return (
          <div
            key={branch.name}
            data-branch-item
            role="option"
            aria-selected={isSelected}
            className={`px-3 py-1 text-sm flex items-center gap-2 ${
              nonSelectable
                ? "text-[var(--text-muted)] cursor-default"
                : isHighlighted
                  ? "bg-blue-600/30 cursor-pointer"
                  : "hover:bg-[var(--bg-secondary)] cursor-pointer"
            }`}
            onClick={() => {
              if (!nonSelectable) onSelect(branch.name);
            }}
          >
            <span className="w-3 text-center text-green-400">
              {isCurrentBranch ? "●" : ""}
            </span>
            <span className="flex-1 truncate font-mono text-xs">{branch.name}</span>
            {branch.isRemote && (
              <span className="text-[10px] text-[var(--text-muted)]">remote</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
