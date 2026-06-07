# Tasks

## 1. New component
- [x] 1.1 Add `packages/client/src/components/DashboardSpawnButtons.tsx` mirroring `FolderSpawnButtons.tsx` structure. Props: `onAddFolder`, `onNewWorkspace?`, `addFolderDisabled?`. Render `+ Add Folder` (yellow, `data-testid="dashboard-add-folder-btn"`); render `+ New Workspace` (neutral, `data-testid="dashboard-new-workspace-btn"`) only when `onNewWorkspace` provided. → verify: component renders both buttons in test; New Workspace omitted when handler absent.

## 2. Wire into SessionList
- [x] 2.1 Render `<DashboardSpawnButtons>` as the first `<li>` in the scroll `<ul>`, above workspace tiers. Pass `onAddFolder={() => onOpenPinDialog?.()}` (gated on `onPinDirectory`/`onOpenPinDialog`) and `onNewWorkspace={onCreateWorkspace ? () => setNewWsOpen({pendingFolder:null}) : undefined}`. → verify: pair appears before workspace tiers in DOM order.
- [x] 2.2 Remove the `📌 Folder` chip from the header filter bar (`SessionList.tsx` ~970). Keep both search inputs + `Hidden` toggle. → verify: `pin-dir-dialog-btn` no longer in header.
- [x] 2.3 Remove the mid-list dashed `+ New workspace…` `<li>` (~1029). → verify: `new-workspace-btn` dashed item gone; only `dashboard-new-workspace-btn` remains.
- [x] 2.4 In the expanded workspace body (`SessionList.tsx` ~975, after the folders map), render `<DashboardSpawnButtons onAddFolder={() => setPickFolderForWsId(ws.id)} />` (Add-Folder-only mode, `data-testid="workspace-add-folder-btn-<id>"`). Keep the empty-workspace hint above it. → verify: expanded workspace shows full-width Add Folder; collapsed hides it.
- [x] 2.5 Remove the `mdiPin` add-folder icon button from `WorkspaceHeader.tsx` (drop the `onAddFolderViaPicker` button block; prop no longer rendered in header). → verify: `workspace-add-folder-<id>` icon gone from header.

## 3. Tests
- [x] 3.1 Update/add tests asserting: Add Folder click calls `onOpenPinDialog`; New Workspace click opens new-workspace flow; New Workspace hidden without `onCreateWorkspace`; header no longer renders folder pin chip; expanded workspace renders Add Folder button wired to `setPickFolderForWsId`; WorkspaceHeader no longer renders `mdiPin` icon. → verify: `npm test 2>&1 | tee /tmp/pi-test.log` green.

## 4. Build + restart (client change)
- [x] 4.1 `npm run build` then `curl -X POST http://localhost:8000/api/restart`. → verify: `/api/health` mode unchanged; pair visible at top of sidebar list; chip gone.
