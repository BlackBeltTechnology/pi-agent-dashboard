# session-sync.ts — index

Session register/replay/switch lifecycle. Exports `sendStateSync`, `replaySessionEntries`, `handleSessionChange`, `consumeSpawnToken` (read+scrub `PI_DASHBOARD_SPAWN_TOKEN`, single-use; shared with `bridge.ts`'s `session_start` register, which used to omit both the token and `pid` — see change: fix-tmux-session-shutdown-leak). First register tagged `registerReason:"spawn"` (scrubs single-use `PI_DASHBOARD_SPAWN_TOKEN`); reconnects tagged `"reattach"`. Sends commands_list, flows_list, models_list, providers_list, git_info_update. Delegates to `detectSessionSource`, `gatherGitInfo`, `buildProviderCatalogue`.

`handleSessionChange` observes the new PR generation and sends the cached tuple on its `git_info_update`; resets `lastGitPrJson`. See change: redesign-composer-session-strip.

Re-mint comment updated: the `mcp_token_minted` reply now re-registers `pi-dashboard` with pi's built-in MCP (not `process.env`). See change: migrate-mcp-to-pi-builtin.

`handleSessionChange(bc, ctx, getFlowsList, usageSeed?)` sends `usageSeed` on the new session's register; `sendStateSync` (reconnect) never does. See change: count-non-message-usage.

`handleSessionChange` git info now goes through `bc.gitTracker.evaluateFirst(bc, cwd)` (cached facts + HEAD branch, status omitted, fast-lane probe queued) and resets `lastGitStatusJson` too. See change: optimize-polling-hot-paths.

See change: fix-replay-fabricates-orphan-end-for-live-calls — exports `isLive(ctx, isAgentStreaming)` = `isAgentStreaming===true || ctx.isIdle()===false` (missing/throwing `isIdle` → idle; never throws). `replaySessionEntries(bc, opts?: {liveTailOpen?})` forwards opts to `replayEntriesAsEvents`. `handleSessionChange` replays with tail CLOSED (bc.cachedCtx = outgoing ctx; new/fork/resume has no turn in flight).
`consumeSpawnToken` re-exported from `spawn-token.ts` (token scrubbed at activation, consumed once). See change: mirror-dashboard-trust-to-pi.

`replaySessionEntries` marks every replayed `event_forward` `replay: true`. `branchFingerprint(sessionManager)` → `{eventCount,leafEntryId}` (last branch entry id). `sendStateSync(bc,getFlowsList,{liveTailOpen})` sends `leafEntryId` + `liveTailOpen`; `handleSessionChange` sends `liveTailOpen:false` and keeps its closed-tail replay. See change: fix-large-session-resume-replay.

Declares `certValidation: "enforced"` on `session_register` when the TLS checks applied. See change: prove-vault-bridge-tls.
