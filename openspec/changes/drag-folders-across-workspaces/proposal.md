# Drag folders into, out of, and between workspaces

## Why

The sidebar ships drag-to-reorder for workspaces, for folders *within* one
workspace, and for pinned groups (`sidebar-drag-reorder`). Every gesture that
changes workspace *membership* is menu-only today (`AddToWorkspaceMenu`,
`onRemoveFolderFromWorkspace` header button). The current spec explicitly
rejects cross-workspace folder drags.

Users expect the obvious direct-manipulation gesture: grab a directory, drop it
where it belongs. Three membership moves are missing:

1. a pinned directory dragged **into** a workspace
2. a workspace folder dragged **out** to the pinned tier
3. a workspace folder dragged **between** two workspaces

## What Changes

- **New protocol message** `move_folder_to_workspace { path, toWorkspaceId, index? }`.
  A nullable target expresses all three gestures in one atomic server mutation
  and one `workspaces_updated` broadcast:
  - `toWorkspaceId: <id>` — detach from any other workspace, insert at `index`
    (append when omitted).
  - `toWorkspaceId: null` — detach from every workspace **and pin the
    directory**, so an ejected folder with no live sessions cannot vanish from
    the sidebar.
  The target id is resolved **before** any mutation, so a stale id cannot leave
  the folder in zero workspaces.
- **Ejecting reuses the full pin path**, not just `pinDirectory` — the extracted
  `pinDirectorySideEffects` helper keeps on-disk session discovery and the
  OpenSpec scan that `handlePinDirectory` performs today.
- **Compatibility-matrix collision detection** replaces `sameTypeClosestCenter`,
  and the `activeType !== overType` early return in `handleDragEnd` is replaced
  by per-active-type guards so every shipped gesture keeps its current path.
- **Two drop affordances per workspace**: a new header-sized droppable (append)
  and the positional slots between folders inside an expanded workspace.
- **Spring-load**: hovering a collapsed workspace header during a drag
  auto-expands it after a short delay, so the positional slots are reachable.
  Client-local and visual only; never persists `set_workspace_collapsed`.
- **BREAKING (spec)**: the `Cross-workspace folder drag is rejected` scenario is
  removed from `sidebar-drag-reorder`.
- Existing `add_folder_to_workspace` / `remove_folder_from_workspace` are
  unchanged — the menu affordances keep using them.

## Impact

- Affected specs: `sidebar-drag-reorder`
- Affected code:
  - `packages/shared/src/browser-protocol.ts` — new message type
  - `packages/server/src/persistence/preferences-store.ts` — `moveFolderToWorkspace`
  - `packages/server/src/browser-handlers/directory-handler.ts` + gateway dispatch
  - `packages/client/src/components/session/SessionList.tsx` — collision fn, `handleDragEnd`
  - `packages/client/src/components/workspace/SortableWorkspace*.tsx` — droppables, spring-load
- Non-goals: dragging *unpinned* directory rows (they have no drag handle or
  `data.type` today — users pin first); session-card drags across folders;
  workspace reordering (shipped).

## Discipline Skills

- `review-code` — non-trivial client DnD + protocol change before commit.
- `doubt-driven-review` — the new protocol message and the removal of a shipped
  spec scenario are hard to reverse once broadcast semantics land.
