> Scenario ids (E#/P#/F#/X#) reference `test-plan.md`. C1–C3 are RESOLVED there: P1 gate = event-count ratio ≤ 2× cold-load; F3 observable = rendered streaming row text; X3 = passing guard (subagent frames are `subagent_*`, never raw `message_update`).

## 1. Fixtures (red first)

- [x] 1.1 Add `packages/server/src/__tests__/fixtures/replay-streams.ts` builders for five windows: plain assistant message, `[text, toolCall, text]` message, thinking-bearing message (`thinking_start|delta|end` on `message_update` + inline `thinking` blocks on `message_end`), mid-turn streaming tail (no `message_end`), subagent-interleaved window.
- [x] 1.2 Assert each fixture reduces to a sane `SessionState` with the CURRENT (uncompacted) reducer, so the fixtures themselves are trusted baselines.

## 2. Compaction unit tests (red)

- [x] 2.1 `replay-compaction.test.ts` — supersession + boundaries: **E1** 500-update window collapses to `[start, end]`, **E2** single-update min case, **E3** empty window, **E4** no-`message_end` window unchanged.
- [x] 2.2 Passthrough + shape: **E5** tool/turn/stats/session_compact/subagent events survive in original order, **E6** idempotence, **E8** window opening with a bare `message_end`.
- [x] 2.3 Seq contract: **E7** output seqs are exactly `[1,2,99,100]`, no `seq` mutated.
- [x] 2.4 Streaming tail: **E9** finalized M1 dropped while streaming M2's 12 updates survive.
- [x] 2.5 **P3** micro-perf: 20k-event window, p95 < 50 ms, single O(n) pass.
- [x] 2.6 **P2** ratio: compacted count ≤ 2× the `state-replay.ts` cold-load count for the same messages.
- [x] 2.7 Verify all of group 2 FAILS (module missing).

## 3. Reducer-equivalence test (the acceptance gate)

- [x] 3.1 Write `packages/server/src/__tests__/replay-compaction-equivalence.test.ts` importing the client `event-reducer`: **F1** plain assistant message, **F2** `[text, toolCall, text]` reorder path — both `deepEqual(reduceAll(raw), reduceAll(compacted))`.
- [x] 3.2 **F4** thinking-bearing message under BOTH policies (drop-thinking / exempt-thinking); record which is deep-equal incl. row content, order, `streamedLive` — this decides D2.
- [x] 3.3 **X3** subagent-interleaved window: `subagent_*` frames interleaved with parent updates survive compaction in original order and the window is reduce-equivalent (C3 resolved — no raw subagent `message_update`).

## 4. Implementation

- [x] 4.1 Create `packages/server/src/session/replay-compaction.ts` exporting the pure `compactEventsForReplay(stored: StoredEvent[]): StoredEvent[]`, implementing the positional supersession rule (D1) and the thinking policy chosen in 3.2. Document the rule + coupling to the client reducer in the file header, matching the `replay-truncate.ts` header style.
- [x] 4.2 Apply it in `sendEventBatches` (`subscription-handler.ts`) before batching, composed with the existing `truncateToolResultForReplay` map.
- [x] 4.3 Change `sendEventBatches` to return the PRE-compaction highest seq (D4).
- [x] 4.4 Raise `REPLAY_BATCH_SIZE` 50 → 200 with a comment referencing this change.
- [x] 4.5 Confirm tests from groups 2 and 3 now pass.

## 5. Handler integration tests

- [x] 5.1 Extend `packages/server/src/__tests__/subscription-handler.test.ts`: cold subscribe over a synthetic large window — replayed seq union has no duplicates and is strictly increasing.
- [x] 5.2 **X1** high-water mark: window whose highest seq (100) is compaction-dropped → `clearReplaying` receives `100`.
- [x] 5.3 **X2** catch-up: events 229..231 during replay of 1..228 (228 dropped) → catch-up batch is exactly 229..231, nothing ≤228 re-sent.
- [x] 5.4 **X6** warm delta subscribe unchanged; **X7** empty window → no `markReplaying`, single terminal batch.
- [x] 5.5 **E10/E11/E12** batch-size boundaries: 200 → 1 batch, 201 → 200+1, 1000 → 5 batches; only the last carries `isLast: true`.
- [x] 5.6 **X4** socket closes mid-replay → returns `0`, no unhandled rejection; **X5** `bufferedAmount` pinned >1 MB → pause then resume, all batches delivered in order.

## 6. Regression + budget

- [x] 6.1 Run the full suite: `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log`. Pay attention to `incremental-event-sync`, `on-demand-session-replay`, `ui-decorators-replay`, and client `event-reducer` suites.
- [x] 6.2 Build the large-session fixture (~20k events, #399 shape) — synthetic builder for L1, plus a `.jsonl` seed for the docker harness (new infra, see test-plan.md).
- [x] 6.3 Add `tests/e2e/large-session-replay.spec.ts`: **P1** replayed event count ≤ 2× cold-load count (C1), **F5** no `shouldReset` misfire with seq gaps, **F6** reasoning rows still render on reopen, **F3** mid-turn subscribe — rendered streaming row text equals the full accumulated text (C2). Harness port from `.pi-test-harness.json`, never `:18000`.
- [x] 6.4 **P4** RSS soak (L2): 10 consecutive cold subscribes, RSS returns within +10% of baseline. Needs a new `qa/` RSS-sampling helper.
- [x] 6.5 Measure a real large session before/after (event count, bytes, batch count, wall time) and record the numbers in the change folder.

## 7. Docs + close-out

- [x] 7.1 Delegate to DocScribe: `docs/architecture.md` replay section gains the compaction step; `docs/faq.md` entry for "reopening a big session is slow".
- [x] 7.2 Add/update the directory `AGENTS.md` rows for `replay-compaction.ts` and the new test files.
- [x] 7.3 `openspec validate compact-warm-replay-stream --strict`; confirm C1–C3 in `test-plan.md` are resolved and their scenarios authored.
- [x] 7.4 Reply on issue #399 with the measured numbers and the chosen thinking policy.
