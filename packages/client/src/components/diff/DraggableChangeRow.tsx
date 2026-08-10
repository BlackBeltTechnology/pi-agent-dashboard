/**
 * Wrapper that makes an OpenSpec change row draggable.
 * Used inside the grouped view of FolderOpenSpecSection.
 *
 * See change: add-openspec-change-grouping (drag-and-drop).
 */
import React, { type ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

interface Props {
  changeName: string;
  children: ReactNode;
}

export function DraggableChangeRow({ changeName, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `change-${changeName}`,
    data: { type: "openspec-change", changeName },
  });

  const style: React.CSSProperties = {
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    opacity: isDragging ? 0.5 : 1,
    position: "relative",
    zIndex: isDragging ? 50 : undefined,
    cursor: "grab",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="touch-none"
      data-testid={`draggable-change-${changeName}`}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}
