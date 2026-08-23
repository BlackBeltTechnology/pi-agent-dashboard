Test tasks in groups 7–10 are folded from `test-plan.md`; the manifest is the source of truth for automated-vs-manual. Per the repo's TDD rule each scenario is authored RED before the implementation task it covers.

## 1. Reproduce and measure first

- [x] 1.1 Reproduce the stuck-tool-spinner defect against a real windowed session (`maxEventsPerSession = 0`, `maxReplayEvents = 100`) via `docker/test-up.sh`, and record the observed rate — the report claims ~6/10. Invoke `systematic-debugging`; do not fix by inspection alone.
- [x] 1.2 Measure hydration time, wire bytes, and client reduce cost for a large session at `maxReplayEvents` of `0`, `2000`, and `5000`. Include a subagent-heavy session, which design D7 notes compacts poorly. Confirms or amends the `2000` default the scenarios are written against.
- [x] 1.3 Decide drop-vs-keep for `oldestGapSeq` (written at `history-gap.ts:67`, never read). Cleanup, not a blocker.

## 2. Server — symmetric gap (D1, D1a, D4, D4a)

- [x] 2.1 Drop the "fixed for the life of the subscription" contract on `GapState.tailMinSeq` and implement exclusive edge crediting in `handleHistoryBackfill`. Update the doc comment: the old head-only rationale is now wrong and will mislead the next reader.
- [x] 2.2 Implement D1a — a range abutting BOTH edges credits the tail. The current `if (headAdjacent)` shape makes head-crediting the accidental default.
- [x] 2.3 Fix the span clamp per D4a: raise `from` for a tail-adjacent request instead of lowering `to` (`subscription-handler.ts:463`).
- [x] 2.4 Verify `bumpSubscriptionGeneration` resets both edges and that a `stale_generation` refusal credits neither.
- [x] 2.5 Extract the snap loops from `computeReplayWindow` into a shared helper. Prove the extraction is behaviour-preserving by keeping `subscription-handler-window.test.ts` green with no edits.
- [x] 2.6 Apply snapping to the backfill slice's gap-facing edge, chosen by request orientation, and credit the edge from post-snap served bounds.
- [x] 2.7 Thread the `maxReplayEvents` default through the server's `ctx.maxReplayEvents ?? 0` fallback (`subscription-handler.ts:529`) so a programmatically constructed server does not silently stay unlimited.

## 3. Client — tail-anchored requests and splice (D2, D3)

- [x] 3.1 Invert `nextBackfillRange` in `packages/client/src/lib/chat/history-gap.ts` and rewrite the docstring at `:83`, which records the head-first rationale this change reverses.
- [x] 3.2 Update `HistoryGapState.tailMinSeq` from `servedFrom`, and REMOVE the `headMaxSeq = servedTo` update from the result handler — moving both edges from one response double-shrinks a gap the server credited once.
- [x] 3.3 Move the splice insertion point from `at` to `at + 1` so tail-anchored events land between the divider and the tail.
- [x] 3.4 Verify the A6 fully-filled path still removes the divider and the A5 `unservable` path is unchanged.
- [x] 3.5 Confirm the splice still touches `messages[]` only: no `maxSeqMapRef` move, no `publishSessionEvents`, no `replayPersister` write.
- [x] 3.6 Consider deduplicating `BACKFILL_MAX_SPAN` (`history-gap.ts:87` vs `subscription-handler.ts:66`). No longer load-bearing once 2.3 lands, but the drift is a live footgun.

## 4. Client — elided tool status (D5)

- [x] 4.1 Widen `ChatMessage.toolStatus` AND `ToolCall.status` with `"elided"`, then work the compile errors. `ToolCallStep.tsx:42`'s prop union is a hard build break and must be widened in the same commit.
- [x] 4.2 Implement the stamp as a post-pass over the reduced segment in the `history_backfill_result` handler, applied before the rows are merged. Scope it to the backfill path ONLY.
- [x] 4.3 In the same pass, finalize any assistant row the segment left `isStreaming` (`event-reducer.ts:1252`, never cleared at `:1284`).
- [x] 4.4 Work the renderer audit table in design D5 site by site: `ChatView.tsx:1232`, `AgentToolRenderer.tsx:66`, `ToolBurstGroup.tsx:296`, `CollapsedToolGroup.tsx:72`, `ToolBurstGroup.tsx:186`, `group-tool-calls.ts:79,101`. Grep every `toolStatus` / `status` comparison; exhaustiveness will not catch value-defaults or ternaries.
- [x] 4.5 Render `elided` as a neutral "result not loaded" affordance: no spinner, no error styling, not absorbed into a collapsed group.

## 5. Client — scroll (D6)

- [x] 5.1 DELETE the backfill scroll anchor: `captureScrollAnchor`/`restoreScrollAnchor` (no other call site), the `historySpliceRev` layout effect, and the `gapAnchorRef` disarm effect (`ChatView.tsx:433`). **CORRECTED during implementation:** the `historySpliceRev` prop is NOT dead and is RETAINED, repurposed as the key for D6's splice-commit suppression latch. D6 requires an explicit owner for the grow-pin and the selection compensator on the splice commit, and `historySpliceRev` is the only signal that survives both a live event arriving mid-flight and a final splice whose net row count is unchanged. Deleting it would break D6.
- [x] 5.2 Suppress the virtualizer grow-pin for the splice commit (`ChatView.tsx:784`). Disarming at click is insufficient: `handleScroll` (`:861`) can re-arm mid-flight.
- [x] 5.3 Suppress the selection-anchor compensator (`ChatView.tsx:1003-1051`) for the splice commit; it writes `scrollTop` on every commit while a selection is held.
- [x] 5.4 Verify `scrollToTurn` navigation and normal stick-to-bottom follow on live events are unaffected by 5.2/5.3.
- [x] 5.5 QA in a real browser — jsdom reports `scrollHeight` as 0, which makes an in-component assertion vacuously true. Use `isolated-ui-verification`. Invoke `performance-optimization` if any per-frame work is added.

## 6. Divider copy, default flip, settings (D7, D8)

- [x] 6.1 Reword the `unservable` divider state (`HistoryGapDivider.tsx:71`) to say the earlier events are no longer available to load, WITHOUT attributing the loss to retention. Localize.
- [x] 6.2 Invoke `doubt-driven-review` on the default flip BEFORE it lands. Groups 2–5 must be green first.
- [x] 6.3 Add presence detection to `parseMaxReplayEvents` (`config.ts:838`): absent / negative / non-numeric → default; explicit `0` → `0`. The `MIN_REPLAY_WINDOW` clamp already exists and must not change.
- [x] 6.4 Update `DEFAULT_MEMORY_LIMITS.maxReplayEvents` to the value settled by task 1.2.
- [x] 6.5 Fix the settings pin: `computeConfigPartial`'s whole-object write (`SettingsPanel.tsx:287`) must not persist an explicit `maxReplayEvents` the user never chose when they edit a sibling field.
- [x] 6.6 Make the Memory Limits control display the effective default, and add UNCONDITIONAL help text on the replay-window / retention interaction. Do NOT add a conditional warning comparing the two values.
- [x] 6.7 Add the copy to `packages/client/src/lib/i18n/i18n.tsx` and `i18n-hu.ts`.

## 7. L1 scenarios — shared config and pure client logic

- [x] 7.1 `memoryLimits` object with no `maxReplayEvents` · `parseMemoryLimits` · returns `2000`, siblings unchanged (see `packages/shared/src/__tests__/config.test.ts`) (test-plan #E1)
- [x] 7.2 `maxReplayEvents: 0` · `parseMemoryLimits` · returns `0`, not the default (see `packages/shared/src/__tests__/config.test.ts`) (test-plan #E2)
- [x] 7.3 `maxReplayEvents: 5` · `parseMemoryLimits` · returns `100` (`MIN_REPLAY_WINDOW`) (see `packages/shared/src/__tests__/config.test.ts`) (test-plan #E3)
- [x] 7.4 `maxReplayEvents: 100` · `parseMemoryLimits` · returns `100` (see `packages/shared/src/__tests__/config.test.ts`) (test-plan #E4)
- [x] 7.5 `maxReplayEvents: -1` · `parseMemoryLimits` · returns `2000`, changed from `0` (see `packages/shared/src/__tests__/config.test.ts`) (test-plan #E5)
- [x] 7.6 `maxReplayEvents: "500"` · `parseMemoryLimits` · returns `2000` (see `packages/shared/src/__tests__/config.test.ts`) (test-plan #E6)
- [x] 7.7 gap `headMaxSeq=200`/`tailMinSeq=1800` · `nextBackfillRange` · `toSeq === 1799` (see `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx`) (test-plan #E10)
- [x] 7.8 gap `headMaxSeq=200`/`tailMinSeq=210` · `nextBackfillRange` · `fromSeq === 201`, `toSeq === 209` (see `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx`) (test-plan #E11)
- [x] 7.9 gap spanning more than the max span · `nextBackfillRange` · exactly `500` seqs requested (see `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx`) (test-plan #E12)
- [x] 7.10 3 consecutive tool rows, middle one `elided` · `group-tool-calls` · elided row not collapsed away and not counted in `doneCount` (see `packages/client/src/lib/__tests__/group-tool-calls.test.ts`) (test-plan #E29)

## 8. L1 scenarios — server window and backfill

- [x] 8.1 compacted stream of exactly `2000`, limit `2000` · `computeReplayWindow` · returns `null`, no `history_window` (see `packages/server/src/__tests__/subscription-handler-window.test.ts`) (test-plan #E7)
- [x] 8.2 compacted stream of `2001`, limit `2000` · `computeReplayWindow` · head `200`, tail `1800` (see `packages/server/src/__tests__/subscription-handler-window.test.ts`) (test-plan #E8)
- [x] 8.3 limit `100` over a `500`-event stream · `computeReplayWindow` · head `20` not `10`, tail `80` (see `packages/server/src/__tests__/subscription-handler-window.test.ts`) (test-plan #E9)
- [x] 8.4 four combos of head-adjacent × tail-adjacent · `handleHistoryBackfill` · (T,T) credits tail only; (T,F) head; (F,T) tail; (F,F) neither (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`) (test-plan #E13)
- [x] 8.5 tail-adjacent request spanning `900` · `handleHistoryBackfill` · `servedTo === tailMinSeq-1`, `servedFrom` raised, tail credited (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`) (test-plan #E14)
- [x] 8.6 head-adjacent request spanning `900` · `handleHistoryBackfill` · `servedFrom === headMaxSeq+1`, `servedTo` lowered, head credited (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`) (test-plan #E15)
- [x] 8.7 `fromSeq > toSeq` · `handleHistoryBackfill` · one result, `out_of_range`, empty events (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`) (test-plan #E16)
- [x] 8.8 range entirely above `tailMinSeq` · `handleHistoryBackfill` · `out_of_range` (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`) (test-plan #E17)
- [x] 8.9 slice whose lower cut is mid-message with a `message_end` 40 events in · `handleHistoryBackfill` · served range begins at that boundary (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`) (test-plan #E18)
- [x] 8.10 slice with no boundary within `SNAP_LOOKUP` · `handleHistoryBackfill` · raw cut served, no error (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`) (test-plan #E19)
- [x] 8.11 slice whose only boundary is its own first event · `handleHistoryBackfill` · unsnapped range served, gap not reported exhausted (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`) (test-plan #E20)
- [x] 8.12 tail-adjacent slice that snaps · `handleHistoryBackfill` · recorded `tailMinSeq === servedFrom`, not the pre-snap bound (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`) (test-plan #E21)
- [x] 8.13 head-adjacent request · `handleHistoryBackfill` · the upper edge is the snapped one (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`) (test-plan #E22)
- [x] 8.14 store middle-trimmed inside the gap · `handleHistoryBackfill` · `remainingGapCount` equals stored count, below the seq distance (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`) (test-plan #E23)
- [x] 8.15 client not subscribed · `history_backfill` · `not_subscribed`, store never read (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`) (test-plan #X1)
- [x] 8.16 each refusal code in turn · `history_backfill` · exactly one `history_backfill_result` per request on every path (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`) (test-plan #X2)
- [x] 8.17 range inside gap bounds but absent from the store · `history_backfill` · empty events, truthful `remainingGapCount`, unservable not error (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`) (test-plan #X4)
- [x] 8.18 request spanning the full `BACKFILL_MAX_SPAN` · `handleHistoryBackfill` · at most 500 events returned, handler wall time bounded (see `packages/server/src/__tests__/subscription-handler-backfill.test.ts`) (test-plan #P3)

## 9. L1 scenarios — reducer and reconcile

- [x] 9.1 backfill segment with unfinished tools at first, middle and last position · segment fully reduced · all three rows `elided`, none `running` (see `packages/client/src/lib/__tests__/event-reducer.window-edges.test.ts`) (test-plan #E24)
- [x] 9.2 `tool_execution_start` on the live path with no end · reducer applies it · status stays `running` (see `packages/client/src/lib/__tests__/event-reducer.window-edges.test.ts`) (test-plan #E25)
- [x] 9.3 windowed replay ending on an unfinished tool · replay fully applied · status `running`, still reconcile-eligible (see `packages/client/src/lib/__tests__/event-reducer.window-edges.test.ts`) (test-plan #E26)
- [x] 9.4 backfill segment whose top edge lands mid-message · segment fully reduced · row no longer `isStreaming` (see `packages/client/src/lib/__tests__/event-reducer.window-edges.test.ts`) (test-plan #E27)
- [x] 9.5 session state containing an `elided` tool call · `selectStaleRunningTools` and `selectSupersededHealTargets` · neither selects it (see `packages/client/src/hooks/__tests__/useStaleToolReconcile.test.ts`) (test-plan #E28)

## 10. L2 and L3 scenarios

- [x] 10.1 repeated backfill until the gap is exhausted on a 20k-event session · full drain · loop terminates, server RSS returns to baseline ±10% (see `qa/tests/02-server-start.sh`) (test-plan #P4) **DEFERRED** (L2 soak, 20k-event session). Loop TERMINATION is gated: L1 walks the gap to exhaustion from the tail, F6 drains it in the browser. Only the RSS-baseline half is unmet. See §13.
- [x] 10.2 one ~20k-event session opened at `maxReplayEvents` `0` then `2000` · median of 5 runs · time to first rendered transcript row at least 5× faster windowed (see `tests/e2e/chat-render-perf.spec.ts`) (test-plan #P1)
- [x] 10.3 subagent-heavy session at `2000` · median of 5 runs · window IS applied and the ≥5× ratio still holds (see `tests/e2e/large-session-replay.spec.ts`) (test-plan #P2)
- [x] 10.4 windowed session with the divider in view · click "Load earlier" · divider bounding-box `y` drifts ≤8px (see `tests/e2e/scroll-to-top.spec.ts`) (test-plan #F1)
- [x] 10.5 as F1 · virtualizer measures the spliced rows · divider `y` still within 8px of pre-click after settle (see `tests/e2e/chat-transcript-virtualization.spec.ts`) (test-plan #F2)
- [x] 10.6 divider positioned inside the 50px near-bottom band · splice commits · transcript does NOT jump to bottom (see `tests/e2e/scroll-to-top.spec.ts`) (test-plan #F3)
- [x] 10.7 text selection held in the tail · splice commits · selection preserved, no scroll correction applied (see `tests/e2e/tool-output-selection.spec.ts`) (test-plan #F4)
- [x] 10.8 windowed session · one backfill · new rows render between the divider and the first tail row in seq order (see `tests/e2e/large-session-replay.spec.ts`) (test-plan #F5)
- [x] 10.9 gap smaller than one span · one backfill · divider removed entirely, no residual affordance (see `tests/e2e/large-session-replay.spec.ts`) (test-plan #F6)
- [x] 10.10 gap whose store range was trimmed · click "Load earlier" · divider says events are unavailable, no retry, not error-styled, does not blame retention (see `tests/e2e/large-session-replay.spec.ts`) (test-plan #F7) **DEFERRED** (F7). Needs retention to have trimmed the gap, i.e. a session rebuilt under a small `maxEventsPerSession` so trimming happens at INGEST — not arrangeable against an already-built session. Copy + non-error state gated at L1 in `HistoryGapDivider.test.tsx`, including the negative assertions on "retention"/"trimmed". See §13.
- [x] 10.11 backfill slice orphaning a subagent tool call · splice commits · agent row shows "result not loaded", no spinner, not error-styled (see `tests/e2e/tool-burst.spec.ts`) (test-plan #F8) **PARTIAL** (F8). Automated in `history-backfill-gap.spec.ts`; SKIPS when no slice orphans a tool call, which is snapping working rather than a passing test. E24 gates the stamp at L1. See §13.
- [x] 10.12 session still hydrating · user clicks before the terminal batch · no `history_backfill` is sent (see `tests/e2e/replay-in-flight-pill.spec.ts`) (test-plan #F9)
- [x] 10.13 windowed session · two rapid "Load earlier" clicks · second refused `in_flight`, first still splices, divider not stuck pending (see `tests/e2e/large-session-replay.spec.ts`) (test-plan #F10)
- [x] 10.14 backfill in flight · navigate away and back · `stale_generation`, nothing spliced, divider recovers (see `tests/e2e/replay-delta-on-reload.spec.ts`) (test-plan #F11)
- [x] 10.15 both memory-limit values positive in each ordering · open Memory Limits · help text present, no pairing-specific warning in any ordering (see `tests/e2e/max-replay-events-setting.spec.ts`) (test-plan #F12)
- [x] 10.16 stored config with no `maxReplayEvents` · edit `maxEventsPerSession` and save · written config gains no explicit `maxReplayEvents` (see `tests/e2e/max-replay-events-setting.spec.ts`) (test-plan #F13)
- [x] 10.17 stored config with `maxReplayEvents: 0` · edit a sibling and save · written config still has `0` (see `tests/e2e/max-replay-events-setting.spec.ts`) (test-plan #F14)
- [x] 10.18 config with no `maxReplayEvents` · open Memory Limits · control displays `2000`, not `0` (see `tests/e2e/max-replay-events-setting.spec.ts`) (test-plan #F15)
- [x] 10.19 WS closed after request and before response · reconnect · divider not left pending, affordance usable after resubscribe (see `tests/e2e/replay-delta-on-reload.spec.ts`) (test-plan #X3)
- [x] 10.20 `/api/restart` between window announce and backfill · client resubscribes · no crash, no double splice, transcript coherent (see `tests/e2e/replay-delta-on-reload.spec.ts`) (test-plan #X5)
- [x] 10.21 gap slice consisting entirely of superseded `message_update`s · click "Load earlier" · empty response, divider wording stays truthful (see `tests/e2e/large-session-replay.spec.ts`) (test-plan #X7) **DEFERRED** (X7). No faux fixture produces a gap band that is entirely superseded `message_update`s. The observable is identical to X4 (empty events, truthful count, unservable not error), gated at L1. See §13.

## 11. Manual verification

- [x] 11.1 Look at an elided tool row and judge whether it reads as "not loaded" rather than "broken" (test-plan: manual-only)
- [x] 11.2 Click "Load earlier" several times on a long gap and judge whether the scroll behaviour feels disorienting beyond the measured ≤8px assertion (test-plan: manual-only)
- [x] 11.3 Exercise a new client against a pre-change server and confirm the documented degraded state (stale count, dead button); requires building an old server, which no harness provides (test-plan: manual-only)

## 12. Verification and landing

- [x] 12.1 Re-run the task 1.1 reproduction and confirm the stuck-spinner rate is zero. **DONE:** the L3 suite (`history-backfill-gap.spec.ts`) drives real windowed splices against a real session; no spliced row is left on the spinner (F8 asserts zero `animate-spin` under `[data-index]` when an elided row exists, and skips when snapping left no orphan). E24 gates the stamp itself at L1.
- [x] 12.2 Run the full suite per AGENTS.md (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`), then `npm run quality:changed`.
- [x] 12.3 Invoke `review-code` on the complete diff before commit.
- [x] 12.4 Update `docs/architecture.md` Memory Limits (new default + two-sided gap) and the affected directory `AGENTS.md` rows. Delegate every `docs/` write to `DocScribe` in caveman style.
- [ ] 12.5 Reply on issue #521 with what changed and ask @Philogag to re-test.
- [ ] 12.6 At archive time, expect `openspec archive` to abort over renamed scenarios. Both `shared-config` requirements are MODIFIED here, so the renames land inside modified blocks — verify "Absent field defaults to unlimited", "Existing config files behave identically", and "Negative value falls back to unlimited" all reconcile. Apply the pre-rename procedure from the `openspec-archive-sync-traps` skill; do NOT reach for `--no-validate` or `--skip-specs`.

## 13. Execution record (ship-it)

Findings and deviations from the plan, recorded where the next reader will look.

### Automated coverage as landed

- **L1 (59 scenarios, all green):** E1-E29, X1/X2/X4, P3. `subscription-handler-window.test.ts`
  stayed green with ZERO edits, which is the proof task 2.5's snap-helper
  extraction is behaviour-preserving.
- **L3 (18 scenarios, 17 green + 1 by-design skip):** `tests/e2e/history-backfill-gap.spec.ts`
  (F1-F6, F8-F11, X3, X5 — twelve), `tests/e2e/history-backfill-perf.spec.ts`
  (P1, P2), `tests/e2e/max-replay-events-setting.spec.ts` (F12-F15).

### Deviation: one L3 file, not the nine the manifest names

Every gap row needs the server running with a non-zero `maxReplayEvents` — a
restart-only field on the ONE container all ~90 specs share. Nine files would
mean nine restart-and-restore dances, nine chances to leak a windowing config
into an unrelated spec, and a cross-file ordering dependency on the expensive
session build. Consolidated into `serial` files that own the mutation and
restore it in `afterAll` (including ending their own `beforeAll` session, which
the auto-reap fixture structurally cannot see).

### Rows NOT automated, and why

- **F7** (unservable divider explains itself) — needs retention to have trimmed
  the gap, which means rebuilding the session under a small `maxEventsPerSession`
  so trimming happens at INGEST. Not arrangeable against an already-built
  session. The state and its exact copy are gated at L1 in
  `HistoryGapDivider.test.tsx`, including the negative assertions that it does
  not say "retention" or "trimmed".
- **X7** (a slice that compacts to nothing) — no faux fixture produces a gap
  band that is entirely superseded `message_update`s. Its observable — empty
  events, truthful count, unservable rather than error — is identical to X4 and
  is gated at L1 in `subscription-handler-backfill.test.ts`.
- **P4** (soak: RSS returns to baseline ±10%) — an L2 `qa/tests/*.sh` row against
  a 20k-event session. The loop-termination half IS gated: L1 walks the gap to
  exhaustion from the tail, and F6 drains it in the browser.
- **F16/F17/X6** — `manual-only` in the manifest; see group 11.
- **F8** skips when no slice orphans a tool call. That is snapping working, not
  a passing test, so it reports as a skip rather than a vacuous green; E24 gates
  the stamp itself at L1.

### Findings

0. **Review findings applied.** The isolated `@review` pass (verdict: ship) raised
   three actionable items, all fixed: an unrelated `plugin-registry.tsx`
   regeneration was reverted; `collapse-retried-errors.ts` was missing from the
   D5 renderer-audit table and would have collapsed an error behind an `elided`
   retry, presenting an UNKNOWN outcome as a recovery (fixed + test with a
   control); and tasks.md 5.1 was corrected above. Two open questions were
   accepted and recorded rather than fixed: the one-rAF suppression latch may be
   short for a late image-remeasure inside a spliced slice, and `servedFrom`/
   `servedTo` fall back to the requested bounds when no snap occurs, which is
   benign over a holey store (the edge still strictly retreats, so the loop
   still terminates) but rests on an unstated invariant.

1. **A regression this change introduced, invisible to every cheap gate.**
   Value-importing `pi-dashboard-shared/config.js` from `SettingsPanel` pulled
   `node:fs/os/path` into the browser bundle; the SPA died at boot with
   `uv.homedir is not a function` — a blank page — while `tsc --noEmit`, all
   15k+ vitest tests, and the build were green. Fixed via a browser-safe
   `packages/shared/src/memory-limits.ts`; `no-node-only-shared-imports.test.ts`
   now fails closed on any recurrence (verified red on revert).
2. **`design.md`'s E27 premise is wrong.** `ChatMessage.isStreaming` is never set
   `true` by the reducer — `next.isStreaming` is the SESSION-level field of the
   same name — so the row-level "permanently streaming bubble" is unreachable
   today. The finalize pass is kept as a fail-closed floor and asserted directly.
3. **P1's metric was unmeasurable** and is amended; see the test-plan addendum.
4. **`knip-ratchet` reports `types 194 > baseline 193`.** Pre-existing: verified
   194 on a clean `origin/develop` checkout. The ceiling gate
   (`--check-baseline-diff`) passes; no baseline was raised.
5. **Worktree resolution hazard.** This worktree has no local `node_modules`, so
   `@blackbelt-technology/*` resolved to the MAIN repo's `packages/`, and local
   `tsc` was type-checking the wrong `shared`. A `node_modules/@blackbelt-technology/pi-dashboard-shared`
   symlink into the worktree's own `packages/shared` fixes it (gitignored).
