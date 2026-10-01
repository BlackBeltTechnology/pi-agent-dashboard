/**
 * AddToWorkspaceMenu — popover menu listing existing workspaces plus a
 * "+ New workspace…" entry. Surfaced on the folder action bar.
 * See change: folder-workspaces.
 */

import { LayerPortal } from "@blackbelt-technology/pi-dashboard-client-utils/LayerPortal";
import type { Workspace } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import React, { useEffect, useRef } from "react";
import { usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  workspaces: Workspace[];
  /** Workspace id that currently owns this folder (null if none). */
  currentWorkspaceId: string | null;
  /** The toggle button this flyout anchors to (lives in the host row). */
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onPick: (workspaceId: string) => void;
  onNewWorkspace: () => void;
  onRemoveFromWorkspace: () => void;
  onClose: () => void;
}

// Matches the previous `mt-1`; a portaled `fixed` panel has no flow sibling.
const GAP = 4;
// Panel is `w-48` (192px); a 2–3 item menu wants no tall floor (dead space).
const MENU_WIDTH = 192;

export function AddToWorkspaceMenu({
  workspaces,
  currentWorkspaceId,
  triggerRef,
  onPick,
  onNewWorkspace,
  onRemoveFromWorkspace,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { flipUp, maxHeight, anchorRight, maxWidth, triggerRect } = usePopoverFlip(triggerRef, {
    open: true,
    estimatedWidth: MENU_WIDTH,
    minPopoverHeight: 0,
  });

  // Close on outside click / Escape. Check the portaled panel FIRST (it is no
  // longer a DOM descendant of the trigger's row), then the trigger itself (it
  // owns the toggle, so a click on it must not also fire close here).
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
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
  }, [onClose, triggerRef]);

  return (
    <LayerPortal>
    <div
      ref={panelRef}
      style={{
        width: MENU_WIDTH,
        maxHeight,
        maxWidth,
        visibility: triggerRect ? "visible" : "hidden",
        ...(triggerRect
          ? flipUp
            ? { bottom: Math.round(window.innerHeight - triggerRect.top + GAP) }
            : { top: Math.round(triggerRect.bottom + GAP) }
          : {}),
        ...(triggerRect
          ? anchorRight
            ? { right: Math.max(0, Math.round(window.innerWidth - triggerRect.right)) }
            : { left: Math.round(triggerRect.left) }
          : {}),
      }}
      className="fixed overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded shadow-lg z-popover py-1"
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
    </LayerPortal>
  );
}
