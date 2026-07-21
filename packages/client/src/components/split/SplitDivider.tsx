/**
 * Draggable divider used by both split-workspace dividers (outer chat/editor
 * and inner browse-rail↔viewer). Presentational + drag lifecycle only: it
 * reports the pointer client coordinate on each frame; the parent decides how
 * to interpret it (ratio vs pixel width). Orientation-aware cursor.
 *
 * Resize-only: it carries an always-visible dotted grip (the shared seam
 * signifier) and NO collapse control — collapse is driven solely by the header
 * `Chat│Split│Editor` switch. See change: redesign-split-layout-controls
 * (was: split-editor-workspace).
 */

import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import type { SplitOrientation } from "../../lib/layout/split-state.js";
import { SeamGrip } from "./SeamGrip.js";

interface SplitDividerProps {
  /** `h` = side-by-side split → vertical bar, `col-resize`. `v` = stacked → row-resize. */
  orientation: SplitOrientation;
  /** Called on each drag frame with the pointer client coordinate (X for `h`, Y for `v`). */
  onResize: (clientPos: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
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
  const dragging = useRef(false);
  const cursor = orientation === "h" ? "col-resize" : "row-resize";

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";
      onResizeStart?.();
    },
    [cursor, onResizeStart],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      onResize(orientation === "h" ? e.clientX : e.clientY);
    };
    const handleMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onResizeEnd?.();
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [orientation, onResize, onResizeEnd]);

  const base =
    orientation === "h"
      ? "w-2.5 cursor-col-resize"
      : "h-2.5 w-full cursor-row-resize";

  return (
    <div
      // Resize handle: `aria-orientation` describes the drag axis. Not a
      // valued `separator` role (no aria-valuenow), so the role is omitted.
      aria-orientation={orientation === "h" ? "vertical" : "horizontal"}
      onMouseDown={handleMouseDown}
      title={title}
      data-testid={testId}
      className={`relative flex shrink-0 items-center justify-center bg-[var(--border-primary)] transition-colors hover:bg-blue-500/40 active:bg-blue-500/60 ${base} ${className}`}
    >
      <SeamGrip dots={4} data-testid={testId ? `${testId}-grip` : undefined} />
    </div>
  );
}
