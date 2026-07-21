/**
 * Collapsed-by-default typeahead combobox for picking a git branch from
 * an existing-branches list. Trigger button shows current `value`; on
 * click/focus expands to a popover containing a filter input and
 * `BranchListbox`. Implements the WAI-ARIA combobox pattern. Filter-only
 * — Enter on no match is a no-op (no synthetic branch).
 *
 * See change: worktree-base-branch-typeahead.
 */

import type { GitBranchEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { BranchListbox, useBranchListboxKeyboard } from "./BranchListbox.js";

interface Props {
  branches: GitBranchEntry[];
  value: string;
  onChange: (branch: string) => void;
  disabled?: boolean;
  placeholder?: string;
  "data-testid"?: string;
}

export function BranchCombobox({
  branches,
  value,
  onChange,
  disabled = false,
  placeholder,
  "data-testid": testid,
}: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const popoverId = useId();

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      setFilter("");
      setHighlightIndex(-1);
      if (returnFocus) triggerRef.current?.focus();
    },
    [],
  );

  const handleSelect = useCallback(
    (name: string) => {
      onChange(name);
      close(true);
    },
    [onChange, close],
  );

  const { handleKey } = useBranchListboxKeyboard({
    branches,
    filter,
    highlightIndex,
    onHighlightChange: setHighlightIndex,
    onSelect: handleSelect,
    disableCurrent: false,
  });

  // Reset highlight on filter change.
  useEffect(() => {
    setHighlightIndex(-1);
  }, [filter]);

  // Autofocus filter input on open.
  useEffect(() => {
    if (open) filterInputRef.current?.focus();
  }, [open]);

  // Outside-click closes the popover.
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      const target = e.target as Node | null;
      if (target && !rootRef.current.contains(target)) {
        close(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open, close]);

  const handleTriggerClick = () => {
    if (disabled) return;
    setOpen((prev) => !prev);
  };

  const handleFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === "Tab") {
      // Allow focus to move naturally; just close the popover.
      close(false);
      return;
    }
    handleKey(e);
  };

  const triggerLabel = value || placeholder || "Select a branch";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={handleTriggerClick}
        data-testid={testid}
        className={`w-full mt-0.5 px-2 py-1 text-sm rounded border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] flex items-center gap-2 text-left ${
          value ? "" : "text-[var(--text-muted)]"
        } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span className="flex-1 truncate font-mono">{triggerLabel}</span>
        <span className="text-[var(--text-muted)]">▾</span>
      </button>
      {open && (
        <div
          id={popoverId}
          data-testid={testid ? `${testid}-popover` : undefined}
          className="absolute left-0 right-0 mt-1 z-10 p-2 rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] shadow-lg flex flex-col gap-2"
        >
          <input
            ref={filterInputRef}
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={handleFilterKeyDown}
            placeholder={i18nT("git.filterBranches", undefined, "Filter branches…")}
            data-testid={testid ? `${testid}-filter` : undefined}
            className="w-full bg-[var(--bg-tertiary)] rounded px-2 py-1 text-sm border border-[var(--border-secondary)] focus:border-blue-500 focus:outline-none font-mono"
          />
          <BranchListbox
            branches={branches}
            filter={filter}
            highlightIndex={highlightIndex}
            onHighlightChange={setHighlightIndex}
            onSelect={handleSelect}
            disableCurrent={false}
            selectedValue={value}
          />
        </div>
      )}
    </div>
  );
}
