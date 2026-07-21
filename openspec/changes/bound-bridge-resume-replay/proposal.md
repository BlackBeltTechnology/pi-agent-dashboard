# Bound Bridge Resume Replay

## Why

Resuming a long chat in the dashboard hangs and often never renders, while forking the same session opens fast. Live evidence from the running server confirms the mechanism:

- **Back-pressure frame drops**: `server.log` shows `236` drop lines, `total dropped=2097`, seq climbing to `143132` for one session, `bufferedAmount` exceeding the `4 MB` `MAX_WS_BUFFER` in `browser-gateway.ts`. When the buffer overflows, `sendTo`/`fanout` silently `return`/`continue` — transcript frames vanish mid-stream, so the client transcript never completes and the loading ceiling (`HYDRATE_CEILING_MS = 90s`) lapses → "stuck".
- **Slow hydration**: `[hydration] slow load: 5539ms` for a `10.4 MB` file; real session files reach `107 MB` / `92 MB`.
- **Unbounded bridge replay**: on resume (`pi --session <file>`), the bridge's `replaySessionEntries()` (`session-sync.ts:111`) loops over the FULL branch and calls `connection.send()` per entry with no batching, no yielding, no bounding. Every entry then fans out to the subscribed browser as a live broadcast, overflowing the WS buffer.
- **Same-id wipe cascade**: resume reuses the sessionId; `event-wiring.ts` `canSkipWipe` fails on pi's entry-count drift, so the server `deleteEventsForSession` + `broadcastSessionStateReset` then re-inserts the whole replayed stream.

Fork escapes all three: it mints a NEW sessionId (no wipe cascade, browser not mid-subscribe), and fork-from-message writes a PRUNED branch file so pi hydrates far less.

The active `tail-first-session-loading` change bounded the server→browser subscribe path but **explicitly deferred** this exact gap (its `design.md`: *"Bridge→server transfer (`replaySessionEntries` full resend on reconnect) is explicitly out of scope"*). This change closes that gap.

## What Changes

- **Bound the bridge→server replay.** `replaySessionEntries()` no longer ships the entire branch in one synchronous burst. It sends a bounded tail window of recent entries (reusing the eventCount the bridge already computes) and yields between batches, mirroring the server's tail-first model. Older history is served on demand via the existing `load_older` path, not eagerly re-forwarded.
- **Do not re-fan-out replayed history as live frames.** Replayed entries during a resume/reattach are routed into the event store without triggering per-frame browser broadcasts that overflow the WS buffer; the subscribing browser receives the bounded tail via the normal subscribe/`event_replay` window, which is already back-pressure-aware and batched.
- **Make the same-id resume wipe resilient.** `canSkipWipe` tolerates pi's setup-entry count drift (model_change / thinking_level_change auto-appends) so a genuine resume reuses the already-loaded store instead of wiping and refilling when the underlying transcript is unchanged.
- **Surface a diagnostic when frames are dropped.** A dropped-frame count crossing a threshold for a session emits a structured signal the client can use to trigger a bounded re-subscribe instead of sitting on a silently-truncated transcript.

## Capabilities

### Modified Capabilities
- `on-demand-session-replay`: bridge resume/reattach replay is bounded to a tail window + lazy `load_older`, not a full-branch resend.
- `incremental-event-sync`: replayed historical entries on a same-id resume are not re-broadcast as live `event` frames that overflow the WS buffer.
- `session-identity`: same-id resume wipe/skip decision tolerates pi setup-entry count drift so unchanged transcripts skip the wipe-and-refill cascade.

## Impact

- **Bridge**: `packages/extension/src/session-sync.ts` (`replaySessionEntries` bounding + yielding), `packages/extension/src/bridge.ts` (replay invocation site).
- **Server**: `packages/server/src/event-wiring.ts` (`canSkipWipe` drift tolerance; route replayed entries without live re-fanout), `packages/server/src/browser-gateway.ts` (dropped-frame threshold signal), `packages/server/src/memory-event-store.ts` (insert path for bounded replay).
- **Protocol**: `packages/shared/src/protocol.ts` / `browser-protocol.ts` — optional replay-window metadata on bridge replay + a dropped-frame notice message (if a client-driven re-subscribe is adopted).
- **Client**: `packages/client/src/App.tsx` (optional: react to dropped-frame notice with a bounded re-subscribe; no eager full replay).
- **Risk**: reducer ordering invariants (message pairing, tool start/end) must hold across a bounded bridge replay exactly as they do for the server tail window — the client refold-from-full-buffer rule from `tail-first-session-loading` is the reference. Reconnect (transient WS drop) and true resume must both stay correct; `eventCount`-based skip must not drop genuinely new entries.

## Discipline Skills

- `performance-optimization`: measure resume time-to-first-render and dropped-frame count on a >90 MB session before/after; confirm zero back-pressure drops post-change.
- `systematic-debugging`: the failure is intermittent and size-dependent — reproduce with a large fixture session and assert on the `droppedFramesTotal` counter, not wall-clock feel.
- `doubt-driven-review`: the `canSkipWipe` drift tolerance changes a shipped correctness invariant (resume must never show a stale/short transcript) — stress-test before it stands.
