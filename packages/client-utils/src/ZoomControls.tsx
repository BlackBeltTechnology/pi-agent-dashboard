import React from "react";
import { Icon } from "@mdi/react";
import { mdiMagnifyPlusOutline, mdiMagnifyMinusOutline, mdiArrowExpandAll } from "@mdi/js";
// Shared zoom controls — used by MermaidBlock and FlowGraph

export function ZoomControls({
  onZoomIn,
  onZoomOut,
  onReset,
  scale,
  initialScale = 1,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  scale: number;
  /** Scale the surface starts/resets at; the % readout shows only when scale differs. */
  initialScale?: number;
}) {
  const btnClass =
    "w-7 h-7 flex items-center justify-center rounded " +
    "bg-[var(--bg-surface)]/80 hover:bg-[var(--bg-surface)] " +
    "border border-[var(--border-subtle)] " +
    "text-[var(--text-secondary)] hover:text-[var(--text-primary)] " +
    "transition-colors cursor-pointer select-none";

  return (
    <div
      className="absolute top-2 right-2 z-10 flex flex-col gap-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button className={btnClass} onClick={onZoomIn} title="Zoom in">
        <Icon path={mdiMagnifyPlusOutline} size={0.6} />
      </button>
      <button className={btnClass} onClick={onZoomOut} title="Zoom out">
        <Icon path={mdiMagnifyMinusOutline} size={0.6} />
      </button>
      <button className={btnClass} onClick={onReset} title="Reset zoom">
        <Icon path={mdiArrowExpandAll} size={0.6} />
      </button>
      {scale !== initialScale && (
        <div className="text-[10px] text-[var(--text-muted)] text-center tabular-nums">
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  );
}
