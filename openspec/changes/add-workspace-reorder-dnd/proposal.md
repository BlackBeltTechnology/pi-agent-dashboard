## Why

The `folder-workspaces` capability shipped with a fully implemented and tested
server contract for reordering — `reorder_workspaces` and
`reorder_workspace_folders` are wired through the gateway, validated, persisted,
and broadcast. But the client drag-and-drop UI that drives those messages was
explicitly deferred (archived `folder-workspaces` tasks 6.6 / 6.7). Today users
cannot reorder workspaces or the folders inside them except by remove + re-add.

Separately, the legacy `workspace-management` spec is an orphan: its capability
("workspace = single folder", REST API, `workspaces.json`, `sortOrder`) was
ripped out and never wired to any UI, the `folder-workspaces` change declared it
REMOVED, yet the standalone `openspec/specs/workspace-management/spec.md` file
was never deleted. It fails `openspec validate` (carries `## MODIFIED
Requirements` delta syntax in a canonical spec) and conflicts with the live
`folder-workspaces` model.

## What Changes

- **Add client DnD reorder for the workspace tier**: drag a workspace header to
  reorder workspaces; sends `reorder_workspaces` with the full ordered id list.
- **Add client DnD reorder for folders inside a workspace**: drag a folder
  within its workspace container; sends `reorder_workspace_folders` with the
  full ordered path list for that workspace.
- **Reuse the existing pin-reorder pattern**: a new `SortableWorkspaceHeader`
  wrapper (mirroring `SortablePinnedGroup`) and a workspace-folder sortable
  wrapper, both inside the existing top-level `DndContext`, distinguished by new
  drag-`type` discriminators so cross-type drags stay no-ops.
- **Remove the orphaned `workspace-management` capability**: delete
  `openspec/specs/workspace-management/spec.md`. The capability is not
  implemented anywhere and was already declared REMOVED by `folder-workspaces`.

## Capabilities

### New Capabilities
<!-- None — both reorder behaviors extend the existing folder-workspaces capability. -->

### Modified Capabilities
- `folder-workspaces`: Add requirements that the **client** SHALL provide
  drag-and-drop affordances that emit `reorder_workspaces` (workspace tier) and
  `reorder_workspace_folders` (intra-workspace folders). The existing
  server-contract requirements are unchanged.
- `workspace-management`: REMOVE the entire capability. Its requirements
  describe a ripped-out, never-implemented model and the spec file is an orphan
  that fails validation.

## Impact

- **Client** (`packages/client/src/`):
  - `components/SessionList.tsx` — wrap workspace tier in a `SortableContext`;
    wrap intra-workspace folders in a `SortableContext`; extend `handleDragEnd`
    with `workspace` and `workspace-folder` branches; add `onReorderWorkspaces`
    and `onReorderWorkspaceFolders` props.
  - New `components/SortableWorkspaceHeader.tsx` (drag wrapper + handle context).
  - New intra-workspace folder sortable wrapper (or extend the existing folder
    drag-handle context for the in-workspace case).
  - `components/WorkspaceHeader.tsx` — add a drag-handle gutter.
  - `App.tsx` — wire the two new callbacks to `send({ type: "reorder_workspaces", ids })`
    and `send({ type: "reorder_workspace_folders", id, paths })`.
- **Server**: none. The protocol, handlers, persistence, and tests already exist.
- **Specs**: modify `folder-workspaces`; remove `workspace-management`.
- **Dependencies**: none new — `@dnd-kit` is already used.
