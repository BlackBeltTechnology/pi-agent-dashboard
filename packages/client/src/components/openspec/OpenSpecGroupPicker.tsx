/**
 * Per-row group picker: chip + dropdown for assigning a change to a group.
 * Lists groups + Unassign + "Create new group…" entry.
 *
 * See change: add-openspec-change-grouping (task 6.3).
 */

import type { OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import React, { useEffect, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { GROUP_PALETTE, resolveGroupColor } from "../../lib/openspec/openspec-group-palette.js";

interface Props {
  groups: OpenSpecGroup[];
  currentGroupId?: string | null;
  onAssign: (groupId: string | null) => void;
  /** Called when the user creates a new group inline. Returns the new group. */
  onCreateGroup?: (name: string, color: string) => Promise<OpenSpecGroup | undefined>;
}

export function OpenSpecGroupPicker({
  groups,
  currentGroupId,
  onAssign,
  onCreateGroup,
}: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentGroup = currentGroupId
    ? groups.find((g) => g.id === currentGroupId)
    : null;
  const hex = currentGroup ? resolveGroupColor(currentGroup.color) : null;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setNewName("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Auto-focus create input
  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed || !onCreateGroup) return;
    const group = await onCreateGroup(trimmed, GROUP_PALETTE[0].hex);
    if (group) {
      onAssign(group.id);
    }
    setCreating(false);
    setNewName("");
    setOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative" data-testid="group-picker">
      {/* Chip trigger */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--border-primary)]"
        data-testid="group-picker-trigger"
      >
        {hex && (
          <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: hex }}
          />
        )}
        {currentGroup ? currentGroup.name : "Group"}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute z-50 mt-1 right-0 min-w-[140px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded shadow-lg py-0.5"
          data-testid="group-picker-dropdown"
        >
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAssign(g.id);
                setOpen(false);
              }}
              className={`flex items-center gap-1.5 w-full text-left px-2 py-1 text-[11px] hover:bg-[var(--bg-hover)] ${
                currentGroupId === g.id ? "text-blue-400" : "text-[var(--text-secondary)]"
              }`}
              data-testid={`group-option-${g.id}`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: resolveGroupColor(g.color) }}
              />
              {g.name}
            </button>
          ))}

          {/* Unassign */}
          {currentGroupId && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAssign(null);
                setOpen(false);
              }}
              className="flex items-center gap-1.5 w-full text-left px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
              data-testid="group-option-unassign"
            >
              {i18nT("common.unassign", undefined, "Unassign")}
            </button>
          )}

          {/* Separator */}
          {onCreateGroup && (
            <>
              <div className="border-t border-[var(--border-secondary)] my-0.5" />
              {creating ? (
                <div className="px-2 py-1 flex items-center gap-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") handleCreate();
                      if (e.key === "Escape") {
                        setCreating(false);
                        setNewName("");
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={i18nT("common.groupName", undefined, "Group name")}
                    className="flex-1 text-[11px] bg-transparent border border-[var(--border-secondary)] rounded px-1 py-0.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-blue-500/50"
                    data-testid="group-create-input"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreating(true);
                  }}
                  className="flex items-center gap-1.5 w-full text-left px-2 py-1 text-[11px] text-blue-400 hover:bg-[var(--bg-hover)]"
                  data-testid="group-option-create"
                >
                  {i18nT("common.createNewGroup", undefined, "+ Create new group…")}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
