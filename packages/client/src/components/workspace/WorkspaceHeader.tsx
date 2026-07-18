/**
 * WorkspaceHeader — header row for a workspace container.
 * Shows: name (double-click to rename), folder count, collapse chevron,
 * and a kebab menu (rename / delete).
 *
 * Rename UX mirrors session rename: double-click → InlineRenameInput,
 * Enter to commit, Esc/blur to cancel. No explicit check/× buttons.
 *
 * Add-folder-to-workspace now lives in an elevated `+ Add Folder` line
 * button at the bottom of the expanded workspace body (SessionList), not
 * in this header. See change: elevate-dashboard-add-buttons.
 *
 * See change: folder-workspaces.
 */

import {
  mdiChevronDown,
  mdiChevronRight,
  mdiDotsVertical,
  mdiDrag,
} from "@mdi/js";
import Icon from "@mdi/react";
import React, { useEffect, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { InlineRenameInput } from "../primitives/InlineRenameInput.js";
import { useWorkspaceDragHandle } from "./SortableWorkspace.js";

interface Props {
  id: string;
  name: string;
  collapsed: boolean;
  folderCount: number;
  onToggleCollapsed: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
}

const NAME_MAX = 80;

export function WorkspaceHeader({
  id,
  name,
  collapsed,
  folderCount,
  onToggleCollapsed,
  onRename,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dragHandleProps = useWorkspaceDragHandle();
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function commitRename(next: string) {
    const trimmed = next.trim();
    if (trimmed.length === 0 || trimmed.length > NAME_MAX) {
      setEditing(false);
      return;
    }
    if (trimmed !== name) onRename(trimmed);
    setEditing(false);
  }

  function confirmDelete() {
    setMenuOpen(false);
    if (folderCount > 0) {
      // Confirm-gate non-empty workspaces. Native confirm keeps this
      // change small; can promote to a styled ConfirmDialog later.
      const ok = window.confirm(
        `Delete workspace "${name}"? Its ${folderCount} folder${folderCount === 1 ? "" : "s"} will return to top-level behavior.`,
      );
      if (!ok) return;
    }
    onDelete();
  }

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1.5 bg-[var(--bg-tertiary)] rounded-t-lg select-none shadow-[inset_0_1px_0_var(--elevation-rim),0_2px_4px_var(--shadow-card)]"
      data-testid={`workspace-header-${id}`}
    >
      {dragHandleProps && (
        <div
          {...dragHandleProps}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] shrink-0 cursor-grab active:cursor-grabbing"
          title={i18nT("folders.dragToReorderWorkspace", undefined, "Drag to reorder workspace")}
          data-testid={`workspace-drag-handle-${id}`}
          aria-label={i18nT("folders.dragToReorderWorkspace", undefined, "Drag to reorder workspace")}
        >
          <Icon path={mdiDrag} size={0.6} />
        </div>
      )}
      <button
        onClick={onToggleCollapsed}
        className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] shrink-0"
        title={collapsed ? "Expand workspace" : "Collapse workspace"}
        data-testid={`workspace-toggle-${id}`}
        aria-label={collapsed ? "Expand workspace" : "Collapse workspace"}
      >
        <Icon path={collapsed ? mdiChevronRight : mdiChevronDown} size={0.6} />
      </button>

      {editing ? (
        <InlineRenameInput
          currentName={name}
          onConfirm={commitRename}
          onCancel={() => setEditing(false)}
          className="flex-1 min-w-0 text-xs font-semibold"
        />
      ) : (
        <span
          onDoubleClick={() => setEditing(true)}
          className="flex-1 min-w-0 text-xs font-semibold text-[var(--text-primary)] truncate cursor-text"
          title={i18nT("common.doubleClickToRename", undefined, "Double-click to rename")}
          data-testid={`workspace-name-${id}`}
        >
          {name}
        </span>
      )}

      <span className="text-[10px] text-[var(--text-muted)] shrink-0">
        ({folderCount})
      </span>

      {!editing && (
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((p) => !p)}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] px-0.5"
            title={i18nT("folders.workspaceActions", undefined, "Workspace actions")}
            data-testid={`workspace-menu-btn-${id}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <Icon path={mdiDotsVertical} size={0.55} />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 mt-1 w-36 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded shadow-lg z-50 py-1"
              role="menu"
              data-testid={`workspace-menu-${id}`}
            >
              <button
                onClick={() => {
                  setEditing(true);
                  setMenuOpen(false);
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]"
                data-testid={`workspace-menu-rename-${id}`}
              >
                {i18nT("common.rename", undefined, "Rename")}
              </button>
              <button
                onClick={confirmDelete}
                className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-[var(--bg-primary)]"
                data-testid={`workspace-menu-delete-${id}`}
              >
                {i18nT("common.delete", undefined, "Delete")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
