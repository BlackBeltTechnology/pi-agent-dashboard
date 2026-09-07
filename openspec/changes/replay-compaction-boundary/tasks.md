# Tasks

## 1. Replay arm (packages/shared)

- [ ] 1.1 Test: boundary synthesized between neighbours (test-plan #E1) — see packages/shared/src/__tests__/state-replay.test.ts. Entries `[message A, compaction C, message B]` · `replayEntriesAsEvents` · exactly one `session_compact`, indexed between A's and B's events, `timestamp === C.timestamp`. Verify it FAILS first.
- [ ] 1.2 Test: no-compaction output unchanged (test-plan #E2) — see packages/shared/src/__tests__/state-replay.test.ts. Existing compaction-free fixture · `replayEntriesAsEvents` · output deep-equals the pre-change output, nothing added/removed/reordered.
- [ ] 1.3 Test: one event per entry, in order (test-plan #E3) — see packages/shared/src/__tests__/state-replay.test.ts. Branches with 0/1/2/3 `compaction` entries · `replayEntriesAsEvents` · emitted `session_compact` count equals entry count, entry order preserved.
- [ ] 1.4 Test: first-entry and last-entry positions (test-plan #E4) — see packages/shared/src/__tests__/state-replay.test.ts. `compaction` as first, then as last entry of the branch · `replayEntriesAsEvents` · event emitted first/last respectively, no throw, neighbours intact.
- [ ] 1.5 Test: metadata is not fabricated (test-plan #E5) — see packages/shared/src/__tests__/state-replay.test.ts. Entry with `summary`/`tokensBefore`/`firstKeptEntryId`/`fromHook`/`details` · `replayEntriesAsEvents` · emitted `data` has no `reason`, `willRetry` or `estimatedPostCompactionTokens` key.
- [ ] 1.6 Test: summary never leaks into the stream (test-plan #E6) — see packages/shared/src/__tests__/state-replay.test.ts. Entry with a 64 KB `summary` · `replayEntriesAsEvents` · no emitted payload contains any substring of it.
- [ ] 1.7 Test: schema drift tolerated (test-plan #E7) — see packages/shared/src/__tests__/state-replay.test.ts. Entries missing `timestamp`, missing `tokensBefore`, and carrying an unknown `usage` field · `replayEntriesAsEvents` · one `session_compact` each, no throw, unknown field ignored.
- [ ] 1.8 Test: one bad entry does not abort the replay (test-plan #X1) — see packages/shared/src/__tests__/state-replay.test.ts. Branch with a truncated/garbage `compaction` entry beside valid messages · `replayEntriesAsEvents` · valid message events still emitted, converter does not abort.
- [ ] 1.9 Implement the `entry.type === "compaction"` arm in `packages/shared/src/state-replay.ts`, beside the `model_change` arm — `makeEvent(sessionId, "session_compact", ts, {})`, pushed inside the existing entry loop (design D1/D2/D4). Verify 1.1–1.8 pass.

## 2. Cross-consumer parity (packages/client, packages/server)

- [ ] 2.1 Test: replayed and live events reduce identically (test-plan #E8) — see packages/client/src/lib/__tests__/event-reducer-compaction.test.ts. Synthesized event vs metadata-free live `session_compact` · reduce both · identical message row, `compaction` metadata unset in both.
- [ ] 2.2 Test: `compacting` latch converges despite an early clear (test-plan #E9) — see packages/server/src/__tests__/event-status-extraction.test.ts. Sequence `session_before_compact` → replayed old `session_compact` → real `session_compact` · `extractSessionUpdates` per event · ends `{compacting:false}`, never stuck `true` (design D6 trade-off asserted as transient).

## 3. E2E (tests/e2e)

- [ ] 3.1 Test: cold reload shows one boundary between content (test-plan #F1) — see tests/e2e/custom-entry-replay-parity.spec.ts (same replay-parity shape; harness port from `.pi-test-harness.json`, never hardcoded). Harness session file with a `compaction` entry and messages on both sides, events evicted · open the session in the browser · transcript converges to exactly one `── Session compacted ──` row with messages above and below.
- [ ] 3.2 Test: reconnect replay does not duplicate the boundary (test-plan #F2) — see tests/e2e/custom-entry-replay-parity.spec.ts. Session already showing one boundary live · force a bridge reconnect so `replaySessionEntries()` re-forwards the branch · exactly one boundary row remains after replay completes.

## 4. Docs

- [ ] 4.1 Update the `state-replay.ts` purpose row in `packages/shared/src/state-replay.ts.AGENTS.md` — note the `compaction` → `session_compact` arm and add `See change: replay-compaction-boundary` (Documentation Update Protocol; source-tree row, main agent edits directly).

## 5. Verify

- [ ] 5.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary pattern — full suite green.
- [ ] 5.2 Restart the dashboard (`curl -X POST http://localhost:8000/api/restart` — shared-package change, jiti, no build) and open a real compacted session that was evicted; confirm one boundary row, positioned between content, and nothing else in the transcript shifted.
- [ ] 5.3 `review-code` pass on the diff before commit.
