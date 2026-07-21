import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Props {
  id: string;
  children: React.ReactNode;
}

/**
 * Context channel that hands the dnd-kit drag handle props (attributes +
 * listeners) from `SortableSessionCard` to a descendant `SessionCard`. Using
 * context (instead of cloneElement) lets `SortableSessionCard` accept
 * arbitrary children (e.g. a SessionCard plus a resume-error banner sibling)
 * without needing to traverse and identify the SessionCard.
 */
const DragHandleCtx = React.createContext<React.HTMLAttributes<HTMLDivElement> | null>(null);

export function useSessionCardDragHandle() {
  return React.useContext(DragHandleCtx);
}

/**
 * Wraps a SessionCard with dnd-kit sortable behavior. The card's existing
 * left gutter (status dot + source icon column) becomes the drag zone via
 * the DragHandleCtx — no separate handle icon needed.
 */
export function SortableSessionCard({ id, children }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, data: { type: "session" } });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative",
  };

  const dragHandleProps = React.useMemo(
    () => ({ ...attributes, ...listeners }) as React.HTMLAttributes<HTMLDivElement>,
    [attributes, listeners],
  );

  return (
    <div ref={setNodeRef} style={style}>
      <DragHandleCtx.Provider value={dragHandleProps}>{children}</DragHandleCtx.Provider>
    </div>
  );
}
