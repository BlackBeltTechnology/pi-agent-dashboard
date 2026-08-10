# DOX — packages/client/src/lib/openspec

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `openspec-board-order.ts` | Pure per-change ordering helpers. `defaultChangeSort` orders in-progress → others → complete, then name. → see `openspec-board-order.ts.AGENTS.md` |
| `openspec-board-worktree.ts` | `deriveWorktreeProgress(session, changeName, mainDone, openspecMap)`. Returns null for non-worktree session. → see `openspec-board-worktree.ts.AGENTS.md` |
| `openspec-config-api.ts` | Fetch helpers for OpenSpec config + update endpoints. Adds saveOpenSpecConfig(), runOpenSpecUpdate(), fetchUpdateStatus() + OpenSpecUpdateStatus types. See change: add-openspec-profile-settings. |
| `openspec-group-palette.ts` | Curated color palette constant + resolver for OpenSpec group swatches. See change: add-openspec-change-grouping. |
| `openspec-groups-api.ts` | Fetch helpers for `/api/openspec/groups` CRUD + assignment endpoints. → see `openspec-groups-api.ts.AGENTS.md` |
| `openspec-tasks-api.ts` | Pure fetch wrappers for `/api/openspec/tasks` endpoints. Exports `OpenSpecTask`, `TasksPayload`,… → see `openspec-tasks-api.ts.AGENTS.md` |
