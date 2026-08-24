Test tasks are folded from `test-plan.md`; that manifest — not any tag here — is the source of truth for automated-vs-manual. Per the repo's TDD rule each folded test is authored RED before the implementation task it gates, and the red run is recorded. Groups 0 and 9 are gates, not implementation.

## 0. Prerequisite gates — do not start implementation until all pass

- [x] 0.1 Confirm `fix-lazy-history-backfill-ux` is implemented AND archived. Tail-anchored `nextBackfillRange`, orientation-based edge crediting (its task 2.2), the `elided` tool status, and the scroll-anchor deletion are all assumed by this change.
- [x] 0.2 Check how its task 1.3 (`oldestGapSeq` drop-vs-keep) resolved. This is a BRANCH, not a gate: KEEP → proceed; DROP → restore the field as part of task 4.5, since this change owns it (design D5).
- [x] 0.3 Confirm archive ordering: this change's `session-history-backfill` delta MODIFIES a requirement `fix-lazy-history-backfill-ux` ADDs, so it must archive second.

## 1. Shared config and wire shape (D1, D2a)

- [x] 1.1 Author in `packages/shared/src/__tests__/config.test.ts` — config `{}` with the field absent · `parseMemoryLimits` · returns `replayWindowMode: "head-tail"` (test-plan #E1). Copy harness glue from the sibling `maxReplayEvents` cases in that file.
- [x] 1.2 Author in `packages/shared/src/__tests__/config.test.ts` — `replayWindowMode` of `"tail"`, `7`, `null`, `[]`, `"TAIL-ONLY"` · `parseMemoryLimits` · each returns `"head-tail"` and none throws (test-plan #E2). Same exemplar.
- [x] 1.3 Author in `packages/shared/src/__tests__/config.test.ts` — `replayWindowMode: "tail-only"` · `parseMemoryLimits` · returned verbatim (test-plan #E3). Same exemplar.
- [x] 1.4 Author in `packages/shared/src/__tests__/config.test.ts` — `maxReplayEvents` ∈ {0,1,5,99,100,101} × mode ∈ {head-tail, tail-only} · `parseMemoryLimits` · 0→0, 1/5/99→100, 100→100, 101→101, and both modes return identical values for every input (test-plan #E4). Same exemplar.
- [x] 1.5 Add `replayWindowMode` to `MemoryLimits`, `DEFAULT_MEMORY_LIMITS`, and `parseMemoryLimits` in `packages/shared/src/config.ts`, coercing unknown values to the default per the existing fallback convention. Green 1.1–1.4.
- [x] 1.6 Replace the `MIN_REPLAY_WINDOW` doc comment's rationale — "so a head-free window is unreachable by configuration" is now false and will mislead the next reader.
- [x] 1.7 Add `windowShape?: "head-tail" | "tail-only"` to `HistoryWindowMessage` in `packages/shared/src/browser-protocol.ts`; widen the `headMaxSeq` doc comment from `>= 1` to `>= 0`. Optional, so an older client degrades to `head-tail`.
- [x] 1.8 Thread the mode to `BrowserHandlerContext` through `packages/server/src/server.ts`, `cli.ts`, and `pairing/browser-gateway.ts`, alongside `maxReplayEvents`.

## 2. Server — head-free window, announcement, and the reset relocation (D2, D2a, D3)

- [x] 2.1 Author in `packages/server/src/__tests__/subscription-handler-window.test.ts` — compacted streams of 499/500/501 events at `maxReplayEvents: 500` in `tail-only` · `sendEventBatches` · 499 and 500 emit no `history_window` (fits-entirely short-circuit), 501 windows to exactly 500 delivered (test-plan #E5).
- [x] 2.2 Author in `subscription-handler-window.test.ts` — compacted stream of 5000, limit 500, `tail-only` · `computeReplayWindow` then the announcement block · returns `headEnd: 0` and announces `headMaxSeq: 0` **without throwing** (test-plan #E6). This pins the `full[replayWindow.headEnd - 1]` → `full[-1]` crash.
- [x] 2.3 Author in `subscription-handler-window.test.ts` — mode ∈ {head-tail, tail-only} × `maxReplayEvents` ∈ {0,500}, stream of 5000 · subscribe with `lastSeq: 0` · limit 0 delivers 5000 unwindowed in BOTH modes; limit 500 delivers 500 shaped per mode (test-plan #E7).
- [x] 2.4 Author in `subscription-handler-window.test.ts` — `tail-only` tail cut landing mid-assistant-message with a `message_start` 30 events forward · `computeReplayWindow` · first delivered event is that `message_start`, delivered count ≤ limit, no head-edge scan performed (test-plan #E8).
- [x] 2.5 Author in `subscription-handler-window.test.ts` — a window applied in each mode · announcement emitted · `windowShape` is `"tail-only"` / `"head-tail"` respectively and is optional in the type (test-plan #E9).
- [x] 2.6 Implement the mode parameter on `computeReplayWindow` and the `headEnd: 0` branch; `HEAD_RATIO`/`HEAD_MIN`/`HEAD_CAP` consulted only in `head-tail`; keep the fits-entirely short-circuit unconditional; special-case `headMaxSeq` to `0`; emit `windowShape`. Green 2.1–2.5.
- [x] 2.7 Author in `subscription-handler-window.test.ts` — a client already holding transcript rows · a `tail-only` windowed replay whose first seq is `4501` · prior rows discarded rather than appended beneath, asserted without relying on `firstSeq === 1` (test-plan #X1).
- [x] 2.8 Author in `subscription-handler-window.test.ts` — a windowed full stream on each of `:571` (stale `lastSeq`), `:616` (warm), `:693` (cold hydration) · subscribe / hydrate · `session_state_reset` precedes `history_window` on all three, and the never-windowed delta site `:625` sends none (test-plan #X2).
- [x] 2.9 Author in `subscription-handler-window.test.ts` — a stream over the limit UNCOMPACTED but under it COMPACTED · warm subscribe · no reset is sent and the transcript is still correct because the replay starts at seq `1` (test-plan #X3). Pins the first sequence D3 changes for existing `head-tail` users.
- [x] 2.10 Author in `subscription-handler-window.test.ts` — a windowed replay carrying `pi-asset:` tokens · reset now follows `replaySessionAssets` · the tokens still resolve in the delivered window (test-plan #X4). Pins the second changed sequence.
- [x] 2.11 Move the reset into `sendEventBatches`, emitted when `replayWindow !== null`, immediately before `history_window`; delete the two call-site guards. No asset-ordering contingency — `session_state_reset` reduces to `createInitialState()` and `asset_register` is a documented no-op in that reducer. Green 2.7–2.10.
  - **As built (both guards deleted, per the original text).** An earlier pass kept the stale-`lastSeq` guard on the grounds that it is not window-gated and that `subscription-handler.test.ts` asserted it against a 3-event store; that deviation is REVERTED. Deleting it changes the wire only for an UNWINDOWED stale-`lastSeq` replay, which loses its `session_state_reset` frame — harmless because that replay starts at seq 1 and the reducer's `firstSeq === 1` rule wipes transcript state regardless.
  - The shipped test was SPLIT rather than weakened: the unwindowed arm now asserts `resets === 0` **plus** `allEvents[0].seq === 1` (the property that makes the absence safe), and a NEW windowed arm asserts exactly one reset ordered before `history_window` and before any `event_replay`. Verified fails-closed: stubbing the `sendEventBatches` reset to `if (false)` turns the windowed arm red.
  - Net effect vs the deviation: a windowed stale-`lastSeq` replay now emits ONE reset, not two.
- [x] 2.12 Update `sendEventBatches`' docblock and the `GapState.headMaxSeq` comment — both assert head-side advancement as the termination mechanism, which is wrong after `fix-lazy` and wrong again here.

## 3. Server — edge crediting (D4)

- [x] 3.1 Author in `packages/server/src/__tests__/subscription-handler-backfill.test.ts` — server `GapState` `{hasHead: false, headMaxSeq: 0, tailMinSeq: 4501}` and a request `from: 1` · `handleHistoryBackfill` · the tail bound retreats, `headMaxSeq` stays `0`, `remainingGapCount` matches a store read (test-plan #E10).
- [x] 3.2 Author in `subscription-handler-backfill.test.ts` — a range abutting head **and** tail in a `head-tail` window · `handleHistoryBackfill` · the tail is credited, the head is not (test-plan #E11).
- [x] 3.3 Add `hasHead: boolean` to the SERVER's `GapState` (`subscription-handler.ts:71`, per-socket — not the client's `HistoryGapState`), derived from the configured mode when the window is computed, and gate the head credit on it. Green 3.1–3.2.

## 4. Client — floor, terminus, and splice bookkeeping (D5, D6)

- [x] 4.1 Author in `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx` — gap `{tailMinSeq: 4501, oldestGapSeq: 3000}` with `BACKFILL_MAX_SPAN: 500` · repeated `nextBackfillRange` · ranges walk down and the final `fromSeq` is exactly `3000`, never lower (test-plan #E12).
- [x] 4.2 Author in `useMessageHandler.history-gap.test.tsx` — `oldestGapSeq: 1` · walk to completion · last range starts at `1` and the terminus reports "beginning of the session" (test-plan #E13).
- [x] 4.3 Author in `useMessageHandler.history-gap.test.tsx` — `oldestGapSeq: 3000` after a retention trim · walk to completion · terminus reports "earlier events not retained" and names neither retention nor compaction (test-plan #E14).
- [x] 4.4 Author in `useMessageHandler.history-gap.test.tsx` — a store trimmed mid-gap so a floored range is legal but empty · response `events: [], remainingGapCount: 0` · the terminus is shown, NOT `unservable` (test-plan #X5).
- [x] 4.5 Floor `nextBackfillRange`'s lower bound at `oldestGapSeq` for a head-free gap, keyed on the ANNOUNCED `windowShape`, never on `headMaxSeq === 0`. If task 0.2 found the field dropped, restore it here. Green 4.1–4.4.
- [x] 4.6 Author in `useMessageHandler.history-gap.test.tsx` — a response for a session whose gap row is absent (session switched mid-flight) · response applied · `messages[]` unchanged AND gap bookkeeping not advanced (test-plan #X6).
- [x] 4.7 Add `atFloor` to `HistoryGapState`; resolve the exhaustion branches; fix the `unservable: exhausted` assignment; guard the divider-less splice. Green 4.4 and 4.6.

## 5. Client — the loading head and its trigger (D7, D7a)

- [x] 5.1 Author `packages/client/src/lib/chat/__tests__/history-gap-trigger.test.ts` — `nearTop` with `pendingUserIntent` true, gap armed/servable/head-free, outside the suppression window · settle timer expires · `shouldAutoLoadHistory` returns `true` exactly once and the intent flag clears on issue (test-plan #F1). Copy harness glue from `packages/client/src/lib/chat/__tests__/attachment-original-url.test.ts` (pure-module suite, no DOM).
- [x] 5.2 Author in `history-gap-trigger.test.ts` — `nearTop` true but `pendingUserIntent` false, only stamped scroll events since the last request · settle timer expires · returns `false`; covers the splice-induced and measurement-commit re-fires (test-plan #F2).
- [x] 5.2a Author in `history-gap-trigger.test.ts` — a splice smaller than the proximity band leaves the user `nearTop`, then one un-stamped user scroll · settle timer expires · returns `true`; the walk does not stall because intent is tracked rather than position (test-plan #F2a).
- [x] 5.2b Author in `history-gap-trigger.test.ts` — `pendingUserIntent` true with three evaluations inside the suppression window, then the stamp lapses · stamp expiry schedules an evaluation · the suppressed evaluations change no state and fire nothing; the post-expiry evaluation fires exactly once (test-plan #F2b).
- [x] 5.3 Author in `history-gap-trigger.test.ts` — identical state but `windowShape: "head-tail"` · settle timer expires · returns `false`; a two-sided gap is never auto-loaded (test-plan #F3).
- [x] 5.4 Author in `history-gap-trigger.test.ts` — a rising edge crossed with each of `pending`, `failed`, `unservable`, `atFloor`, `!armed` · settle timer expires · returns `false` for every flag independently (test-plan #F4).
- [x] 5.5 Author in `history-gap-trigger.test.ts` — scroll events spaced 110ms apart followed by 130ms of silence · timer evaluation · no fire while events are 110ms apart, exactly one fire after the 130ms gap (test-plan #F7). Pins the momentum boundary that `SETTLE_MS = 120` deliberately risks.
- [x] 5.6 Implement `shouldAutoLoadHistory` in `packages/client/src/lib/chat/history-gap.ts` taking booleans only. Green 5.1–5.5, 5.2a–5.2b. Do NOT inline the predicate in `ChatView` — jsdom reports no layout, which would make an in-component assertion vacuous.
- [ ] 5.7 Author a timed L1 benchmark beside `history-gap-trigger.test.ts` — 5s of synthesised scroll events at 60Hz (≈300 events) against `handleScroll`'s bookkeeping path · measured per event · added time < 1ms p95 (test-plan #P1). Copy timing-harness glue from `tests/e2e/chat-render-perf.spec.ts`'s measurement approach, adapted to an in-process vitest benchmark.
- [x] 5.8 Wire the predicate into `ChatView`: own `pendingUserIntent` (set by any un-stamped scroll event AND by scroll-to-top activation; cleared on issuing a request, at mount, and on session change) and `programmaticScrollUntil`. `handleScroll` ONLY records state and restarts the `SETTLE_MS = 120` timer; evaluation happens at settle expiry AND at suppression-window expiry, and a suppressed evaluation changes no state. Do NOT evaluate per scroll event, and do NOT use `onTouchStart`/`onTouchEnd` — WebKit fires `touchend` BEFORE momentum begins. Dispatch through the existing `onLoadEarlier` prop only. Green 5.7.
- [x] 5.9 Add the shared `programmaticScrollUntil` stamp and set it in EVERY scroll-position writer in `ChatView` — sweep the file rather than working from a list; today that is roughly nine sites (`:424` ref restore, `:784` bottom-pin, `:791` ascent re-issue, `:906` scroll-to-top, `:933`/`:937` restore + offset, `:983` scroll-to-bottom, `:1036` selection compensator, `:1062` `scrollToTurn`). Remove the trigger's dependency on `ascendingRef`.
- [ ] 5.10 Author `tests/e2e/tail-only-trigger-suppression.spec.ts` — a session saved scrolled to the top, switched away and back · restore drives `scrollTop → 0` on first paint · NO `history_backfill` frame on the wire (test-plan #F5). Copy harness glue from `tests/e2e/scroll-to-top.spec.ts`.
- [ ] 5.11 Author in `tail-only-trigger-suppression.spec.ts` — transcript scrolled to the bottom · user activates scroll-to-top and lands on the loading head · exactly one `history_backfill` results, not zero and not a chain (test-plan #F6).
- [ ] 5.12 Author in `tail-only-trigger-suppression.spec.ts` — mobile viewport, touch fling upward into the proximity band · `touchend` fires while momentum continues ~200ms · no request until momentum stops, then exactly one (test-plan #F8).
- [ ] 5.12a Author in `tail-only-trigger-suppression.spec.ts` — `tail-only` scrolled to the bottom · `scrollToTurn` navigation to an early turn drives the view near the top · NO `history_backfill` frame (test-plan #F19). The design flagged `scrollToTurn` as an unlatched ascent source; this is the scenario that catches a missing stamp.
- [ ] 5.12b Author in `tail-only-trigger-suppression.spec.ts` — short `tail-only` transcript pinned at the bottom while content streams · the bottom-pin and the selection compensator write `scrollTop` · NO `history_backfill` frame from either (test-plan #F20).
- [x] 5.13 Author `tests/e2e/tail-only-splice-anchor.spec.ts` — `tail-only`, user parked on the loading head, 200 rows spliced · backfill response applied · the first previously-loaded row holds its viewport position, the loading head leaves the proximity band, and scrolling up again produces a second request (test-plan #F9). Copy harness glue from `tests/e2e/large-session-replay.spec.ts`.
- [x] 5.14 Author in `tail-only-splice-anchor.spec.ts` — the same splice in `head-tail` · response applied · `scrollTop` is left alone per fix-lazy; the two modes do not share the branch (test-plan #F10).
- [x] 5.14a Author in `tail-only-splice-anchor.spec.ts` — `tail-only` with a text selection held mid-transcript · the loading head fills · the selection-anchor compensator stays ACTIVE and the selection holds its position, the inverse of fix-lazy's `head-tail` suppression (test-plan #F18).
- [~] 5.15 Implement D7a: in `tail-only` the splice preserves the viewport position of the first previously-loaded row (a bounded drift, not an exact pixel — spliced rows carry estimated sizes until measured, so the anchor keeps correcting until measurement settles), and the selection compensator is NOT suppressed in this mode. Green 5.13–5.14a.
  - **Implemented and VERIFIED against the docker harness for the anchor invariant itself.** The anchor row holds its viewport position across a ~34000px splice, and the selection compensator is gated on `headFreeGapRef` so it stays active in `tail-only` only.
  - Correction runs in SCROLL SPACE (`virtualizer.measurementsCache[idx].start`), not against a DOM rect. Two DOM formulations were built and measured red first, and the reasons are recorded in the source docblock so neither is re-attempted: (a) `Δ scrollHeight` over-corrects by ~3200px because it absorbs below-viewport remeasurement; (b) the anchor row's `getBoundingClientRect()` corrects 0px because the splice unmounts that row before any correction runs. The row is re-located by `data-row-key` (the row's message id), added to the virtual row wrapper for this purpose.
  - **NOT yet green end-to-end**: F9's third sub-property ("scrolling up again produces a second request") depends on the loading head SURVIVING a drained gap, which is task 5.21's terminus row — unimplemented. With the current head-tail removal behaviour the divider disappears once the gap drains and the climb cannot converge. F10/F18 have not run to completion behind it. Re-run after 5.21.
- [ ] 5.16 Author `tests/e2e/tail-only-loading-head.spec.ts` — head-free gap with `remainingGapCount: 0` on the last response · response applied · the loading head becomes the terminus row and is NOT removed (test-plan #F11). Copy harness glue from `tests/e2e/max-replay-events-setting.spec.ts`.
- [ ] 5.17 Author in `tail-only-loading-head.spec.ts` — a two-sided gap with `remainingGapCount: 0` · response applied · the interstitial IS removed entirely (test-plan #F12).
- [ ] 5.18 Author in `tail-only-loading-head.spec.ts` — `tail-only` transcript scrolled down · activate scroll-to-top · the view top-aligns the loading head and does not claim the earliest message was reached (test-plan #F13).
- [ ] 5.19 Author in `tail-only-loading-head.spec.ts` — server refuses an automatically issued request · response carries an error code · the loading head offers an explicit retry, the trigger does not re-fire automatically, and no protocol code reaches the user (test-plan #X7).
- [ ] 5.20 Author in `tail-only-loading-head.spec.ts` — `tail-only` with 20 rows spliced · an automatic load completes · an `aria-live="polite"` region receives "20 earlier messages loaded" and document focus is unchanged across the splice (test-plan #F16).
- [ ] 5.20a Author in `tail-only-loading-head.spec.ts` — `head-tail` window, user clicks the explicit "Load earlier" affordance · response applied · NO new live-region announcement; the count announcement is scoped to automatic loads in `tail-only` so a non-opted-in user observes nothing new (test-plan #F21).
- [ ] 5.21 Implement the loading head, its terminus states, the retry fallback, and the `aria-live="polite"` announcement region in `HistoryGapDivider`, scoped to automatic loads in `tail-only`. Green 5.16–5.20a.
- [ ] 5.22 Rewrite the `HistoryGapDivider` docblock: "It is an interstitial, not a header" is exactly inverted in this mode and must state both shapes and which applies when.

## 6. Settings (D10)

- [x] 6.1 Author in `packages/client/src/components/settings/__tests__/settings-unit-i18n.test.tsx` — each of `en`, `zh-CN`, `hu` · resolve the mode label, option labels, and hint · every key resolves from its catalog and a deliberately missing key falls back to English, never a raw key id (test-plan #F17).
- [ ] 6.2 Author `tests/e2e/tail-only-settings.spec.ts` — settings panel with `maxReplayEvents: 0` · panel renders · the mode control indicates it has no effect until a positive window is set (test-plan #F14). Copy harness glue from `tests/e2e/max-replay-events-setting.spec.ts`.
- [ ] 6.3 Author in `tail-only-settings.spec.ts` — a config with all `memoryLimits` siblings set · change only `replayWindowMode` and save · the written config carries the new mode and every sibling unchanged (test-plan #F15).
- [x] 6.4 Add the control to Memory Limits in `SettingsPanel.tsx`, including the scope statement ("affects every client of this server"), the tradeoff statement, and the restart hint. Audit `computeConfigPartial`'s whole-object `memoryLimits` write. Green 6.2–6.3.
- [x] 6.5 Add label, option-label, and hint keys to `packages/client/src/lib/i18n/` for `en`, `zh-CN`, and `hu`. Green 6.1.

## 7. End-to-end and cross-cutting

- [ ] 7.1 Author in `tests/e2e/chat-render-perf.spec.ts` (or a sibling) — 20k-event session scrolled up continuously in `tail-only` vs `head-tail` · 5s scroll · no additional dropped frames vs the `head-tail` baseline (test-plan #P2).
- [ ] 7.2 Author in `tail-only-settings.spec.ts` — `maxReplayEvents: 100` with a smaller positive `maxEventsPerSession` · subscribe then attempt a load · the divider states the events cannot be loaded, names neither retention nor compaction, and is not styled or announced as an error (test-plan #X8).

## 8. Manual verification (deferred post-merge)

- [ ] 8.1 On a real device, judge whether a deliberate scroll-up feels responsive at `SETTLE_MS = 120` or dead; feed the answer to the keep-or-raise decision (test-plan: manual-only, #M1).
- [ ] 8.2 With VoiceOver and NVDA on the live dashboard, judge whether a programmatic load is distinguishable from a user-initiated one, and whether the terminus is announced once rather than on every scroll (test-plan: manual-only, #M2).
- [ ] 8.3 Open a large real session in `tail-only` and reproduce issue #521's three complaints: no stuck tool spinner at a splice seam, no scroll jump, loading proceeds from the tail end (test-plan: manual-only, #M3).

## 9. Verification gates

- [ ] 9.1 Run the full suite per the repo's piped-log procedure; confirm no `head-tail` regression, with particular attention to the three reset call sites.
- [ ] 9.2 Invoke `review-code` on the completed diff, and `performance-optimization` on the scroll path. Settle the keep-or-raise decision on `SETTLE_MS` here, using the results already produced by the two performance tasks and the on-device judgement task.
- [ ] 9.3 Invoke `security-hardening` only if the settings write path is touched beyond the additive field; otherwise record that it does not apply.

## 10. Documentation

- [ ] 10.1 Add or update rows in the nearest directory `AGENTS.md` for every touched file (`packages/shared/src/config.ts.AGENTS.md`, `packages/server/src/browser-handlers/`, `packages/client/src/lib/chat/`, `packages/client/src/components/chat/`, `packages/client/src/components/settings/`, plus each new `tests/e2e/*.spec.ts`), each carrying `See change: add-tail-only-replay-window`.
- [ ] 10.2 Delegate to `DocScribe`: `docs/architecture.md`'s replay/windowing section gains the mode, the head-free shape, the relocated reset guarantee, and the trigger's suppression model. Caveman style; the main agent applies the returned tree rows.
- [ ] 10.3 Run `kb dox lint` and clear any `stale`/`missing` rows this change introduced.
