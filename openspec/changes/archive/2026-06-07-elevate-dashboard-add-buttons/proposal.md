## Why

Dashboard-scope "add" gestures are scattered and hard to find. Pinning a new top-level folder lives in a 10px `📌 Folder` text chip wedged between two search inputs and the `Hidden` toggle in the sidebar header. Creating a workspace lives in a separate dashed `+ New workspace…` button buried mid-list. Adding a folder to a workspace lives in a tiny `mdiPin` icon in the workspace header. All three are afterthoughts next to the bold, full-width, color-coded `+ New Session` / `+ New Worktree` line buttons that per-folder spawn actions get. These dashboard- and workspace-level "add" gestures deserve the same elevated treatment.

## What Changes

- Add elevated full-width stacked line buttons for dashboard-scope add actions, rendered as the **first item** in the scrollable sidebar list (above workspace tiers), mirroring per-folder `FolderSpawnButtons.tsx` styling:
  - `📁 + Add Folder` (yellow) — opens the existing pin-folder dialog (`onOpenPinDialog`).
  - `▦ + New Workspace` (neutral) — opens the new-workspace flow (`setNewWsOpen`), gated on `onCreateWorkspace` as today.
- **Remove** the `📌 Folder` chip from the sidebar header filter bar. Filter bar keeps both search inputs + the `Hidden` toggle (leaner).
- **Remove** the mid-list dashed `+ New workspace…` `<li>`; its action relocates into the new stacked pair.
- **Remove** the cramped `mdiPin` "Add folder to workspace" icon button from `WorkspaceHeader.tsx`; replace it with the same full-width yellow `+ Add Folder` line button rendered at the bottom of each expanded workspace body (reuses `onAddFolderViaPicker(ws.id)`).
- Label is **Add Folder** (not "Pin Folder"); underlying actions unchanged (dashboard button pins a top-level folder; workspace button adds a folder to that workspace).

No server, protocol, or persistence changes — existing handlers (`onOpenPinDialog`, `onCreateWorkspace`/`setNewWsOpen`, `onAddFolderViaPicker`) are reused verbatim.

## Capabilities

### New Capabilities
- `dashboard-add-buttons`: elevated full-width `+ Add Folder` / `+ New Workspace` line buttons. Dashboard-scope pair rendered as first item in the sidebar scroll list (reuses pin-dialog + create-workspace handlers); a workspace-scope `+ Add Folder` line button rendered at the bottom of each expanded workspace body (reuses the add-folder-to-workspace picker).

### Modified Capabilities
- `sidebar-header`: row 2 filter bar loses the `Pin+` (folder) button; only search inputs + `Hidden`/`Active only` toggles remain. Control-count invariant updated.

## Impact

- `packages/client/src/components/SessionList.tsx` — remove `📌 Folder` chip (filter bar) and mid-list `+ New workspace…` `<li>`; render new pair as first list item; render workspace-scope `+ Add Folder` at bottom of each expanded workspace body.
- `packages/client/src/components/WorkspaceHeader.tsx` — remove `mdiPin` add-folder icon button + its `onAddFolderViaPicker` prop usage in the header (prop still threaded to the new body button via SessionList).
- New component `packages/client/src/components/DashboardSpawnButtons.tsx` (sibling of `FolderSpawnButtons.tsx`), reused in Add-Folder-only mode for the workspace body.
- Tests referencing `data-testid="pin-dir-dialog-btn"`, `data-testid="new-workspace-btn"`, and `data-testid="workspace-add-folder-<id>"` need updated selectors/placement.
- No changes to `src/server/`, `src/shared/`, or any WebSocket message.
