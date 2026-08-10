# DOX — packages/server/src/openspec

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `openspec-archive.ts` | Scans `openspec/changes/archive/` for dated entries. Exports `scanOpenSpecArchive(cwd)` returning… → see `openspec-archive.ts.AGENTS.md` |
| `openspec-change-watcher.ts` | Per-cwd recursive `fs.watch` on `<cwd>/openspec/changes/`. → see `openspec-change-watcher.ts.AGENTS.md` |
| `openspec-group-store.ts` | OpenSpec group store. Persists groups + assignments + `changeOrder: Record<groupId, changeName[]>` in… → see `openspec-group-store.ts.AGENTS.md` |
| `openspec-poll-fs-helpers.ts` | Pure FS helpers extracted from `directory-service.ts` so worker imports without pulling SessionManager /… → see `openspec-poll-fs-helpers.ts.AGENTS.md` |
| `openspec-poll-worker-pool.ts` | `createOpenSpecPollWorkerPool({size?, timeoutMs=10_000, useWorker=true, workerUrlOverride?})`. → see `openspec-poll-worker-pool.ts.AGENTS.md` |
| `openspec-poll-worker.ts` | Pure `deriveAndSerialize(req): {cwd, data, serialized, stampMtimes, racyNames}` + `parentPort` bootstrap. → see `openspec-poll-worker.ts.AGENTS.md` |
| `openspec-tasks.ts` | Parser + writer for an OpenSpec change's `tasks.md`. Exports `OpenSpecTask`, `NotFoundError`,… → see `openspec-tasks.ts.AGENTS.md` |
| `proposal-attach-naming.ts` | Pure helpers for idempotent attach/detach auto-rename rule. → see `proposal-attach-naming.ts.AGENTS.md` |
