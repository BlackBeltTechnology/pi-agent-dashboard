# file-watch-manager.ts — index

Narrow open-files watch. `setWatched(ws,sessionId,cwd,relPaths,onChange)` reconciles per (ws,session,path); `clearConnection(ws)` on disconnect, no fd leak. See change: split-editor-workspace. Re-attaches the watcher synchronously on `rename` (regular files only), retries 100/300/600/1000 ms for delete+re-create, instance-checked error/close, timers cancelled on teardown; `pendingTimerCount()`; `deps.watchFn` seam. See change: gate-changed-on-disk-by-content.
