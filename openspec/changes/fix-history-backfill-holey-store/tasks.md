# Tasks — fix-history-backfill-holey-store

TDD: for each area, write/adjust the folded test first (it should fail against
today's seq-span behaviour), then implement until green. Rebuild matrix:
server/shared → `curl -X POST /api/restart` (jiti, no build); client →
`npm run build` + restart. See the `implement` skill.

## 1. Store — count-bounded read

- [ ] 1.1 Add `getEventsEndingAt(sessionId, minSeq, maxSeq, limit)` to `EventStore` + the memory impl in `packages/server/src/persistence/memory-event-store.ts`: binary-search `end = lowerBound(maxSeq+1)` and `startFloor = lowerBound(minSeq)`, return `events.slice(Math.max(startFloor, end - limit), end)`; touch `buf.lastAccess`. Verify E8 passes.
- [ ] 1.2 Extend the range probe so `getEventsEndingAt` records `entriesExamined` (sibling to `getRangeProbe`). Verify P1 passes.

## 2. Server — count-bounded serve + servedFrom fix

- [ ] 2.1 In `handleHistoryBackfill` (`packages/server/src/browser-handlers/subscription-handler.ts`), reinterpret the cap as an event COUNT (`MAX_BACKFILL_EVENTS = 500`): tail-anchored path selects via `getEventsEndingAt`; head-anchored (legacy, no shipped caller) reads the gap-clamped range and takes the first N. Verify E1, E2, E3 pass.
- [ ] 2.2 Re-initialize `servedFrom = slice.length > 0 ? slice[0].seq : from` immediately after the read (snap may raise it further) — never leave it at the requested `from`. This is the silent-data-loss fix. Verify E4 passes.
- [ ] 2.3 Confirm the tail credit + `remainingGapCount` recompute still key on the post-snap served bounds, and that a fully-superseded (compaction-emptied) slice still retreats `tailMinSeq` to the selected slice's lowest seq. Verify E5 passes.
- [ ] 2.4 Confirm out-of-range / inverted-range refusals are unchanged. Verify E6, E7 pass.

## 3. Client — request range, termination, holeyness

- [ ] 3.1 In `nextBackfillRange` (`packages/client/src/lib/chat/history-gap.ts`), request the full remaining range: `toSeq = tailMinSeq − 1`, `fromSeq = floor` (`headMaxSeq+1` two-sided, `oldestGapSeq` head-free) — drop the `− BACKFILL_MAX_SPAN` subtraction. Remove the now-dead client `BACKFILL_MAX_SPAN` seq-window use. Verify E9, E10 pass.
- [ ] 3.2 In `createHistoryGapState`, compute + store a `holey` boolean (`gapCount < tailMinSeq − headMaxSeq − 1`), forced `false` for `windowShape === "tail-only"`. Verify E12 passes.
- [ ] 3.3 In `useMessageHandler.ts` `history_backfill_result`, restructure the branch set: keep `msg.error` FIRST and the `!dividerPlaced` no-op; splice events BEFORE exhaustion; `exhausted = msg.remainingGapCount === 0` (drop `events.length === 0`); order — head-free→floor terminus, two-sided+holey→two-sided terminus, two-sided contiguous→remove divider; non-exhausted retreats tail + keeps armed, never sets `unservable`. Verify F1, F2, F3, F4, F5, E11, X1, X2 pass.
- [ ] 3.4 Add the two-sided terminus client state (a dedicated flag, NOT reused `atFloor`); render it via the existing `not-retained` `TerminusRow` in `HistoryGapDivider.tsx`. Verify F3, F6 pass.
- [ ] 3.5 Remove the retired `unservable` orphans (this change creates them): the field in `HistoryGapState`, `!t.unservable` in `shouldAutoLoadHistory` + `TriggerInputs`, the `App.tsx` `!gap.unservable` auto-load guard, the `ChatView.tsx` trigger input, and the A5 render branch in `HistoryGapDivider.tsx`. Verify `npm test` + `npm run build` stay green and no reference to `unservable` remains (`rg unservable packages/client packages/server` is empty).

## 4. Tests (folded from test-plan.md — automated rows)

- [ ] 4.1 E1 — at-cap serve (test-plan #E1, see packages/server/src/__tests__/subscription-handler-backfill.test.ts). input: store holds exactly 500 events in `[floor, tailMinSeq−1]` · trigger: one `history_backfill` · observable: all 500 served in one response, `remainingGapCount === 0`.
- [ ] 4.2 E2 — just-above-cap serves newest (test-plan #E2, see subscription-handler-backfill.test.ts). input: 501 events in range · trigger: one `history_backfill` · observable: 500 newest served, `servedFrom` = 500th-newest seq (not floor), `remainingGapCount ≥ 1`.
- [ ] 4.3 E3 — sparse wide range in one response (test-plan #E3, see subscription-handler-backfill.test.ts). input: 92 events over 102 000 seqs · trigger: one `history_backfill` from `[headMaxSeq+1, tailMinSeq−1]` · observable: all served (modulo one snap step), no seq-distance refusal.
- [ ] 4.4 E4 — servedFrom = lowest SELECTED seq, no silent drop (test-plan #E4, see subscription-handler-backfill.test.ts). input: >500 events, 500th-newest is a `message_start` (no snap) · trigger: one `history_backfill` · observable: `servedFrom === slice[0].seq`, `tailMinSeq` retreats to it, `remainingGapCount > 0`.
- [ ] 4.5 E5 — fully-superseded slice retreats tail (test-plan #E5, see subscription-handler-compaction.test.ts). input: 500-event slice all superseded `message_update`s · trigger: `history_backfill` → compaction empties delivery · observable: `events: []`, `servedFrom` = selected lowest seq, `remainingGapCount` strictly decreases.
- [ ] 4.6 E6 — disjoint range refused (test-plan #E6, see subscription-handler-backfill.test.ts). input: range disjoint from gap · trigger: `history_backfill` · observable: `error: out_of_range`, `events: []`.
- [ ] 4.7 E7 — inverted range refused (test-plan #E7, see subscription-handler-backfill.test.ts). input: `fromSeq > toSeq` · trigger: `history_backfill` · observable: `error: out_of_range`, `events: []`.
- [ ] 4.8 E8 — count-bounded store read (test-plan #E8, see packages/server/src/__tests__/memory-event-store.test.ts). input: 1000 events ≤ maxSeq, `limit=500` · trigger: `getEventsEndingAt(sid, minSeq, maxSeq, 500)` · observable: highest 500 seqs ascending, `result[0].seq` = 501st-highest, never below `minSeq`.
- [ ] 4.9 E9 — client requests full remaining range (test-plan #E9, see packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx). input: announced two-sided + head-free gaps · trigger: `nextBackfillRange(gap)` · observable: two-sided `{headMaxSeq+1, tailMinSeq−1}`, head-free `{oldestGapSeq, tailMinSeq−1}`.
- [ ] 4.10 E10 — successive requests walk downward (test-plan #E10, see useMessageHandler.history-gap.test.tsx). input: first response retreats tail to `S` · trigger: next request · observable: next `toSeq === S−1`, `fromSeq` still floor.
- [ ] 4.11 E11 — final request, snap defers last event (test-plan #E11, see subscription-handler-backfill.test.ts). input: remaining < cap, snap holds back lowest events · trigger: final `history_backfill` · observable: `remainingGapCount > 0`, a further request serves remainder then reports `0`.
- [ ] 4.12 E12 — holeyness from announced window (test-plan #E12, see useMessageHandler.history-gap.test.tsx). input: `gapCount=92 span=102113`, and `gapCount==span`, and a `tail-only` gap · trigger: `createHistoryGapState` · observable: `holey` true / false / forced-false respectively, no extra request.
- [ ] 4.13 P1 — bounded read does not scan the gap (test-plan #P1, see memory-event-store.test.ts). workload: 20 000-event buffer, `getEventsEndingAt` limit 500 over most of the buffer · metric: probe `entriesExamined < 1000` (not 20 000) · window: single call.
- [ ] 4.14 F1 — empty + remaining continues (reported-bug guard) (test-plan #F1, see useMessageHandler.history-gap.test.tsx). input: `head-tail` gap armed · trigger: result `events: [], remainingGapCount: 80` · observable: `unservable === false`, `atFloor === false`, "Load earlier" shown, "no longer available to load" never rendered.
- [ ] 4.15 F2 — contiguous exhaustion removes affordance (test-plan #F2, see useMessageHandler.history-gap.test.tsx). input: `head-tail`, `holey === false` · trigger: result `remainingGapCount: 0` with events · observable: `HISTORY_GAP_ROW_ID` removed, gap cleared.
- [ ] 4.16 F3 — holey exhaustion → not-retained terminus (test-plan #F3, see useMessageHandler.history-gap.test.tsx). input: `head-tail`, `holey === true` · trigger: result `remainingGapCount: 0` · observable: divider NOT removed, resolves to two-sided terminus distinct from `atFloor`.
- [ ] 4.17 F4 — head-free empty above non-empty floor keeps affordance (test-plan #F4, see useMessageHandler.history-gap.test.tsx). input: `tail-only` armed · trigger: result `events: [], remainingGapCount: 12` · observable: `atFloor === false`, affordance retained, no terminus.
- [ ] 4.18 F5 — head-free floor terminus start-vs-trimmed (test-plan #F5, see useMessageHandler.history-gap.test.tsx). input: `tail-only` `remainingGapCount: 0`, `oldestGapSeq > 1` then `=== 1` · trigger: terminal result · observable: `not-retained` then `session-start`.
- [ ] 4.19 F6 — terminus rendering (test-plan #F6, see packages/client/src/components/chat/__tests__/HistoryGapDivider.test.tsx). input: two-sided-holey-exhausted state, and head-free `atFloor oldestGapSeq>1` · trigger: render `HistoryGapDivider` · observable: both render `not-retained` `TerminusRow`, no retry, not error-styled.
- [ ] 4.20 X1 — refusal is not exhaustion (test-plan #X1, see useMessageHandler.history-gap.test.tsx). fault: `error: stale_generation` (payload `remainingGapCount: 0`) · trigger: client handles result · observable: gap `failed: true` + retry, divider NOT removed, no terminus, not exhausted.
- [ ] 4.21 X2 — divider-less response is a no-op (test-plan #X2, see useMessageHandler.history-gap.test.tsx). fault: result arrives with `HISTORY_GAP_ROW_ID` absent · trigger: client handles it · observable: `pending` cleared, `tailMinSeq`/`remainingGapCount` unchanged, transcript unchanged.
- [ ] 4.22 G1 — end-to-end holey backfill (test-plan #G1, see tests/e2e/history-backfill-gap.spec.ts). input: docker harness seeded with a holey session (needs the new fixture in §5.1) · trigger: click "Load earlier" · observable: gap fills in a few clicks (not ~205), "no longer available to load." never appears, holey-exhausted shows "no longer retained" terminus.

## 5. Infra + integration

- [ ] 5.1 Author the seeded HOLEY-session fixture the G1 e2e needs (head + trimmed middle + tail; gap ≫ cap in seqs, ≤ a few × cap in events), OR — if the fixture proves disproportionately expensive — record the decision to drop G1 to manual-only (its risk is covered at L1 by F1/F3/X1) in this change's notes. See test-plan.md "New infra needed".
- [ ] 5.2 Full suite green: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep for failures; `npm run build`. Restart per the rebuild matrix and confirm `/api/health` reports the running mode.
- [ ] 5.3 Manual reproduction on the live holey session (`01a052cb…` or any long trimmed session): open it, click "Load earlier", confirm the gap fills quickly and the dead-end string no longer appears at a sparse step.
