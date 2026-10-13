import { mdiArrowExpandAll, mdiMagnifyMinusOutline, mdiMagnifyPlusOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
// Shared zoom controls — used by MermaidBlock, DiagramPreview, FlowGraph and team-app

export interface ZoomControlLabels {
  zoomIn: string;
  zoomOut: string;
  reset: string;
}

const DEFAULT_LABELS: ZoomControlLabels = { zoomIn: "Zoom in", zoomOut: "Zoom out", reset: "Reset zoom" };

export function ZoomControls({
  onZoomIn,
  onZoomOut,
  onReset,
  scale,
  initialScale = 1,
  labels = DEFAULT_LABELS,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  scale: number;
  /** Scale the surface starts/resets at; the % readout shows only when scale differs. */
  initialScale?: number;
  /** Accessible names + titles. client-utils has no i18n, so hosts pass translated strings. */
  labels?: ZoomControlLabels;
}) {
  // Icon-only buttons: 44 px below `sm`, 32 px from `sm` (ui-contract tap-target).
  const btnClass =
    "focus-ring min-w-[44px] min-h-[44px] sm:min-w-[32px] sm:min-h-[32px] flex items-center justify-center rounded " +
    "bg-[var(--bg-surface)]/80 hover:bg-[var(--bg-surface)] " +
    "border border-[var(--border-subtle)] " +
    "text-[var(--text-secondary)] hover:text-[var(--text-primary)] " +
    "transition-colors cursor-pointer select-none";

  return (
    <div
      className="absolute top-2 right-2 z-10 flex flex-col gap-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button type="button" className={btnClass} onClick={onZoomIn} title={labels.zoomIn} aria-label={labels.zoomIn}>
        <Icon path={mdiMagnifyPlusOutline} size={0.6} aria-hidden="true" />
      </button>
      <button type="button" className={btnClass} onClick={onZoomOut} title={labels.zoomOut} aria-label={labels.zoomOut}>
        <Icon path={mdiMagnifyMinusOutline} size={0.6} aria-hidden="true" />
      </button>
      <button type="button" className={btnClass} onClick={onReset} title={labels.reset} aria-label={labels.reset}>
        <Icon path={mdiArrowExpandAll} size={0.6} aria-hidden="true" />
      </button>
      <div aria-live="polite" className="text-[11px] text-[var(--text-secondary)] text-center tabular-nums">
        {scale !== initialScale ? `${Math.round(scale * 100)}%` : null}
      </div>
    </div>
  );
}
