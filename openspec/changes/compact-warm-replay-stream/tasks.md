> Scenario ids (E#/P#/F#/X#) reference `test-plan.md`. Three rows are blocked on clarifications C1–C3 there and are folded as blocked tasks.

## 1. Fixtures (red first)

- [ ] 1.1 Add `packages/server/src/__tests__/fixtures/replay-streams.ts` builders for five windows: plain assistant message, `[text, toolCall, text]` message, thinking-bearing message (`thinking_start|delta|end` on `message_update` + inline `thinking` blocks on `message_end`), mid-turn streaming tail (no `message_end`), subagent-interleaved window.
- [ ] 1.2 Assert each fixture reduces to a sane `SessionState` with the CURRENT (uncompacted) reducer, so the fixtures themselves are trusted baselines.

## 2. Compaction unit tests (red)

- [ ] 2.1 `replay-compaction.test.ts` — supersession + boundaries: **E1** 500-update window collapses to `[start, end]`, **E2** single-update min case, **E3** empty window, **E4** no-`message_end` window unchanged.
- [ ] 2.2 Passthrough + shape: **E5** tool/turn/stats/session_compact/subagent events survive in original order, **E6** idempotence, **E8** window opening with a bare `message_end`.
- [ ] 2.3 Seq contract: **E7** output seqs are exactly `[1,2,99,100]`, no `seq` mutated.
- [ ] 2.4 Streaming tail: **E9** finalized M1 dropped while streaming M2's 12 updates survive.
- [ ] 2.5 **P3** micro-perf: 20k-event window, p95 < 50 ms, single O(n) pass.
- [ ] 2.6 **P2** ratio: compacted count ≤ 2× the `state-replay.ts` cold-load count for the same messages.
- [ ] 2.7 Verify all of group 2 FAILS (module missing).

## 3. Reducer-equivalence test (the acceptance gate)

- [ ] 3.1 Write `packages/server/src/__tests__/replay-compaction-equivalence.test.ts` importing the client `event-reducer`: **F1** plain assistant message, **F2** `[text, toolCall, text]` reorder path — both `deepEqual(reduceAll(raw), reduceAll(compacted))`.
- [ ] 3.2 **F4** thinking-bearing message under BOTH policies (drop-thinking / exempt-thinking); record which is deep-equal incl. row content, order, `streamedLive` — this decides D2.
- [ ] 3.3 **X3** subagent-interleaved window — BLOCKED on clarification C3 (does any producer emit a raw `message_update` between a parent `message_start` and `message_end`?). Resolve before authoring; outcome either passes as-is or narrows the D1 rule.

## 4. Implementation

- [ ] 4.1 Create `packages/server/src/session/replay-compaction.ts` exporting the pure `compactEventsForReplay(stored: StoredEvent[]): StoredEvent[]`, implementing the positional supersession rule (D1) and the thinking policy chosen in 3.2. Document the rule + coupling to the client reducer in the file header, matching the `replay-truncate.ts` header style.
- [ ] 4.2 Apply it in `sendEventBatches` (`subscription-handler.ts`) before batching, composed with the existing `truncateToolResultForReplay` map.
- [ ] 4.3 Change `sendEventBatches` to return the PRE-compaction highest seq (D4).
- [ ] 4.4 Raise `REPLAY_BATCH_SIZE` 50 → 200 with a comment referencing this change.
- [ ] 4.5 Confirm tests from groups 2 and 3 now pass.

## 5. Handler integration tests

- [ ] 5.1 Extend `packages/server/src/__tests__/subscription-handler.test.ts`: cold subscribe over a synthetic large window — replayed seq union has no duplicates and is strictly increasing.
- [ ] 5.2 **X1** high-water mark: window whose highest seq (100) is compaction-dropped → `clearReplaying` receives `100`.
- [ ] 5.3 **X2** catch-up: events 229..231 during replay of 1..228 (228 dropped) → catch-up batch is exactly 229..231, nothing ≤228 re-sent.
- [ ] 5.4 **X6** warm delta subscribe unchanged; **X7** empty window → no `markReplaying`, single terminal batch.
- [ ] 5.5 **E10/E11/E12** batch-size boundaries: 200 → 1 batch, 201 → 200+1, 1000 → 5 batches; only the last carries `isLast: true`.
- [ ] 5.6 **X4** socket closes mid-replay → returns `0`, no unhandled rejection; **X5** `bufferedAmount` pinned >1 MB → pause then resume, all batches delivered in order.

## 6. Regression + budget

- [ ] 6.1 Run the full suite: `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log`. Pay attention to `incremental-event-sync`, `on-demand-session-replay`, `ui-decorators-replay`, and client `event-reducer` suites.
- [ ] 6.2 Build the large-session fixture (~20k events, #399 shape) — synthetic builder for L1, plus a `.jsonl` seed for the docker harness (new infra, see test-plan.md).
- [ ] 6.3 Add `tests/e2e/large-session-replay.spec.ts`: **P1** replay budget (BLOCKED on C1 — pick byte/count gate over wall-clock for determinism), **F5** no `shouldReset` misfire with seq gaps, **F6** reasoning rows still render on reopen, **F3** mid-turn subscribe tail (BLOCKED on C2 — name the convergence observable). Harness port from `.pi-test-harness.json`, never `:18000`.
- [ ] 6.4 **P4** RSS soak (L2): 10 consecutive cold subscribes, RSS returns within +10% of baseline. Needs a new `qa/` RSS-sampling helper.
- [ ] 6.5 Measure a real large session before/after (event count, bytes, batch count, wall time) and record the numbers in the change folder.

## 7. Docs + close-out

- [ ] 7.1 Delegate to DocScribe: `docs/architecture.md` replay section gains the compaction step; `docs/faq.md` entry for "reopening a big session is slow".
- [ ] 7.2 Add/update the directory `AGENTS.md` rows for `replay-compaction.ts` and the new test files.
- [ ] 7.3 `openspec validate compact-warm-replay-stream --strict`; confirm C1–C3 in `test-plan.md` are resolved and their blocked scenarios authored.
- [ ] 7.4 Reply on issue #399 with the measured numbers and the chosen thinking policy.
