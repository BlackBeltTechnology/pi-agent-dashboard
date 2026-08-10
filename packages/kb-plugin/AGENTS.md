# DOX — packages/kb-plugin

Files in this directory. One row per source file. See change: add-kb-folder-slot.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Dashboard plugin (Layer 3) surfaces per-folder markdown KB. Sidebar KB row (`sidebar-folder-section`): chunk count + reindex, states `populated`/`not-indexed`/`indexing`/`stale`/`error`. Per-folder KB settings page (`shell-overlay-route` `/folder/:encodedCwd/kb`). Server routes `src/server/kb-routes.ts`: `GET /api/kb/stats`, `POST /api/kb/reindex`, `GET`+`PUT /api/kb/config`. |
| `package.json` | pi-dashboard-plugin manifest. id `kb`, priority 100. Claims `sidebar-folder-section`→`FolderKbSection`, `worktree-card-section`→`FolderKbSection` (KB row on worktree session cards, scoped to worktree cwd; see change: kb-row-on-worktree-session-card), `shell-overlay-route` `/folder/:encodedCwd/kb`→`KbSettingsClaim`. server `./src/server/index.ts`. Layer-3 dashboard plugin. Imports Layer-1 `@blackbelt-technology/pi-dashboard-kb`. Independent of Layer-2 kb-extension. See change: add-kb-folder-slot. |
