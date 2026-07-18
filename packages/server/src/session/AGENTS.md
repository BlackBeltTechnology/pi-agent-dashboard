# DOX — packages/server/src/session

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `active-sessions-in-cwd.ts` | Pure helpers `isPathInside(parent, child)`, `activeSessionsUnder(path, sessions)` (excludes `status ===… → see `active-sessions-in-cwd.ts.AGENTS.md` |
| `event-status-extraction.ts` | Extract session status/tool/model stats from forwarded events. → see `event-status-extraction.ts.AGENTS.md` |
| `memory-session-manager.ts` | Pure in-memory session registry; replaces SQLite-backed session-manager. → see `memory-session-manager.ts.AGENTS.md` |
| `reattach-placement.ts` | Reattach placement policy: decides how a re-registered session id (`registerReason: "reattach"`, dashboard… → see `reattach-placement.ts.AGENTS.md` |
| `reconcile-session-order.ts` | Pure startup reconciliation of persisted `sessionOrder` map under all-status model. → see `reconcile-session-order.ts.AGENTS.md` |
| `replay-truncate.ts` | truncateToolResultForReplay(event). Strategy B reconciled onto adopt-pi-071-072-073-features. → see `replay-truncate.ts.AGENTS.md` |
| `resolve-order-key.ts` | Resolves `sessionOrder` map key for a session server-side. → see `resolve-order-key.ts.AGENTS.md` |
| `session-api.ts` | REST wrappers for session control. Exports `registerSessionApi(fastify, deps)`. → see `session-api.ts.AGENTS.md` |
| `session-bootstrap.ts` | Exports `discoverAndBroadcastSessions(deps)` — async startup discovery from known directories, restores… → see `session-bootstrap.ts.AGENTS.md` |
| `session-diff.ts` | `extractFileChanges(events, cwd)` scans `tool_execution_start` write/edit events, groups by path, attaches… → see `session-diff.ts.AGENTS.md` |
| `session-discovery.ts` | Standalone per-cwd session discovery from `~/.pi/agent/sessions/<encoded-cwd>/`. → see `session-discovery.ts.AGENTS.md` |
| `session-file-reader.ts` | Standalone JSONL session reader. Exports `SessionEntry`, `loadSessionEntries(filePath)` (leaf→root branch… → see `session-file-reader.ts.AGENTS.md` |
| `session-load-worker-pool.ts` | Session-load worker pool. Fixed slots = `max(1, min(maxConcurrentSpawns, os.cpus().length))`; FIFO queue when… → see `session-load-worker-pool.ts.AGENTS.md` |
| `session-load-worker.ts` | Pure `loadAndReplay(req): {jobId, success, events, error, entryCount?}` + `parentPort` bootstrap. → see `session-load-worker.ts.AGENTS.md` |
| `session-order-manager.ts` | Per-cwd session ordering persisted via `PreferencesStore`. → see `session-order-manager.ts.AGENTS.md` |
| `session-scanner.ts` | Cold-start session scanner. Exports `ScanResult`, `scanAllSessions(sessionsDir)` — scans… → see `session-scanner.ts.AGENTS.md` |
| `session-stats-reader.ts` | Exports `SessionStats`, `extractSessionStats(filePath)` — reads session JSONL once, accumulates tokensIn/Out,… → see `session-stats-reader.ts.AGENTS.md` |
| `session-to-meta.ts` | Exports `sessionToMeta(session)` — the EXPLICIT `.meta.json` field enumeration extracted from `server.ts`… → see `session-to-meta.ts.AGENTS.md` |
| `viewed-session-tracker.ts` | Exports `ViewedSessionTracker` interface, `createViewedSessionTracker()` — per-session set of viewing… → see `viewed-session-tracker.ts.AGENTS.md` |
