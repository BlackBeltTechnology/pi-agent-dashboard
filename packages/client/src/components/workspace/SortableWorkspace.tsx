import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { dropIndicatorProps } from "../../lib/layout/sidebar-dnd.js";

interface Props {
  id: string;
  children: React.ReactNode;
}

/**
 * Context channel handing dnd-kit drag-handle props (attributes + listeners)
 * from `SortableWorkspace` down to `WorkspaceHeader`. Mirrors the
 * `FolderDragHandleCtx` pattern in `SortablePinnedGroup`.
 *
 * See change: workspace-directory-drag-reorder.
 */
const WorkspaceDragHandleCtx =
  React.createContext<React.HTMLAttributes<HTMLDivElement> | null>(null);

export function useWorkspaceDragHandle() {
  return React.useContext(WorkspaceDragHandleCtx);
}

/** Wraps a workspace tier with dnd-kit sortable behavior + drop indicator. */
export function SortableWorkspace({ id, children }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
    active,
  } = useSortable({ id, data: { type: "workspace" } });

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
      className={`rounded-lg ${indicator.className}`}
      data-over={indicator["data-over"]}
      data-testid="sortable-workspace"
    >
      <WorkspaceDragHandleCtx.Provider value={dragHandleProps}>
        {children}
      </WorkspaceDragHandleCtx.Provider>
    </div>
  );
}
