

`commands_list` also calls `directoryService.notifyPiResourcesInvalidated?.(sessionCwd)`; unknown session emits nothing. See change: add-skill-atlas-screen.

Register `sessionFile` dedup: an ENDED holder of the claimed file is evicted via `sessionArchive.evictSuperseded(other.id, sessionId)` (no intermediate clear/`session_updated`); non-ended holder or missing archive service keeps clear + `broadcastSessionUpdated({sessionFile:null})`, with log `[archive] supersede skipped: archive unavailable` when the service is absent. See change: fix-orphaned-ended-session-archive.

`session_register` carries a supervised-mode arm (`applyBridgeSupervised`, `alwaysSend`): reconcile bridge `{on,rev}` with stored, persist, broadcast, send `set_supervised`. Bridge `supervised_state` handled before the register block (valid report → reconcile, mismatch-only reply; malformed ignored). Derives `awaitingToolApproval` (`syncAwaitingToolApproval`, via `syncOperatorAttention` beside `awaitingFileAccess`; disconnect resets it) from pending `kind:"supervised-tool-approval"` prompts. `TOOL_ATTACHED_PROMPT_KINDS` = file-access + supervised kinds: excluded from the `currentTool:"ask_user"` fold. See change: add-supervised-tool-approval (D4, D16).
