/**
 * Draggable divider used by both split-workspace dividers (outer chat/editor
 * and inner browse-rail↔viewer). Presentational + drag lifecycle only: it
 * reports the pointer client coordinate on each frame; the parent decides how
 * to interpret it (ratio vs pixel width). Orientation-aware cursor.
 *
 * Drag pattern extracted from `ResizableSidebar`.
 *
 * See change: split-editor-workspace.
 */

import { mdiChevronDown, mdiChevronLeft, mdiChevronRight, mdiChevronUp } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { t as i18nT } from "../lib/i18n";
import type { SplitOrientation } from "../lib/split-state.js";

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
  /**
   * Fold the chat pane away (‹ → editor `full`). When set alongside
   * `onCollapseEditor`, the divider renders two collapse chevrons. Each chevron
   * `stopPropagation`s its `mousedown` so a click never starts a resize drag
   * (drag-vs-click guard) and never mutates the persisted ratio.
   */
  onCollapseChat?: () => void;
  /** Fold the editor pane away (› → `closed`). */
  onCollapseEditor?: () => void;
}

export function SplitDivider({
  orientation,
  onResize,
  onResizeStart,
  onResizeEnd,
  className = "",
  title,
  "data-testid": testId,
  onCollapseChat,
  onCollapseEditor,
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
      ? "w-1.5 cursor-col-resize"
      : "h-1.5 w-full cursor-row-resize";

  // Chevron glyphs point at the pane they fold: ‹/↑ at the chat (→ `full`),
  // ›/↓ at the editor (→ `closed`). See design "Chevron direction rule".
  const foldChatIcon = orientation === "h" ? mdiChevronLeft : mdiChevronUp;
  const foldEditorIcon = orientation === "h" ? mdiChevronRight : mdiChevronDown;
  const showChevrons = Boolean(onCollapseChat || onCollapseEditor);

  // Stop the drag from starting when a chevron is pressed (drag-vs-click guard).
  const swallow = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      // Resize handle: `aria-orientation` describes the drag axis. Not a
      // valued `separator` role (no aria-valuenow), so the role is omitted.
      aria-orientation={orientation === "h" ? "vertical" : "horizontal"}
      onMouseDown={handleMouseDown}
      title={title}
      data-testid={testId}
      className={`relative shrink-0 bg-[var(--border-primary)] hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors ${base} ${className}`}
    >
      {showChevrons && (
        <div className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-1">
          {onCollapseChat && (
            <button
              type="button"
              onMouseDown={swallow}
              onClick={(e) => {
                e.stopPropagation();
                onCollapseChat();
              }}
              data-testid="split-fold-chat"
              title={i18nT("layout.foldChat", undefined, "Collapse chat")}
              aria-label={i18nT("layout.foldChat", undefined, "Collapse chat")}
              className="flex items-center justify-center rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-blue-400 hover:bg-blue-500/10"
            >
              <Icon path={foldChatIcon} size={0.5} />
            </button>
          )}
          {onCollapseEditor && (
            <button
              type="button"
              onMouseDown={swallow}
              onClick={(e) => {
                e.stopPropagation();
                onCollapseEditor();
              }}
              data-testid="split-fold-editor"
              title={i18nT("layout.foldEditor", undefined, "Collapse editor")}
              aria-label={i18nT("layout.foldEditor", undefined, "Collapse editor")}
              className="flex items-center justify-center rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-blue-400 hover:bg-blue-500/10"
            >
              <Icon path={foldEditorIcon} size={0.5} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
