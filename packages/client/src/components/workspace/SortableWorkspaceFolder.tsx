import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderDragHandleCtx } from "../session/SortablePinnedGroup.js";
import { dropIndicatorProps } from "../../lib/layout/sidebar-dnd.js";

interface Props {
  /** Folder cwd (sortable id). */
  id: string;
  /** Owning workspace id — carried in drag data for the cross-workspace guard. */
  wsId: string;
  children: React.ReactNode;
}

/**
 * Wraps a folder inside a workspace with dnd-kit sortable behavior. Carries
 * `wsId` in `useSortable` data so `handleDragEnd` can reject cross-workspace
 * drops. Feeds the folder's drag gutter via the shared `FolderDragHandleCtx`
 * (same channel `SortablePinnedGroup` uses), and renders the drop indicator
 * on `isOver`.
 *
 * See change: workspace-directory-drag-reorder.
 */
export function SortableWorkspaceFolder({ id, wsId, children }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
    active,
  } = useSortable({ id, data: { type: "workspace-folder", wsId } });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative",
  };

  const indicator = dropIndicatorProps(isOver, active?.id === id);

  const dragHandleProps = React.useMemo(
    () => ({ ...attributes, ...listeners }) as React.HTMLAttributes<HTMLDivElement>,
    [attributes, listeners],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-[14px] ${indicator.className}`}
      data-over={indicator["data-over"]}
      data-testid="sortable-workspace-folder"
    >
      <FolderDragHandleCtx.Provider value={dragHandleProps}>
        {children}
      </FolderDragHandleCtx.Provider>
    </div>
  );
}
