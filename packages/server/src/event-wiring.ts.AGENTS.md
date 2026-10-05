

## electron-runtime-overlay-updates

Adds a `session_heartbeat` branch: when the beat carries `agentRunning` and the session is not replaying, `reconcileAgentLiveness(session.status, msg.agentRunning)` is applied via `sessionManager.update` + `broadcastSessionUpdated`, and logs `[reconcile] session <id>: <prev> -> <next>` on a correcting one (a heal is evidence a run-boundary event was lost). Deliberately does NOT call `stampUnreadIfTriggered` — the unread exemption is by CALL PATH, not by a flag. Honours the replay window (accumulated replay state is better truth than one beat) and the pending-prompt gate (a live `ask_user` keeps `currentTool`). See change: fix-stuck-streaming-status-latch (D3/D10). Every terminal `session_updated` broadcast carries `closedReason`, so a card watched live learns WHY it ended instead of only on the next full snapshot. `sessionManager.onEnded` writes liveness + `closedReason` eagerly on the exact terminal transition from BOTH seams (it replaced the unregister-only write, which missed `update()`-based endings — reload-spawn failure, zombie normalization, move). See change: stop-discarding-known-session-state.

`sessionManager.onEnded` also HEALS orphaned work: derives `findOpenToolCalls`/`findOpenSubagents` over `eventStore.getEvents(sessionId, 1)` (`session/open-tool-calls.ts`), inserts + broadcasts one `tool_execution_end{isError:true, result:"parent session ended", healedBy:"session_ended"}` per open call and one `subagent_failed` per non-terminal subagent, BEFORE the `session_updated{ended}` broadcast. Skips a session with `session.movedTo` set (relocation is not a death). Broadcast suppressed while `replayingSessions.has(sessionId)`; insert is not. Idempotent via the store — a second `onEnded` finds nothing open. See change: heal-orphaned-tool-cards-on-session-end.

Wires `piGateway.onDisconnect` -> invalidate the provider catalogue once no bridge session remains. See change: redesign-providers-settings-page (D5).

Carries the one-release `dispatch_extension_command` TOMBSTONE: on receipt it `console.warn`s once and persists + broadcasts `command_feedback {command, status:"error", message:"bridge outdated — reload the session"}` (persist FIRST — a broadcast-only terminal re-creates the stuck "in progress" pill on browser reattach). No keeper socket is written; a throwing `eventStore.insertEvent` is caught and logged so the WS handler never rejects. See change: retire-slash-dispatch-via-expand-prompt-templates (D4).

`event_forward` calls `routeReloadFeedback` BEFORE the replay-skip early return: terminal `/reload` `command_feedback` settles the forwarded-reload watch; late feedback after deadline dropped; inside replay-skip window persisted + broadcast here. See change: fix-terminal-session-dashboard-reload.

`plugin_request` → `dispatchPluginRequest(sessionId,msg)` (new optional dep). See change: expose-plugin-credential-and-oauth-seams.

`git_info_update`: `gitPrState|Draft|Checks|CheckedAt` guarded (`!== undefined`); cleared to `null` when `gitPrNumber == null` (tuple atomic with number). See change: redesign-composer-session-strip.

`onBridgeRegister?(sid, extensionIdentity)` dep, called on non-provisional `session_register` (D8). See change: electron-runtime-overlay-updates.

`EventWiringDeps.pushDispatcher?`. `stampUnreadIfTriggered` computes `unreadEdge = !!session && !session.unread`, stamps unread on the edge, then `if (session) pushDispatcher?.fanout(sessionId, {eventType, after, payload, unreadEdge})` — fire-and-forget, never awaited (AST lint in push-dispatcher.test.ts). One ask_user edge reaches fanout once (second caller sees currentTool already ask_user). See change: add-server-push-notifications.

`handleNotify(sessionId, incoming)` validates `incoming.ts` via module-level `isValidNotifyTs` (finite number > 0) else stamps `Date.now()`; every logged entry + browser `notify` carries `ts` (live, legacy `fromLegacyPromptRequest`, server-created locality notice). Live `notify` branch forwards raw `msg.ts`. See change: collapse-and-order-notify-rows.

`pi_version_update` arm stamps + broadcasts `piBelowFloor = computePiBelowFloor(version, serverPiMinimum())` (`null` clears). See change: update-pi-core-1-0-adopt-apis.

`accumulateUsage(sessionId, stats, usageKind?)` — one accumulator for `turn_end`, tool-result `message_end` (read from in-flight event; assistant `message_end` never counted) and `usage_recorded`; adds all five totals, stores + broadcasts `stats_update` (non-turn: `usageKind`, no `contextUsage`). See change: count-non-message-usage.

- Plugin `lifecycle.hidden === true` (fresh resolution only) → `sessionManager.update(sessionId, { hidden: true })` + `browserGateway.broadcastSessionUpdated(sessionId, { hidden: true })`; pinned by `__tests__/plugin-lifecycle-hidden.test.ts`. See change: hide-chat-gateway-sessions.
- `lifecycle.hidden` apply now writes `{ hidden: true, pluginHidden: true }` (intent survives restart respawn). See change: fix-plugin-hidden-across-restart.
