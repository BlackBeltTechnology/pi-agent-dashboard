/**
 * Collapsible group section for OpenSpec changes.
 * Renders a header with color swatch, name, count, and chevron.
 * Optionally acts as a drop target for drag-and-drop change assignment.
 *
 * See change: add-openspec-change-grouping (task 6.1).
 */
import React, { type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Icon } from "@mdi/react";
import { mdiChevronDown, mdiChevronRight } from "@mdi/js";
import { resolveGroupColor } from "../../lib/openspec/openspec-group-palette.js";

interface Props {
  name: string;
  color?: string | null;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
  testId?: string;
  /** When set, this section becomes a droppable target with this id. */
  droppableId?: string;
}

export function OpenSpecGroupSection({
  name,
  color,
  count,
  expanded,
  onToggle,
  children,
  testId,
  droppableId,
}: Props) {
  const hex = resolveGroupColor(color);
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId ?? `group-drop-${name}`,
    disabled: !droppableId,
    data: { type: "openspec-group", groupId: droppableId },
  });

  return (
    <div
      ref={droppableId ? setNodeRef : undefined}
      data-testid={testId ?? `group-section-${name}`}
      className={isOver ? "ring-1 ring-blue-500/50 rounded" : ""}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="flex items-center gap-1.5 w-full text-left py-1 px-1 rounded hover:bg-[var(--bg-tertiary)] group"
        data-testid="group-section-header"
      >
        <Icon
          path={expanded ? mdiChevronDown : mdiChevronRight}
          size={0.45}
          className="text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]"
        />
        <span
          className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
          style={{ backgroundColor: hex }}
          data-testid="group-color-swatch"
        />
        <span className="text-[11px] font-medium text-[var(--text-secondary)] truncate">
          {name}
        </span>
        <span className="text-[10px] text-[var(--text-muted)] ml-auto">
          {count}
        </span>
      </button>
      {expanded && children && (
        <div className="ml-4" data-testid="group-section-body">
          {children}
        </div>
      )}
    </div>
  );
}
