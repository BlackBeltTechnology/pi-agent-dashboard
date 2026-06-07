/**
 * Group manager: create, rename, recolor, reorder, delete groups.
 * Used in Settings panel and via "Manage groups…" link.
 *
 * See change: add-openspec-change-grouping (task 6.4).
 */
import React, { useCallback, useState } from "react";
import { Icon } from "@mdi/react";
import { mdiDragHorizontalVariant, mdiPencilOutline, mdiTrashCanOutline, mdiPlus } from "@mdi/js";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { GROUP_PALETTE, resolveGroupColor, type PaletteEntry } from "../lib/openspec-group-palette.js";
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";

interface Props {
  groups: OpenSpecGroup[];
  onCreateGroup: (name: string, color: string) => Promise<void>;
  onUpdateGroup: (id: string, update: { name?: string; color?: string; order?: number }) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
}

function ColorSwatchGrid({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (entry: PaletteEntry) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap" data-testid="color-swatch-grid">
      {GROUP_PALETTE.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={(e) => { e.stopPropagation(); onSelect(p); }}
          className={`w-5 h-5 rounded-sm border-2 transition-colors ${
            selected === p.hex
              ? "border-white/60 scale-110"
              : "border-transparent hover:border-white/30"
          }`}
          style={{ backgroundColor: p.hex }}
          title={p.label}
          data-testid={`swatch-${p.id}`}
        />
      ))}
    </div>
  );
}

function SortableGroupRow({
  group,
  onEdit,
  onDelete,
}: {
  group: OpenSpecGroup;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-tertiary)] group/row"
      data-testid={`manager-group-${group.id}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab text-[var(--text-muted)] hover:text-[var(--text-secondary)] touch-none"
        data-testid="drag-handle"
      >
        <Icon path={mdiDragHorizontalVariant} size={0.5} />
      </button>
      <span
        className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
        style={{ backgroundColor: resolveGroupColor(group.color) }}
      />
      <span className="text-[12px] text-[var(--text-primary)] flex-1 truncate">
        {group.name}
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        className="text-[var(--text-muted)] hover:text-blue-400 opacity-0 group-hover/row:opacity-100 transition-opacity"
        data-testid="edit-group-btn"
        title="Edit"
      >
        <Icon path={mdiPencilOutline} size={0.45} />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="text-[var(--text-muted)] hover:text-red-400 opacity-0 group-hover/row:opacity-100 transition-opacity"
        data-testid="delete-group-btn"
        title="Delete"
      >
        <Icon path={mdiTrashCanOutline} size={0.45} />
      </button>
    </div>
  );
}

function InlineEditor({
  initial,
  initialColor,
  onSave,
  onCancel,
}: {
  initial?: string;
  initialColor?: string;
  onSave: (name: string, color: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial ?? "");
  const [color, setColor] = useState(initialColor ?? GROUP_PALETTE[0].hex);

  return (
    <div className="px-2 py-2 space-y-2 bg-[var(--bg-tertiary)] rounded" data-testid="inline-editor">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) onSave(name.trim(), color);
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Group name"
        className="w-full text-[12px] bg-transparent border border-[var(--border-secondary)] rounded px-2 py-1 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-blue-500/50"
        data-testid="group-name-input"
        autoFocus
      />
      <ColorSwatchGrid selected={color} onSelect={(p) => setColor(p.hex)} />
      <div className="flex gap-1.5 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="text-[10px] px-2 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => name.trim() && onSave(name.trim(), color)}
          disabled={!name.trim()}
          className="text-[10px] px-2 py-0.5 rounded border border-blue-500/50 text-blue-400 hover:bg-blue-500/10 disabled:opacity-40"
          data-testid="save-group-btn"
        >
          Save
        </button>
      </div>
    </div>
  );
}

export function OpenSpecGroupManager({
  groups,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OpenSpecGroup | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = groups.findIndex((g) => g.id === active.id);
      const newIndex = groups.findIndex((g) => g.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      // Compute new order: the dragged item gets the order of its destination
      const reordered = arrayMove(groups, oldIndex, newIndex);
      // Fire PATCH for each moved group with its new order
      for (let i = 0; i < reordered.length; i++) {
        if (reordered[i].order !== i) {
          await onUpdateGroup(reordered[i].id, { order: i });
        }
      }
    },
    [groups, onUpdateGroup],
  );

  const sorted = [...groups].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-2" data-testid="group-manager">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sorted.map((g) => g.id)}
          strategy={verticalListSortingStrategy}
        >
          {sorted.map((g) =>
            editingId === g.id ? (
              <InlineEditor
                key={g.id}
                initial={g.name}
                initialColor={g.color ?? GROUP_PALETTE[0].hex}
                onSave={async (name, color) => {
                  await onUpdateGroup(g.id, { name, color });
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <SortableGroupRow
                key={g.id}
                group={g}
                onEdit={() => setEditingId(g.id)}
                onDelete={() => setDeleteTarget(g)}
              />
            ),
          )}
        </SortableContext>
      </DndContext>

      {showCreate ? (
        <InlineEditor
          onSave={async (name, color) => {
            await onCreateGroup(name, color);
            setShowCreate(false);
          }}
          onCancel={() => setShowCreate(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 px-2 py-1"
          data-testid="add-group-btn"
        >
          <Icon path={mdiPlus} size={0.45} />
          Add group
        </button>
      )}

      {groups.length === 0 && !showCreate && (
        <p className="text-[11px] text-[var(--text-muted)] px-2">
          No groups yet. Create one to organize your changes.
        </p>
      )}

      {deleteTarget && (
        <Confirm
          open
          intent="danger"
          title="Delete group?"
          message={`Delete group "${deleteTarget.name}"? Assigned changes will revert to Ungrouped.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            await onDeleteGroup(deleteTarget.id);
            setDeleteTarget(null);
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
