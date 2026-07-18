/**
 * AddToWorkspaceMenu — popover menu listing existing workspaces plus a
 * "+ New workspace…" entry. Surfaced on the folder action bar.
 * See change: folder-workspaces.
 */

import type { Workspace } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import React, { useEffect, useRef } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  workspaces: Workspace[];
  /** Workspace id that currently owns this folder (null if none). */
  currentWorkspaceId: string | null;
  onPick: (workspaceId: string) => void;
  onNewWorkspace: () => void;
  onRemoveFromWorkspace: () => void;
  onClose: () => void;
}

export function AddToWorkspaceMenu({
  workspaces,
  currentWorkspaceId,
  onPick,
  onNewWorkspace,
  onRemoveFromWorkspace,
  onClose,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="absolute right-0 mt-1 w-48 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded shadow-lg z-50 py-1"
      data-testid="add-to-workspace-menu"
    >
      {workspaces.length === 0 && (
        <div className="px-3 py-1.5 text-[11px] text-[var(--text-muted)] italic">
          {i18nT("folders.noWorkspacesYet", undefined, "No workspaces yet")}
        </div>
      )}
      {workspaces.map((w) => {
        const isCurrent = w.id === currentWorkspaceId;
        return (
          <button
            key={w.id}
            onClick={() => onPick(w.id)}
            disabled={isCurrent}
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] disabled:opacity-50 disabled:cursor-default"
            data-testid={`add-to-workspace-pick-${w.id}`}
          >
            {isCurrent ? "✓ " : ""}{w.name}
          </button>
        );
      })}
      {currentWorkspaceId !== null && (
        <>
          <div className="border-t border-[var(--border-subtle)] my-1" />
          <button
            onClick={onRemoveFromWorkspace}
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]"
            data-testid="remove-from-workspace"
          >
            {i18nT("folders.removeFromWorkspace", undefined, "Remove from workspace")}
          </button>
        </>
      )}
      <div className="border-t border-[var(--border-subtle)] my-1" />
      <button
        onClick={onNewWorkspace}
        className="w-full text-left px-3 py-1.5 text-xs text-[var(--accent-blue)] hover:bg-[var(--bg-primary)]"
        data-testid="add-to-workspace-new"
      >
        {i18nT("folders.newWorkspace", undefined, "+ New workspace…")}
      </button>
    </div>
  );
}
