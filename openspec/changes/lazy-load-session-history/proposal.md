## Why

Reopening a long-lived session replays its ENTIRE event history to the browser before the chat is usable. Users running long sessions (issue #521, `billion-context-pi`) wait through a full-transcript replay they did not ask for — they read the recent tail and only occasionally scroll back.

The server already has the seam for this and it is dead code: `MAX_REPLAY_EVENTS` in `packages/server/src/browser-handlers/subscription-handler.ts:27` is hard-coded to `0`, duplicated across three call sites, and applied BEFORE `compactEventsForReplay`. It is pinned at `0` for good reasons — it truncates one-way with no path back to older events, and it drops the chat head — so it can never be enabled as written.

## What Changes

- **Window the replay instead of truncating it.** Move the slice into `sendEventBatches`, AFTER `compactEventsForReplay`, so the event budget buys real conversation instead of superseded `message_update` snapshots (compaction is roughly a 20:1 reducer per `compact-warm-replay-stream`).
- **Head + tail retention.** The window keeps the first N and last M events with an elided middle, mirroring `head-tail-truncate-subagent-event-timeline`, so the opening user message and session intent survive. Tail-only truncation is rejected.
- **Boundary snapping.** The cut snaps backwards to the nearest `message_start` / `turn_start` so replay never opens on an orphan `message_end` or an unpaired `tool_execution_end`.
- **New backfill protocol.** A browser→server request for an explicit seq RANGE inside the elided middle, so the client can fill the gap on demand. This is what makes windowing non-destructive. Every request gets exactly one response, including refusals, so a dropped request never strands the client.
- **New store API.** `EventStore.getEventsRange(sessionId, minSeq, maxSeq)` — the store is forward-only today (`getEvents(sessionId, minSeq)`), so serving a bounded gap slice would otherwise materialize the whole stream and discard the tail.
- **Windowed replays are not written to the client replay cache.** Otherwise a sparse head+tail payload under the cache's 5 MB cap would persist as if contiguous, and the next reload (cache hit → delta subscribe) would render head and tail silently adjacent with the gap permanently unrecoverable. Skipping the write makes the next reload a cache miss, which re-windows and re-arms the affordance.
- **Client gap affordance.** The transcript requests a range when the user scrolls toward the gap, using its OWN pending state — deliberately NOT the `chat-history-loading-indicator` flag, which is scoped to the initial replay and must not reappear mid-session.
- **User-configurable, not a constant.** `MAX_REPLAY_EVENTS` becomes `memoryLimits.maxReplayEvents`, editable in Settings → Memory Limits alongside the existing `maxEventsPerSession` / `maxStringFieldSize` / `maxWsBufferBytes` fields.
- **Default `0` (unlimited).** Opt-in. No behavior change for any existing user on upgrade. NOT a breaking change.
- **Windowing is keyed on stream content, not call site.** `subscription-handler.ts:260` is dual-purpose: `lastSeq = msg.lastSeq ?? 0`, so a warm reload with no cached seq takes that branch with `getEvents(sessionId, 1)` — the FULL stream, and the dominant path for issue #521. Windowing applies whenever the delivered array is a full stream (`lastSeq === 0`, or the stale-`lastSeq` case); a genuine delta (`lastSeq > 0`) is never windowed, because slicing a delta punches a seq gap between what the client holds and what it receives.

## Capabilities

### New Capabilities
- `session-history-backfill`: browser→server seq-range request for older events, its response framing, and the client scroll-up trigger that drives it. Covers range validation, out-of-range handling, and interaction with an in-flight replay.

### Modified Capabilities
- `on-demand-session-replay`: subscribe-time replay becomes a bounded WINDOW (head + tail) rather than the full stored stream; cold hydration and stale-`lastSeq` full replays respect `maxReplayEvents`; the warm delta path does not.
- `replay-stream-compaction`: the window is applied after compaction, not before. The `preCompactionMaxSeq` high-water-mark contract (D4) is preserved — a head+tail window retains the highest seq, so `clearReplaying`'s catch-up query stays correct.
- `shared-config`: `MemoryLimitsConfig` gains `maxReplayEvents` (default `0`), parsed by `parseMemoryLimits` and threaded through `cli.ts` → `server.ts`.
- `settings-panel`: Memory Limits section gains the `maxReplayEvents` control, with i18n keys for en/hu/zh.

## Impact

**Server**
- `packages/server/src/browser-handlers/subscription-handler.ts` — remove 3 duplicated slices, add windowing inside `sendEventBatches`, emit `history_window`, add the range-request handler
- `packages/server/src/persistence/memory-event-store.ts` — new `getEventsRange` on the `EventStore` interface and its implementation
- `packages/server/src/pairing/browser-gateway.ts` — route the new message types; `clearReplaying` catch-up unchanged
- `packages/shared/src/browser-protocol.ts` — three new message types (`history_window`, `history_backfill`, `history_backfill_result`)
- `packages/shared/src/config.ts` — `MemoryLimitsConfig.maxReplayEvents`, `DEFAULT_MEMORY_LIMITS`, `parseMemoryLimits`
- `packages/server/src/cli.ts`, `packages/server/src/server.ts` — thread the new limit

**Client**
- `packages/client/src/components/settings/SettingsPanel.tsx` — new Memory Limits field
- `packages/client/src/lib/i18n/*` — `settings.hint.maxReplayEvents`, `session.maxReplayEvents`
- `packages/client/src/lib/chat/event-reducer.ts` — MUST tolerate orphans at BOTH window edges; this repo already has a `fix-reducer-crash-undefined-toolname` regression on record
- `packages/client/src/hooks/useMessageHandler.ts` / `useSessionState.ts` — route the new messages; splice must not move `maxSeqMapRef`, must not fan out to `publishSessionEvents`, must not re-seed `replayPersister`
- `packages/client/src/lib/replay/` — gap state, splice-without-scroll-jump, and suppressing the persist of a windowed replay
- transcript virtualization — scroll-anchor preservation when splicing into the gap

**Risk**
- Reducer tolerance for an orphaned window edge is the gate on shipping a non-zero default. Default `0` keeps the risk unrealized until proven.
- Splicing events must not jump the scroll position (`chat-scroll-lock`).
- Backfilled events are client-memory only; a reload re-runs the windowed replay and the fetched middle is gone. Accepted, documented as a Non-Goal in `design.md`.

## Discipline Skills

- `performance-optimization` — the whole change is a latency claim. Measure reopen-to-interactive on a large session BEFORE and after; no optimization lands unmeasured.
- `doubt-driven-review` — a new wire protocol message is effectively a public API between server and client; stress-test the range-request shape before it stands.
- `security-hardening` — the range request accepts client-supplied seq bounds; validate and clamp so a malicious or buggy client cannot request an unbounded slab.
- `observability-instrumentation` — the backfill path is a new request type; it needs enough logging to diagnose a stuck or looping backfill in the field.
- `review-code` — non-trivial multi-package change, before commit.
- `systematic-debugging` — if the reducer surfaces an orphan-head bug mid-implementation, root-cause it rather than patching symptoms.

**Subagent checkpoints:** `nodejs-expert` (new async/WS path across ≥3 server modules), `react-expert` (scroll-anchor hook + backfill state in the transcript), `Audit` (client-supplied range bounds).
