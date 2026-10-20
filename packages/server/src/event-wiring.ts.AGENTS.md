

`commands_list` also calls `directoryService.notifyPiResourcesInvalidated?.(sessionCwd)`; unknown session emits nothing. See change: add-skill-atlas-screen.

Register `sessionFile` dedup: an ENDED holder of the claimed file is evicted via `sessionArchive.evictSuperseded(other.id, sessionId)` (no intermediate clear/`session_updated`); non-ended holder or missing archive service keeps clear + `broadcastSessionUpdated({sessionFile:null})`, with log `[archive] supersede skipped: archive unavailable` when the service is absent. See change: fix-orphaned-ended-session-archive.

`wireEvents` dep `dispatchSessionRegisteredCwd?(cwd)` fires from `piGateway.onSessionRegistered` (drives local-scope plugin detection for a new cwd). See change: decouple-plugins-from-core (5.9).
