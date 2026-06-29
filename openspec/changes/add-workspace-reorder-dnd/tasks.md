## 1. Workspace-tier reorder (drag wrapper + handle)

- [ ] 1.1 Create `packages/client/src/components/SortableWorkspaceHeader.tsx` mirroring `SortablePinnedGroup.tsx`: `useSortable({ id, data: { type: "workspace" } })`, transform/transition/opacity style, and a `WorkspaceDragHandleCtx` + `useWorkspaceDragHandle()` provider handing handle props to children
- [ ] 1.2 Add a drag-handle gutter to `WorkspaceHeader.tsx` (mirror `FolderDragGutter`): collapse chevron stays a click target with `stopPropagation` on pointerDown/click; column below the chevron is the grab zone consuming `useWorkspaceDragHandle()`
- [ ] 1.3 In `SessionList.tsx`, wrap the workspace-tier `workspaceTiers.workspaces.map(...)` in a `SortableContext items={workspaceIds}` and replace each `<li>` body with `<SortableWorkspaceHeader id={ws.id}>`

## 2. Intra-workspace folder reorder (drag wrapper)

- [ ] 2.1 Re-export `FolderDragHandleCtx` from `SortablePinnedGroup.tsx` (or expose a shared module) so an in-workspace folder wrapper can provide the same handle context the existing `FolderDragGutter` already consumes
- [ ] 2.2 Create an in-workspace folder sortable wrapper using `useSortable({ data: { type: "workspace-folder" } })` that provides `FolderDragHandleCtx`; wrap each folder rendered inside an expanded workspace body with it
- [ ] 2.3 In `SessionList.tsx`, wrap each workspace's folder `map` in a `SortableContext items={folderPaths}` scoped to that workspace

## 3. Dispatch wiring

- [ ] 3.1 Add `onReorderWorkspaces?: (ids: string[]) => void` and `onReorderWorkspaceFolders?: (id: string, paths: string[]) => void` to `SessionList` `Props`
- [ ] 3.2 Extend `handleDragEnd` with an `activeType === "workspace"` branch: `arrayMove` over workspace ids → `onReorderWorkspaces`
- [ ] 3.3 Extend `handleDragEnd` with an `activeType === "workspace-folder"` branch: find the owning workspace, `arrayMove` over its folder paths → `onReorderWorkspaceFolders` (no-op if active/over belong to different workspaces)
- [ ] 3.4 In `App.tsx`, wire `onReorderWorkspaces={(ids) => send({ type: "reorder_workspaces", ids })}` and `onReorderWorkspaceFolders={(id, paths) => send({ type: "reorder_workspace_folders", id, paths })}` (no optimistic local state; rely on `workspaces_updated`)

## 4. Tests

- [ ] 4.1 Component test: dragging a workspace header to a new slot calls `onReorderWorkspaces` with the full reordered id list; drop-on-self sends nothing
- [ ] 4.2 Component test: dragging a folder within a workspace calls `onReorderWorkspaceFolders` with that workspace id + reordered paths
- [ ] 4.3 Component test: cross-type drag (workspace over pinned-group; workspace-folder across two workspaces) is a no-op (no callback fired)
- [ ] 4.4 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm new + existing session/pinned drag tests pass

## 5. Spec cleanup

- [ ] 5.1 Delete `openspec/specs/workspace-management/spec.md` (capability removed per the REMOVED delta)
- [ ] 5.2 Confirm `openspec validate --specs` no longer reports the `workspace-management` Purpose-section error and that `folder-workspaces` validates with the new client requirements

## 6. Build & verify

- [ ] 6.1 `npm run build` then `curl -X POST http://localhost:8000/api/restart` (client change → rebuild + restart per Build & Restart Workflow)
- [ ] 6.2 Manual smoke: reorder two workspaces and two folders inside a workspace; reload page; order persists (server broadcast round-trip confirmed)
