# state-replay.ts — index

Synthesizes dashboard `event_forward` messages from persisted pi session entries for post-reconnect chat rebuild. Exports `replayEntriesAsEvents(sessionId, entries, knownContextWindow?)`. Emits message_start/update/end, tool_execution_start/end, model_select, stats_update; closes orphaned tool calls; replays persisted flow-run events sorted by seq. Uses persisted `entry.id` as `entryId` — no `entry_persisted` follow-up.
