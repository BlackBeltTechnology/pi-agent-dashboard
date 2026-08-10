/**
 * Shared drag-and-drop helpers for the sidebar (`SessionList`).
 *
 * - `compatibleClosestCenter`: type-aware collision detection. Constrains
 *   candidate droppables to those the active draggable's `type` is allowed
 *   to target (`DRAG_TARGETS`) BEFORE measuring distance, so nested sortable
 *   contexts (folders/sessions inside an expanded workspace) do not
 *   capture a drag intended for an outer-type target.
 * - `resolveFolderMove`: pure (active, over) → folder gesture resolver for
 *   reorder / cross-workspace move / eject.
 *
 * See change: drag-folders-across-workspaces.
 * - `dropIndicatorProps`: shared highlighted-slot treatment (dashed
 *   outline + faint accent background) driven by dnd-kit `isOver`.
 * - `resolveWorkspaceReorder` / `resolveWorkspaceFolderReorder`: pure
 *   reorder resolvers (testable without driving dnd-kit).
 *
 * See change: workspace-directory-drag-reorder.
 */
import { type CollisionDetection, closestCenter } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

/** Dwell before a hovered collapsed workspace spring-opens during a drag. */
export const SPRING_LOAD_DWELL_MS = 600;

/** Min height of the empty-pinned-tier eject drop zone, in px. */
export const PINNED_TIER_MIN_HEIGHT_PX = 64;

/**
 * Which droppable `type`s each draggable `type` may resolve onto.
 * Folder-like actives (`workspace-folder`, `pinned-group`) can cross into
 * workspaces; `session` and `workspace` keep their shipped same-type wall.
 * `pinned-group` deliberately excludes `pinned-tier` — it is already
 * ejected, so the eject zone would be a dead target for it. See design D3.
 */
export const DRAG_TARGETS: Record<string, readonly string[]> = {
  session: ["session"],
  workspace: ["workspace"],
  "workspace-folder": [
    "workspace-folder",
    "workspace-header",
    "pinned-group",
    "pinned-tier",
  ],
  "pinned-group": ["workspace-folder", "workspace-header", "pinned-group"],
};

/**
 * Collision detection constrained to the active draggable's compatible
 * target types. A typeless active falls back to plain `closestCenter`
 * (unchanged). A typed active with no matrix row falls back to same-type
 * filtering — today's wall — never to closestCenter-over-all, which would
 * be strictly weaker than the shipped behavior.
 */
export const compatibleClosestCenter: CollisionDetection = (args) => {
  const t = args.active.data.current?.type;
  if (t == null) return closestCenter(args);
  const allowed = DRAG_TARGETS[t] ?? [t];
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) =>
      allowed.includes(c.data.current?.type),
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

/** Minimal workspace shape `resolveFolderMove` needs. */
export interface FolderMoveWorkspace {
  id: string;
  folders: string[];
}

/**
 * Outcome of a folder-like drag. `reorder-*` route to the shipped reorder
 * messages; `move` routes to `move_folder_to_workspace`.
 */
export type FolderMove =
  | { kind: "reorder-pinned" }
  | { kind: "reorder-folders"; wsId: string }
  | { kind: "move"; toWorkspaceId: string | null; index?: number };

/**
 * Resolve a folder-like drag from the (active, over) TYPE PAIR. Pure.
 * Returns null for every no-op: own slot, own workspace's header, a target
 * workspace the active is already a member of, or an unknown `wsId`.
 * See design D5.
 */
export function resolveFolderMove(args: {
  activeId: string;
  activeType: string | undefined;
  activeWsId: string | undefined;
  overId: string;
  overType: string | undefined;
  overWsId: string | undefined;
  workspaces: readonly FolderMoveWorkspace[];
}): FolderMove | null {
  const { activeId, activeType, activeWsId, overId, overType, overWsId, workspaces } = args;
  if (activeId === overId) return null;
  if (activeType !== "workspace-folder" && activeType !== "pinned-group") return null;

  if (overType === "pinned-group" || overType === "pinned-tier") {
    // A pinned group dropped on another pinned group is the shipped reorder.
    if (activeType === "pinned-group") {
      return overType === "pinned-group" ? { kind: "reorder-pinned" } : null;
    }
    return { kind: "move", toWorkspaceId: null };
  }

  if (overType === "workspace-header" || overType === "workspace-folder") {
    if (overWsId == null) return null;
    const target = workspaces.find((w) => w.id === overWsId);
    if (!target) return null;
    // Membership pre-check: the server rejects a same-workspace move, so
    // resolving one here would burn a round-trip. Also makes dropping a
    // folder on its OWN header a true no-op instead of a silent re-append.
    if (target.folders.includes(activeId)) {
      return overType === "workspace-folder" && activeType === "workspace-folder" && activeWsId === overWsId
        ? { kind: "reorder-folders", wsId: overWsId }
        : null;
    }
    if (overType === "workspace-header") {
      return { kind: "move", toWorkspaceId: overWsId };
    }
    const index = target.folders.indexOf(overId);
    return { kind: "move", toWorkspaceId: overWsId, ...(index === -1 ? {} : { index }) };
  }

  return null;
}
