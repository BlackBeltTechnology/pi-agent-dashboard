/**
 * Draggable divider used by both split-workspace dividers (outer chat/editor
 * and inner browse-rail↔viewer). Presentational; the drag lifecycle lives in
 * `useResizeDrag`. `onResize` is the per-frame preview and `onResizeEnd` the
 * single commit (`null` = nothing to commit); the parent decides how to
 * interpret the coordinate (ratio vs pixel width). Orientation-aware cursor.
 *
 * Resize-only: it carries an always-visible dotted grip (the shared seam
 * signifier) and NO collapse control — collapse is driven solely by the header
 * `Chat│Split│Editor` switch. See change: redesign-split-layout-controls
 * (was: split-editor-workspace).
 */

import { useResizeDrag } from "../../hooks/useResizeDrag.js";
import type { SplitOrientation } from "../../lib/layout/split-state.js";
import { SeamGrip } from "./SeamGrip.js";

interface SplitDividerProps {
  /** `h` = side-by-side split → vertical bar, `col-resize`. `v` = stacked → row-resize. */
  orientation: SplitOrientation;
  /** Per-frame live preview with the pointer client coordinate (X for `h`, Y for `v`). */
  onResize: (clientPos: number) => void;
  onResizeStart?: () => void;
  /** Drag ended: final client coordinate to commit, or `null` for nothing to commit. */
  onResizeEnd?: (clientPos: number | null) => void;
  /** Extra classes for size/color per divider (outer vs inner rail). */
  className?: string;
  title?: string;
  "data-testid"?: string;
}

export function SplitDivider({
  orientation,
  onResize,
  onResizeStart,
  onResizeEnd,
  className = "",
  title,
  "data-testid": testId,
}: SplitDividerProps) {
  const drag = useResizeDrag({
    axis: orientation === "h" ? "x" : "y",
    cursor: orientation === "h" ? "col-resize" : "row-resize",
    onStart: onResizeStart,
    onPreview: onResize,
    onEnd: (pos) => onResizeEnd?.(pos),
  });

  const base =
    orientation === "h"
      ? "w-2.5 cursor-col-resize"
      : "h-2.5 w-full cursor-row-resize";

  return (
    <div
      // Resize handle: `aria-orientation` describes the drag axis. Not a
      // valued `separator` role (no aria-valuenow), so the role is omitted.
      aria-orientation={orientation === "h" ? "vertical" : "horizontal"}
      onPointerDown={drag.onPointerDown}
      onMouseDown={drag.onMouseDown}
      style={{ touchAction: "none" }}
      title={title}
      data-testid={testId}
      className={`relative flex shrink-0 items-center justify-center bg-[var(--border-primary)] transition-colors hover:bg-blue-500/40 active:bg-blue-500/60 ${base} ${className}`}
    >
      <SeamGrip dots={4} data-testid={testId ? `${testId}-grip` : undefined} />
    </div>
  );
}
