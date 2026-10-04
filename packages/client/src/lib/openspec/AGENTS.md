# DOX — packages/client/src/lib/openspec

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `OpenSpecMapContext.tsx` | `OpenSpecMapContext` + `useOpenSpecMap()`: App's `openspecMap` for attachment resolution; absent provider → empty map. See change: resolve-archived-attached-proposal. |
| `archive-cache.ts` | Shared per-cwd cache for `GET /api/openspec-archive`: in-flight dedupe, activeSig invalidation, 5 min TTL, 30 s error retry. Exports `requestArchive`, `getArchiveState`, `activeSignature`, `subscribeArchiveCache`. See change: resolve-archived-attached-proposal. |
| `openspec-board-order.ts` | Pure per-change ordering helpers. `defaultChangeSort` orders in-progress → others → complete, then name. → see `openspec-board-order.ts.AGENTS.md` |
| `openspec-board-worktree.ts` | `deriveWorktreeProgress(session, changeName, mainDone, openspecMap)`. Returns null for non-worktree session. → see `openspec-board-worktree.ts.AGENTS.md` |
| `openspec-config-api.ts` | Fetch helpers for OpenSpec config + update endpoints. Adds saveOpenSpecConfig(), runOpenSpecUpdate(), fetchUpdateStatus() + OpenSpecUpdateStatus types. See change: add-openspec-profile-settings. Adds `runOpenSpecInit` (+`OpenSpecInitError` w/ stderr), `fetchOpenSpecPollSettings`, `setOfferInitialization`, `addOpenSpecOptOut`/`removeOpenSpecOptOut` (GET→PUT read-modify-write on /api/config). See change: add-openspec-init-affordances. |
| `openspec-group-palette.ts` | Curated color palette constant + resolver for OpenSpec group swatches. See change: add-openspec-change-grouping. |
| `openspec-groups-api.ts` | Fetch helpers for `/api/openspec/groups` CRUD + assignment endpoints. → see `openspec-groups-api.ts.AGENTS.md` |
| `openspec-tasks-api.ts` | Pure fetch wrappers for `/api/openspec/tasks` endpoints. Exports `OpenSpecTask`, `TasksPayload`,… → see `openspec-tasks-api.ts.AGENTS.md` |
| `rendered-cwds.ts` | Pure `computeRenderedCwds`: cwds the OpenSpec reconcile pulls; adds attached sessions' cwd+mainPath (ended incl.) and archive-route candidates. See change: resolve-archived-attached-proposal. |
| `resolve-attachment.ts` | Pure `resolveAttachment(session, activeByCwd, getArchive)` → `active\|archived\|missing\|unresolved{loading\|disabled\|error}`; order active(cwd)→active(mainPath)→archive(cwd)→archive(mainPath); `matchArchiveEntries` exact-name escaped regex; same-name pick = newest ≥ local start day −1, else newest. See change: resolve-archived-attached-proposal. |
| `useAttachmentResolution.ts` | Hooks: `useAttachmentResolution(session, changesFallback?)`, `useResolvedAttachments(sessions, preload?)`, `useArchiveEntries(cwd, mapOverride?)`; lazy archive fetch via archive-cache. See change: resolve-archived-attached-proposal. |
