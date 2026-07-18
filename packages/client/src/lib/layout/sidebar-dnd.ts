/**
 * Shared drag-and-drop helpers for the sidebar (`SessionList`).
 *
 * - `sameTypeClosestCenter`: type-aware collision detection. Constrains
 *   candidate droppables to those whose drag `type` matches the active
 *   draggable's `type` BEFORE measuring distance, so nested sortable
 *   contexts (folders/sessions inside an expanded workspace) do not
 *   capture a drag intended for an outer-type target.
 * - `dropIndicatorProps`: shared highlighted-slot treatment (dashed
 *   outline + faint accent background) driven by dnd-kit `isOver`.
 * - `resolveWorkspaceReorder` / `resolveWorkspaceFolderReorder`: pure
 *   reorder resolvers (testable without driving dnd-kit).
 *
 * See change: workspace-directory-drag-reorder.
 */
import { closestCenter, type CollisionDetection } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

/**
 * Collision detection that only considers droppables sharing the active
 * draggable's `type`. Falls back to plain `closestCenter` when the active
 * draggable has no `type`.
 */
export const sameTypeClosestCenter: CollisionDetection = (args) => {
  const t = args.active.data.current?.type;
  if (t == null) return closestCenter(args);
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (c) => c.data.current?.type === t,
    ),
  });
};

/** Dashed-slot highlight shown on the hovered drop target. */
export const DROP_INDICATOR_CLASS =
  "outline-dashed outline-1 outline-[var(--accent-primary)] " +
  "bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)]";

/**
 * Props for the highlighted drop slot. Active only when the slot is hovered
 * by another draggable (`isOver` and not the dragged item itself).
 */
export function dropIndicatorProps(isOver: boolean, isSelf: boolean): {
  className: string;
  "data-over"?: "true";
} {
  const active = isOver && !isSelf;
  return {
    className: active ? DROP_INDICATOR_CLASS : "",
    ...(active ? { "data-over": "true" as const } : {}),
  };
}

/**
 * Compute the new workspace id ordering after a drop. Returns null when the
 * move is a no-op (same slot, or either id missing).
 */
export function resolveWorkspaceReorder(
  ids: string[],
  activeId: string,
  overId: string,
): string[] | null {
  if (activeId === overId) return null;
  const oldIndex = ids.indexOf(activeId);
  const newIndex = ids.indexOf(overId);
  if (oldIndex === -1 || newIndex === -1) return null;
  return arrayMove(ids, oldIndex, newIndex);
}

/**
 * Compute the new folder ordering within ONE workspace after a drop.
 * Returns null when the move is cross-workspace (guard), a no-op, or
 * references a missing path. Folders only reorder within their own
 * workspace; cross-workspace drops are rejected.
 */
export function resolveWorkspaceFolderReorder(
  paths: string[],
  activeId: string,
  overId: string,
  activeWsId: string | undefined,
  overWsId: string | undefined,
): string[] | null {
  if (activeId === overId) return null;
  if (activeWsId == null || activeWsId !== overWsId) return null;
  const oldIndex = paths.indexOf(activeId);
  const newIndex = paths.indexOf(overId);
  if (oldIndex === -1 || newIndex === -1) return null;
  return arrayMove(paths, oldIndex, newIndex);
}
