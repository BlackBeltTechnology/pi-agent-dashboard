## Why

A session compaction is visible while it happens and invisible afterwards.

Live path: the bridge forwards pi's `session_compact` event and the client reducer renders a `── Session compacted ──` divider (`packages/client/src/lib/chat/event-reducer.ts:2368`). Replay path: `replayEntriesAsEvents` (`packages/shared/src/state-replay.ts`) rebuilds the transcript from pi's persisted entries and has arms for `message`, `model_change`, `custom` and `custom_message` — none for `compaction`. It has TWO producers, and the divider disappears through both:

- **server cold load** — `session-load-worker.ts` → `session-file-reader.loadSessionEntries()`, when a session's events are absent from the in-memory buffer;
- **extension replay** — `session-sync.ts:199 replaySessionEntries()` over `sessionManager.getBranch()`, on `session_start`, on every WS reconnect, and on fork/resume (`bridge.ts:1450,3223`).

Both are in scope: the one arm fixes both.

Evidence (audit over the 400 most-recently-modified transcripts in `~/.pi/agent/sessions`): 141 `compaction` entries, shape `{type, id, parentId, timestamp, summary, tokensBefore, firstKeptEntryId, fromHook, details}`. A repo-wide search finds ZERO consumers of that entry type in `packages/server/src`, `packages/shared/src`, `packages/client/src` — it is the only model/session-emitted record kind with no code path anywhere. (Sibling gaps found by the same audit — `thinking_level_change` replayed only into the stats reader, `after_provider_response`/`before_provider_headers` never subscribed — are deliberately OUT of scope here.)

The user-visible consequence: after a reload the summarized turns and the turns that survived compaction sit adjacent with no boundary, so a truncated-looking history reads as data loss instead of a compaction.

## What Changes

- **`replayEntriesAsEvents` gains a `compaction` arm**: each `compaction` JSONL entry synthesizes the same `session_compact` event the bridge forwards live, positioned at the entry's own timestamp/order. No new protocol event type, no new reducer `case` — the existing live arm renders it.
- **Metadata is emitted only where the entry actually carries it.** The JSONL entry has no `reason` and no `willRetry`; those stay absent, which the reducer's existing guard already treats as "legacy event → divider, no badge". `tokensBefore` → `preCompactionTokens` is explicitly deferred (see Out of scope).
- **Cold/warm parity is asserted by test**, not assumed: a fixture with a `compaction` entry reduces to the same divider row the live `session_compact` event produces. Parity is scoped to the `session_compact` row — the live path additionally renders a raw JSON card for `session_before_compact` (no reducer case → default arm), which has no persisted counterpart and therefore cannot be synthesized. That residual divergence is pre-existing and stays.

## Capabilities

### New Capabilities

- `compaction-boundary-replay`: cold replay of pi `compaction` session entries as `session_compact` events — synthesis, positional ordering, absent-metadata semantics, and parity with the live path.

## Impact

- `packages/shared/src/state-replay.ts`: one new entry arm (~10 lines), alongside the existing `model_change` / `custom` / `custom_message` arms.
- `packages/shared/src/__tests__/state-replay.test.ts`: new cases (fixture exemplar already exists next to `state-replay-flow-events.test.ts`).
- No client change: `event-reducer.ts:2368` (`case "session_compact"`) is reused as-is.
- No bridge change: the live path already forwards `session_compact` and is untouched.
- `packages/shared/src/state-replay.ts.AGENTS.md`: purpose row + `See change:` per the Documentation Update Protocol.
- No double-render, per producer — the mechanism is register-time reset, NOT "warm and cold never coexist":
  - server cold load runs only when the events are absent from the buffer (`on-demand-session-replay`);
  - extension replay is preceded by `session_register`, where the server either wipes the store and broadcasts `session_state_reset` (client re-reduces from scratch) or sets `skipReplayInsert` so replayed events are never inserted (`event-wiring.ts:1281`). The synthesized `session_compact` rides the same gate as every other replayed event.
- Accepted trade-off (design D6): `session_compact` is not purely a render signal — `extractSessionUpdates` derives `{compacting:false}` from it and runs on replayed events too (`event-wiring.ts:827,910`). A reconnect that replays an OLD compaction entry while a NEW compaction is genuinely in flight clears the latch early, letting the reload dispatcher permit a mid-compaction reload for the remainder of that compaction. Bounded and self-healing (the real `session_compact` re-clears); a fix belongs in the replay-gating of the derivation, not in this arm.
- Resolved before drafting (was task 1.1): pre-compaction entries ARE retained by both producers. `appendCompaction` appends the entry as a child of the current leaf, so the parent chain both loaders walk still reaches the earlier messages; observed directly in real transcripts (96 of 170 compaction-bearing files carry content on both sides of the marker). The divider therefore lands between content, not at the top.

## Discipline Skills

- `review-code`: standard pre-commit review of a small shared-package change.
- `systematic-debugging`: only if task 1.1's `getBranch()` observation contradicts the fixture-based assumption — evidence first, before adjusting the arm.
- `security-hardening` not triggered: no untrusted input, auth, secrets or network surface; the entry is already-persisted local session data, and the `summary` text is deliberately NOT rendered.
- `performance-optimization` not triggered: one extra synthesized event per compaction (141 across 400 sessions) against ~1k events per replayed session.
- `observability-instrumentation` not triggered: no new endpoint, job, or external call.
