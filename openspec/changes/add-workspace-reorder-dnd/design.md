## Context

Workspace reordering has a complete, tested server contract — `reorder_workspaces`
and `reorder_workspace_folders` are routed in `browser-gateway.ts`, validated and
persisted by `preferences-store.ts` (set-equality + duplicate rejection), and
broadcast as `workspaces_updated`. The client side was deferred: the archived
`folder-workspaces` tasks 6.6 / 6.7 are marked `[~]`. The original design already
earmarked the implementation path: *"within-workspace reorder reuses
`SortablePinnedGroup.tsx` pattern ... Two independent DnD contexts:
`reorder_workspaces` for the outer list, `reorder_workspace_folders` for inner."*

The existing sidebar DnD lives in `SessionList.tsx` under one top-level
`DndContext` (`closestCenter`). Two reorder behaviors already work there:
- **Sessions** — `SortableSessionCard` (drag-`type: "session"`), per-folder
  `SortableContext`, dispatched to `onReorderSessions`.
- **Pinned folder groups** — `SortablePinnedGroup` (drag-`type: "pinned-group"`),
  top-level `SortableContext`, dispatched to `onReorderPinnedDirs`.

`handleDragEnd` discriminates on `active.data.current.type`, returns early on
cross-type drags, and uses `arrayMove` to compute the new ordering. Drag handles
are passed to children via React context (`FolderDragHandleCtx`,
`DragHandleCtx`), not `cloneElement`.

This change adds two more reorder behaviors using the same pattern, and removes
the orphaned `workspace-management` spec.

## Goals / Non-Goals

**Goals:**
- Drag-to-reorder the workspace tier; emit `reorder_workspaces`.
- Drag-to-reorder folders inside one workspace; emit `reorder_workspace_folders`.
- Reuse the established `SortablePinnedGroup` + `FolderDragHandleCtx` pattern.
- Keep the server as the single source of truth (no optimistic reorder).
- Delete the orphaned, validation-failing `workspace-management/spec.md`.

**Non-Goals:**
- Cross-container drag (folder A→workspace B, or workspace folder→top-level).
  Already a documented non-goal of `folder-workspaces`.
- Any server change. The contract and tests already exist.
- Reordering top-level (non-workspace) unpinned folders.
- Touching the `accordion-workspace-folders` proposal; the two coexist (DnD uses
  pointer drag, collapse uses click).

## Decisions

### D1 — New drag-`type` discriminators, not reuse of existing ones
Introduce `type: "workspace"` for workspace headers and `type: "workspace-folder"`
for folders inside a workspace. Distinct from `"pinned-group"` so the existing
cross-type guard (`activeType !== overType` → no-op) automatically prevents a
workspace being dropped on a pinned folder and a workspace-folder being dropped
on a top-level pinned group.

*Alternative considered*: reuse `"pinned-group"` for in-workspace folders. Rejected
— it would make a workspace folder and a top-level pinned folder mutually valid
drop targets, enabling accidental cross-container drags that the spec forbids.

### D2 — Two sibling `SortableContext`s for workspaces, one nested per workspace for its folders
- Wrap the workspace tier `map` in a `SortableContext items={workspaceIds}`.
- Inside each expanded workspace body, wrap its folder `map` in a
  `SortableContext items={folderPaths}` scoped to that workspace.
All remain children of the single existing `DndContext`. `closestCenter` already
handles vertically stacked items; the type guard isolates each sortable set.

*Alternative considered*: a second `DndContext` for the workspace tier. Rejected —
nested `DndContext`s complicate sensor/collision handling and the existing single
context already hosts multiple `SortableContext`s without issue.

### D3 — New `SortableWorkspaceHeader` wrapper + `WorkspaceDragHandleCtx`
Mirror `SortablePinnedGroup.tsx` exactly: `useSortable({ data: { type: "workspace" } })`,
transform/transition/opacity style, and a context provider handing drag-handle
props down to a gutter rendered inside `WorkspaceHeader`. `WorkspaceHeader` gains
a drag-handle gutter column (mirroring `FolderDragGutter`) anchored at the
collapse chevron, so the chevron stays a click target and the column below it is
the grab zone.

### D4 — In-workspace folder drag handle
Folders inside a workspace are rendered by the existing `renderGroup(folder, pinned, inWorkspace=true)`,
whose `FolderDragGutter` already calls `useFolderDragHandle()`. Today that context
is only provided by `SortablePinnedGroup`, so in-workspace folders render an inert
gutter. Wrap each in-workspace folder in a new sortable that provides the SAME
`FolderDragHandleCtx` (re-exported from `SortablePinnedGroup`) but with
`data: { type: "workspace-folder" }`. This reuses the existing gutter UI with zero
changes to `renderGroup`.

*Alternative considered*: a separate `WorkspaceFolderDragHandleCtx`. Rejected as
unnecessary — the gutter only needs handle props; the drag `type` is set on the
`useSortable` call in the wrapper, not in the gutter.

### D5 — No optimistic UI
Consistent with every other workspace mutation in this codebase (see App.tsx
comment: *"server is the single source of truth and broadcasts `workspaces_updated`
for every mutation"*). `handleDragEnd` computes `arrayMove` only to build the
`ids` / `paths` payload, then dispatches; the visible order updates when
`workspaces_updated` returns.

### D6 — Orphan removal via REMOVED delta + file deletion
The `workspace-management` capability is removed through a `## REMOVED
Requirements` delta. On apply, the canonical `openspec/specs/workspace-management/spec.md`
is deleted. No code or data migration — nothing implements it.

## Risks / Trade-offs

- **Nested `SortableContext` collision ambiguity** (workspace tier vs. a
  workspace's folders both vertical) → Mitigated by D1's type guard: even if
  `closestCenter` picks a cross-type droppable, `handleDragEnd` no-ops.
- **No optimistic UI = perceptible lag on slow links** → Accepted; matches all
  existing workspace mutations and keeps one source of truth. Round-trip is
  local-network/loopback in practice.
- **`WorkspaceHeader` gutter could swallow chevron clicks** → Mitigated by the
  proven `FolderDragGutter` pattern: chevron button calls
  `e.stopPropagation()` on `pointerDown`/`click` so the drag listener does not
  compete.
- **Drag handle on touch** → Existing `TouchSensor` (250ms delay) already covers
  the shared `DndContext`; new sortables inherit it.

## Migration Plan

1. Land client wrappers + wiring; no server deploy needed.
2. Apply spec deltas: `folder-workspaces` gains client requirements;
   `workspace-management` capability removed and its spec file deleted.
3. Rollback: revert the client commit; server contract is untouched and remains
   backward-compatible (it already accepts these messages).

## Open Questions

- Should the workspace drag handle be the chevron gutter (D3) or the full header
  bar? Leaning chevron gutter for consistency with folders; revisit if QA finds
  the grab target too small.
