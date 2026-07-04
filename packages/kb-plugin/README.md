# @blackbelt-technology/pi-dashboard-kb-plugin

Dashboard plugin (Layer 3) that surfaces the per-folder markdown knowledge base.

- **Sidebar KB row** (`sidebar-folder-section`) — chunk count + reindex, five states: `populated` / `not-indexed` / `indexing` / `stale` / `error`.
- **Per-folder KB settings page** (`shell-overlay-route` `/folder/:encodedCwd/kb`) — manage the indexed `sources[]` / `include` / `exclude` / `dbPath`.

Server routes (`src/server/kb-routes.ts`), mounted on the shared Fastify instance:

| Route | Purpose |
|---|---|
| `GET /api/kb/stats?cwd=` | `{ files, chunks, indexed, staleCount, indexing, jobStatus, lastError? }` via `store.counts()` |
| `POST /api/kb/reindex?cwd=` | Non-blocking: registers the walk, returns `202 { status:"running", jobId }`; the row polls `/stats` for completion + `jobStatus:"error"`. See change: `fix-kb-index-feedback`. |
| `GET /api/kb/config?cwd=` | `{ config, origin, projectPath }` via `loadConfig` |
| `PUT /api/kb/config?cwd=` | validate + atomic write of the path fields; preserves other config |

Reindex + config writes run in the **dashboard-server process** — no pi session required — so a session-less worktree is both indexable and configurable. Imports the Layer-1 engine (`@blackbelt-technology/pi-dashboard-kb`); independent of the Layer-2 session extension.

`cwd` is validated against the host-provided `host.knownFolderCwds` service (session cwds ∪ pinned dirs) before any store open or disk write.

See change: `add-kb-folder-slot`.
