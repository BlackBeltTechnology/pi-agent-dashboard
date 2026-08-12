# DOX — packages/server/src/session

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `active-sessions-in-cwd.ts` | `isPathInside` now RE-EXPORTED from `@pi-dashboard-shared/path-containment.js` (see change: scope-openspec-auto-attach-to-session-cwd); pure helpers `isPathInside(parent, child)`, `activeSessionsUnder(path, sessions)` (excludes `status ===… → see `active-sessions-in-cwd.ts.AGENTS.md` |
| `derive-ended-at.ts` | Evidence rule for an UNWITNESSED session ending. Exports `readJsonlMtime(sessionFile)` (the single transcript-stat path, also used by `session-scanner`), `EndedAtEvidence`, `EndedAtDeriver`, `deriveEndedAt(evidence)` — precedence `lastActivityAt` → transcript mtime → `startedAt`, never `Date.now()`. Witnessed endings (explicit signal, user shutdown) keep `Date.now()` and do NOT come through here. See change: fix-ended-session-missing-endedat. |
| `event-status-extraction.ts` | Extract session status/tool/model stats from forwarded events. → see `event-status-extraction.ts.AGENTS.md` |
| `memory-session-manager.ts` | Pure in-memory session registry; replaces SQLite-backed session-manager. → see `memory-session-manager.ts.AGENTS.md` `register()` carry-over also preserves `notifyLog` across a bridge reattach (the reattach onChange save is a full `.meta.json` overwrite). See change: split-notify-from-prompt-request. |
| `openspec-locality.ts` | Tri-state (`present`/`absent`/`unknown`) OpenSpec change locality over the poll cache: `candidateRoots` (cwd + worktree `mainPath`, + unknown root while unresolved), `localityGateAllows`, `attachedStillExistsInCandidateRoots`. Cache reads only. See change: scope-openspec-auto-attach-to-session-cwd. |
| `reattach-placement.ts` | Reattach placement policy: decides how a re-registered session id (`registerReason: "reattach"`, dashboard… → see `reattach-placement.ts.AGENTS.md` |
| `reconcile-session-order.ts` | Pure startup reconciliation of persisted `sessionOrder` map under all-status model. → see `reconcile-session-order.ts.AGENTS.md` |
| `replay-compaction.ts` | `compactEventsForReplay(stored)` — pure REPLAY-ONLY drop of `message_update` snapshots superseded by a later… → see `replay-compaction.ts.AGENTS.md` |
| `replay-truncate.ts` | truncateToolResultForReplay(event). Strategy B reconciled onto adopt-pi-071-072-073-features. → see `replay-truncate.ts.AGENTS.md` |
| `resolve-order-key.ts` | Resolves `sessionOrder` map key for a session server-side. → see `resolve-order-key.ts.AGENTS.md` |
| `session-api.ts` | REST wrappers for session control. Exports `registerSessionApi(fastify, deps)`. → see `session-api.ts.AGENTS.md` |
| `session-bootstrap.ts` | Exports `discoverAndBroadcastSessions(deps)` — async startup discovery from known directories, restores… → see `session-bootstrap.ts.AGENTS.md` |
| `session-diff.ts` | `extractFileChanges(events, cwd)` scans `tool_execution_start` write/edit events, groups by path, attaches… Async + event-loop-safe: `enrichWithGitDiff`/`buildSessionDiff` async, ONE batched `git diff --relative HEAD` split per file (`splitBatchedDiff`), `TRACKED_DIFF_MAX_BYTES` (5 MB) cap, no `spawnSync` git on the path; `buildSessionDiffCached(sessionId, events, cwd, cache)` wraps with TTL+single-flight. See change: fix-session-diff-eventloop-block. → see `session-diff.ts.AGENTS.md` |
| `session-diff-cache.ts` | `SessionDiffCache<T>` (per-session TTL result cache + single-flight coalesce; TTL 0 disables; bounded eviction) + `djb2` key hash. Backs `/api/session-diff` poll coalescing. See change: fix-session-diff-eventloop-block. |
| `session-discovery.ts` | Standalone per-cwd session discovery from `~/.pi/agent/sessions/<encoded-cwd>/`. → see `session-discovery.ts.AGENTS.md` |
| `session-file-reader.ts` | Standalone JSONL session reader. Exports `SessionEntry`, `loadSessionEntries(filePath)` (leaf→root branch… → see `session-file-reader.ts.AGENTS.md` |
| `session-load-worker-pool.ts` | Session-load worker pool. Fixed slots = `max(1, min(maxConcurrentSpawns, os.cpus().length))`; FIFO queue when… → see `session-load-worker-pool.ts.AGENTS.md` |
| `session-load-worker.ts` | Pure `loadAndReplay(req): {jobId, success, events, error, entryCount?}` + `parentPort` bootstrap. → see `session-load-worker.ts.AGENTS.md` |
| `session-order-manager.ts` | Per-cwd session ordering persisted via `PreferencesStore`. → see `session-order-manager.ts.AGENTS.md` |
| `session-scanner.ts` | Cold-start session scanner. Exports `ScanResult`, `scanAllSessions(sessionsDir)` — scans… → see `session-scanner.ts.AGENTS.md` `sessionFromMeta` restores `notifyLog`. See change: split-notify-from-prompt-request. |
| `session-stats-reader.ts` | Exports `SessionStats`, `extractSessionStats(filePath)` — reads session JSONL once, accumulates tokensIn/Out,… → see `session-stats-reader.ts.AGENTS.md` |
| `session-to-meta.ts` | Exports `sessionToMeta(session)` — the EXPLICIT `.meta.json` field enumeration extracted from `server.ts`… → see `session-to-meta.ts.AGENTS.md` Enumerates `notifyLog` so retained notifications survive a restart. See change: split-notify-from-prompt-request. |
| `viewed-session-tracker.ts` | Exports `ViewedSessionTracker` interface, `createViewedSessionTracker()` — per-session set of viewing… → see `viewed-session-tracker.ts.AGENTS.md` |
