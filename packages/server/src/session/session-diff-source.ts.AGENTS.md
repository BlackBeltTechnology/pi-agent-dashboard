# session-diff-source.ts — index

The event SOURCE for `/api/session-diff`. The in-memory event store is a bounded ring (per-session trim, restart, LRU evict, size clamp all drop Write/Edit/Bash `tool_execution_start` events) while the on-disk transcript keeps them at full fidelity.

`projectDiffEvents(sessionId, entries, {maxStringSize})` → `{events, lastEntryTs}`. Diff-only projection of `SessionEntry[]`: assistant `message_end` (text parts only) BEFORE its tool starts (live order — `replayEntriesAsEvents` emits starts first and would mis-attribute each change to the previous message), then `tool_execution_start` per toolCall (args through the store's exported `truncateStrings` with the store's own cap → byte-identical payloads/`truncated` flags; `maxStringSize<=0` disables), then `tool_execution_end`. Open tool calls stay open (no synthetic end) so a live Bash window stays `[start, now]`. `lastEntryTs` = max ts over ALL entries (not just projected). Lives here (not `session-load-worker`) so the worker can import it without a cycle.

`resolveDiffSource(session, eventStore, {pool, maxStringSize})` → `{sourceKey, load}`. Gate `mayReadLocalSessionFile({origin: originOf(session), sessionFile})`: pass → key `t:<mtime>:<size>` (one async `fs.stat`; ANY error → `t:0:0`) and a loader that dispatches the pool in `mode:"diff-events"` (in-process `loadSessionEntries`+projection when pool absent/null) falling back to the store when the transcript yields ZERO entries; fail (remote origin, no `sessionFile`) → key `s:<count of write/edit/bash tool_execution_start in store>` and the store's events. Remote sessions NEVER stat/read `sessionFile` here. The empty-transcript fallback is decided INSIDE `load()` so the key cannot depend on it.

See change: fix-session-diff-durable-source.
