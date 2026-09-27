# DashboardSpawnButtons.tsx — index

Sidebar spawn-button stack. Exports `DashboardSpawnButtons`. Renders `+ Add Folder` (always) and `+ New Workspace` (when `onNewWorkspace` provided). Mirrors `FolderSpawnButtons` line layout. Used dashboard-scope (list head) and workspace-scope (body footer).

See change: align-ui-with-theme-tokens. Add Folder = `--tint-blue-*`; both buttons 12 px, `min-h-[44px] sm:min-h-[32px]`, `focus-ring`, `type="button"`.

See change: align-ui-with-theme-tokens. Tint/target recipe via `tint-action-*` / `tap-target` utilities (index chunk cap).
