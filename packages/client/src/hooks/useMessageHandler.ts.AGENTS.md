# useMessageHandler.ts — index

New `case "view_messages_update"`: replaces `viewMessagesMap.get(sessionId)` with `msg.viewMessages.slice()`. → see `useMessageHandler.ts.AGENTS.md` `history_backfill_result` branch set (fix-history-backfill-holey-store D4/D6): `msg.error` FIRST (refusals carry `remainingGapCount: 0` and must never be misread as exhaustion), then the `!gap.dividerPlaced` no-op; events splice BEFORE the exhaustion breaks (the final response delivers its last ≤N events together with `remainingGapCount === 0`); `exhausted = msg.remainingGapCount === 0` ONLY — an empty slice with a positive count (fully-superseded compaction, sparse hole) is a CONTINUED walk, never a dead end. Exhaustion: head-free → `atFloor` floor terminus; two-sided holey → dedicated `twoSidedTerminus` flag (not-retained, never removed); two-sided contiguous → divider spliced out. `unservable` is RETIRED — no success path sets it. A response whose divider was never placed (`!gap.dividerPlaced`) is skipped entirely, so a no-op splice cannot advance the bookkeeping and desync gap state from `messages[]`. `createHistoryGapState` carries the announced `windowShape` through. See change: add-tail-only-replay-window (D5, D6). See change: fix-history-backfill-holey-store (D4, D6).

Both reset arms (`event_replay` full-sweep + `session_state_reset`) carry unanswered interactive requests AND their `ui-<requestId>` rows via module-level `withCarriedInteractiveRequests(rebuilt, prev)` over `carryInteractiveRequests` — merged AFTER the replay fold, rows at the tail. See change: fix-pending-prompt-lost-on-replay (D8).

`case "collapsed_folders_updated"` sets `collapsedFolders` from `msg.collapsedFolders` (full snapshot, replace not merge), beside `pinned_dirs_updated`/`workspaces_updated`. See change: persist-folder-collapse-server-side.

`case "card_sections_updated"` → optional `setCardSections?.(msg.cardSections)` (replace, not merge). See change: configurable-session-card-sections.

Optional deps `markHistoryLoadFailed`, `clearHistoryLoadFailed`. `markHistoryLoadFailed` = `onTimeout` of the single `loadingHistory` re-arm (never the `replayInFlight` one); `dataUnavailable` captures `wasLoading` (timer present) BEFORE the clears, then marks failed. Non-empty / terminal `event_replay` clears failed. See change: show-session-history-load-state.

`case "notify"` passes `msg.ts` to `addNotify`. `history_backfill_result` splice wraps the spliced list in `reseatTimedNotifies` so a backfilled row older than a ts-placed notify ends above it (D5). See change: collapse-and-order-notify-rows.

See change: add-browser-editor-pane-tab — `editor_tab_open` → `editor-tab-open` DOM event; `prompt_request` copies `metadata.plugin` into interactive request `params._pluginMeta`.

`session_added` correlation honors `PendingSpawnEntry.focus === false`: Tier 1 skips `navigate`; Tiers 2/2.5 collect `kind:spawn` entries matching on `pathKey(entry.cwd)` (never `placeholderCwd`), withhold `navigate` only when ≥1 match and all no-focus (mixed → focus). Tier 2 consumes a match only when a no-focus entry is involved (default Tier 2 unchanged). Reconciled/hidden branches untouched. See change: openspec-board-spawn-no-focus.

See change: add-pending-question-stack — `case "questions_update"` → `setQuestions(msg.questions)` (`lib/questions/question-store.ts`): full replacement, never merge.

`case "archive_session_error"` → `showToast(msg.error, "error")`; no state change. `session_archived` from a fileless eviction carries the unchanged folder count and is handled by the existing delete-card path. See change: fix-orphaned-ended-session-archive.
