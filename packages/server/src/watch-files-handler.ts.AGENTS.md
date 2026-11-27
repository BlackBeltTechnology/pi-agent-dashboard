# watch-files-handler.ts — index

Browser-WS `watch_files` handler. `createWatchFilesHandler({routeAdmission, manager, onChange})` → `{handle(msg, ws), onDisconnect(ws)}`: admits `msg.cwd` via `admitFileCwd`; per-`(ws, sessionId)` sequence number taken before the await, result dropped when the socket closed or a newer message arrived; refusal / indeterminate = silent no-op. See change: core-file-cwd-admission.
