import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { dropIndicatorProps } from "../../lib/layout/sidebar-dnd.js";

interface Props {
  id: string;
  children: React.ReactNode;
}

/**
 * Context channel that hands the dnd-kit drag handle props (attributes +
 * listeners) from `SortablePinnedGroup` down to the folder header. Using
 * context (instead of cloneElement) lets the wrapper accept arbitrary
 * children without traversal.
 */
export const FolderDragHandleCtx = React.createContext<React.HTMLAttributes<HTMLDivElement> | null>(null);

export function useFolderDragHandle() {
  return React.useContext(FolderDragHandleCtx);
}

export function SortablePinnedGroup({ id, children }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
    active,
  } = useSortable({ id, data: { type: "pinned-group" } });

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
      className={indicator.className}
      data-over={indicator["data-over"]}
      data-testid="sortable-pinned-group"
    >
      <FolderDragHandleCtx.Provider value={dragHandleProps}>{children}</FolderDragHandleCtx.Provider>
    </div>
  );
}
