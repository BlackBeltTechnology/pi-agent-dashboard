## 1. Shared config + protocol types

- [x] 1.1 Add `maxReplayEvents: number` to `MemoryLimitsConfig` in `packages/shared/src/config.ts`, default `0` in `DEFAULT_MEMORY_LIMITS`
- [x] 1.2 Extend `parseMemoryLimits` — absent/non-numeric/negative parse to `0`; positive values below `MIN_WINDOW` (100) clamp up to `MIN_WINDOW`; `0` is preserved and never clamped
- [x] 1.3 Thread `maxReplayEvents` through `packages/server/src/cli.ts` and `packages/server/src/server.ts` to the browser gateway
- [x] 1.4 Add `SessionHistoryWindowMessage` (`history_window`) to `packages/shared/src/browser-protocol.ts` and to the server→browser union
- [x] 1.5 Add `HistoryBackfillRequestMessage` (`history_backfill`) to the browser→server union
- [x] 1.6 Add `HistoryBackfillResultMessage` (`history_backfill_result`), including the `error` enum `not_subscribed | in_flight | out_of_range | stale_generation`, to the server→browser union

## 2. Event store range read

- [x] 2.1 Add `getEventsRange(sessionId, minSeq, maxSeq): StoredEvent[]` to the `EventStore` interface in `packages/server/src/persistence/memory-event-store.ts`
- [x] 2.2 Implement it with binary search for both bounds over the seq-sorted buffer plus one slice — not a linear filter (design D8)

## 3. Compaction boundary parameter

- [x] 3.1 Extend `compactEventsForReplay` in `packages/server/src/session/replay-compaction.ts` to accept an optional caller-supplied supersession boundary, defaulting to today's array-relative `lastMessageEndIdx` when omitted
- [x] 3.2 Preserve both existing exemptions (thinking updates, last text-bearing update before each `tool_execution_start`) under an externally supplied boundary

## 4. Server-side windowing

- [x] 4.1 Add optional `windowLimit?: number` parameter to `sendEventBatches` in `packages/server/src/browser-handlers/subscription-handler.ts`
- [x] 4.2 Delete the three duplicated `MAX_REPLAY_EVENTS` slices at the `:242`, `:260`, `:346` call sites and the module constant
- [x] 4.3 Implement the window inside `sendEventBatches` AFTER `compactEventsForReplay`, keeping `preCompactionMaxSeq` derived from the full input array (design D2 — this is the D4 contract)
- [x] 4.4 Implement the fits-entirely short-circuit: when `compacted.length <= windowLimit`, deliver everything and report `gapCount` of `0` (design D3)
- [x] 4.5 Implement the head/tail split with `HEAD_RATIO` 0.1, `HEAD_MIN` 20, `HEAD_CAP` 200
- [x] 4.6 Implement tail forward-snap and head backward-snap, both bounded by `SNAP_LOOKUP` 200, both shrinking the window so the budget stays a hard cap (design D4)
- [x] 4.7 Pass `windowLimit` only on full-stream paths: `:242` always, `:260` only when `lastSeq === 0`, `:346` always — never on a genuine delta (design D1)
- [x] 4.8 Emit `history_window` per subscriber before the first `event_replay` on full-stream paths only, with `gapCount` counting gap events the store actually holds, never the seq distance
- [x] 4.9 Send `session_state_reset` before a windowed replay on the `lastSeq === 0` path (design D5)

## 5. Server-side backfill handler

- [x] 5.1 Add a subscription generation counter per (socket, session), incremented on every subscribe
- [x] 5.2 Handle `history_backfill` in `subscription-handler.ts`: clamp span to `BACKFILL_MAX_SPAN` 500, clamp the range into the gap and the store's available range
- [x] 5.3 Serve the range via `getEventsRange`, apply `truncateToolResultForReplay`, and compact with the full-stream supersession boundary (design D7)
- [x] 5.4 Enforce single-flight per (socket, session); refuse a concurrent request with `error: "in_flight"`
- [x] 5.5 Refuse an unsubscribed session with `error: "not_subscribed"` without reading the store
- [x] 5.6 Refuse a stale-generation completion with `error: "stale_generation"` rather than dropping the response (design D9)
- [x] 5.7 Guarantee exactly one `history_backfill_result` per request on every path, including refusals
- [x] 5.8 Route the new message types in `packages/server/src/pairing/browser-gateway.ts`, leaving `clearReplaying` catch-up untouched

## 6. Client protocol handling

- [x] 6.1 Handle `history_window` in `packages/client/src/hooks/useMessageHandler.ts`, storing per-session gap state (`headMaxSeq`, `tailMinSeq`, `gapCount`, `oldestGapSeq`)
- [x] 6.2 Handle `history_backfill_result`: splice events into the gap by seq order, never prepend and never reset
- [x] 6.3 Ensure the splice does NOT move `maxSeqMapRef`, does NOT call `publishSessionEvents`, and does NOT write to `replayPersister` (design D10)
- [x] 6.4 Suppress the `replayPersister` write for any session whose replay carried a non-zero `gapCount` (design D12)
- [x] 6.5 Clear pending backfill state on `session_state_reset` and on re-subscribe
- [x] 6.6 Send `history_backfill` only after the session's initial replay has terminated with `isLast: true` (design D11)

## 7. Client gap UI

- [x] 7.1 Render the gap divider between the head and tail segments when `gapCount > 0`, with a click-to-load pill — follow `mockups/gap-divider.html` + `mockups/ui-plan.md` (states A1-A6, exact tokens); copy is "N earlier messages" / "Load earlier"
- [x] 7.2 On click, request the range adjacent to the head, bounded by `BACKFILL_MAX_SPAN`
- [x] 7.3 Capture `scrollHeight` before the splice and restore the delta after paint, composing with `chat-scroll-lock`
- [x] 7.4 Stop offering the affordance when a response returns zero events or `remainingGapCount` of `0`; render state A5 ("Earlier messages are no longer available.") when the gap existed but is unservable, and remove the divider entirely (A6) when it was fully filled
- [x] 7.6 Map every backfill `error` code to the single plain-language A4 line plus a retry — never surface a protocol code to the user
- [x] 7.5 Show a local pending state on the divider, deliberately NOT the `chat-history-loading-indicator` replay-in-flight flag

## 8. Settings UI

- [x] 8.1 Add the `maxReplayEvents` numeric control to the Memory Limits section of `packages/client/src/components/settings/SettingsPanel.tsx`
- [x] 8.2 Add i18n keys `session.maxReplayEvents` and `settings.hint.maxReplayEvents` for en/hu/zh with English fallbacks, using the copy in `mockups/ui-plan.md` section B
- [x] 8.3 Add i18n keys for the divider states (count, load, loading, error, unavailable) with English fallbacks; the count string must support singular and plural

## 9. Tests — config (L1)

- [x] 9.1 Absent field defaults to unlimited: `memoryLimits` with no `maxReplayEvents` · `parseMemoryLimits(raw)` · returns `0` with the other three fields unchanged — see `packages/shared/src/__tests__/config.test.ts` (test-plan #E1)
- [x] 9.2 Just below minimum clamps: `maxReplayEvents: 99` · `parseMemoryLimits` · returns `100` — see `packages/shared/src/__tests__/config.test.ts` (test-plan #E2)
- [x] 9.3 At minimum is unclamped: `maxReplayEvents: 100` · `parseMemoryLimits` · returns `100` — see `packages/shared/src/__tests__/config.test.ts` (test-plan #E3)
- [x] 9.4 Just above minimum passes through: `maxReplayEvents: 101` · `parseMemoryLimits` · returns `101` — see `packages/shared/src/__tests__/config.test.ts` (test-plan #E4)
- [x] 9.5 Zero preserved not clamped: `maxReplayEvents: 0` · `parseMemoryLimits` · returns `0`, not `100` — see `packages/shared/src/__tests__/config.test.ts` (test-plan #E5)
- [x] 9.6 Negative parses to unlimited: `maxReplayEvents: -1` · `parseMemoryLimits` · returns `0` — see `packages/shared/src/__tests__/config.test.ts` (test-plan #E6)
- [x] 9.7 Non-numeric falls back: `maxReplayEvents: "500"` · `parseMemoryLimits` · returns `0` — see `packages/shared/src/__tests__/config.test.ts` (test-plan #E7)

## 10. Tests — windowing (L1)

- [x] 10.1 Fits-entirely boundary: 500 compacted events with `windowLimit=500` · `sendEventBatches` · all 500 delivered once each, `gapCount` 0 — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #E8)
- [x] 10.2 Window fires at limit+1: 501 compacted events with `windowLimit=500` · `sendEventBatches` · delivered count ≤ 500, `gapCount` 1 — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #E9)
- [x] 10.3 No overlap on a small session: 40 events with `windowLimit=1000` · `sendEventBatches` · 40 delivered, zero duplicate seqs, `gapCount` never negative — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #E10)
- [x] 10.4 Head floor at MIN_WINDOW: 5000 events with `windowLimit=100` · window computed · head 20 not 10, tail 80 — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #E11)
- [x] 10.5 Nominal split: 5000 events with `windowLimit=500` · window computed · head 50, tail 450 — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #E12)
- [x] 10.6 Head cap: 50000 events with `windowLimit=5000` · window computed · head 200, tail 4800 — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #E13)
- [x] 10.7 Content-keyed windowing: warm session subscribed with `lastSeq=0`, `maxReplayEvents=500` · `handleSubscribe` · window applied even though the delta branch serves it — see `packages/server/src/__tests__/subscription-handler-backfill.test.ts` (test-plan #E14)
- [x] 10.8 Delta never windowed: warm session of 5000 subscribed with `lastSeq=900`, `maxReplayEvents=500` · `handleSubscribe` · all 4100 delivered, no seq gap after `lastSeq`, no `history_window` — see `packages/server/src/__tests__/subscription-handler-backfill.test.ts` (test-plan #E15)
- [x] 10.9 Windowing disabled: 50000 events with `maxReplayEvents=0` · subscribe `lastSeq=0` · all 50000 delivered, no non-zero `gapCount` — see `packages/server/src/__tests__/subscription-handler-backfill.test.ts` (test-plan #E16)
- [x] 10.10 High-water mark survives an elided top: array whose highest-seq event is a superseded `message_update` · `sendEventBatches` with a window eliding the top · return equals input max seq and `getEvents(ret+1)` is empty — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #E17)
- [x] 10.11 Tail snaps forward: cut lands mid-message with a `message_start` 12 events later · window computed · first tail event is that `message_start`, count ≤ limit — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #E18)
- [x] 10.12 Snap never exceeds budget: `windowLimit=500` with boundaries forcing maximal snapping · window computed · delivered count ≤ 500 — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #E19)
- [x] 10.13 Snap lookup is bounded: no boundary within `SNAP_LOOKUP` 200 of the cut · window computed · exact cut index used, no unbounded scan — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #E20)
- [x] 10.14 Head trailing snap: head cut lands after a `message_start` with no `message_end` · window computed · head ends on a completed `message_end` — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #E21)
- [x] 10.15 gapCount excludes trimmed events: store holding seqs 1–5000 and 18000–20000 · window computed · `gapCount` equals held gap events and is less than `tailMinSeq - headMaxSeq - 1` — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #E22)

## 11. Tests — compaction (L1)

- [x] 11.1 Omitted boundary is unchanged: any array with no explicit boundary · `compactEventsForReplay(arr)` · output identical to the pre-change implementation — see `packages/server/src/__tests__/replay-compaction.test.ts` (test-plan #E23)
- [x] 11.2 External boundary supersedes the slice: middle slice plus a boundary indicating a later `message_end` outside it · `compactEventsForReplay(slice, boundary)` · every non-exempt `message_update` dropped — see `packages/server/src/__tests__/replay-compaction.test.ts` (test-plan #E24)
- [x] 11.3 Exemptions hold under an external boundary: slice containing a thinking update and a text update before `tool_execution_start` · compaction with boundary · both retained — see `packages/server/src/__tests__/replay-compaction.test.ts` (test-plan #E25)
- [x] 11.4 Window applied after compaction: 20000 stored compacting to 1000 with `windowLimit=500` · `sendEventBatches` · every delivered event is a post-compaction survivor, count ≤ 500 — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #E26)

## 12. Tests — backfill + store (L1)

- [x] 12.1 Span clamp: request span 501 · backfill handler · ≤ 500 events served with no error code — see `packages/server/src/__tests__/subscription-handler-backfill.test.ts` (test-plan #E27)
- [x] 12.2 Span at max: request span exactly 500 · handler · up to 500 served, no error — see `packages/server/src/__tests__/subscription-handler-backfill.test.ts` (test-plan #E28)
- [x] 12.3 Range outside the gap: non-intersecting range · handler · `error: "out_of_range"` with empty events — see `packages/server/src/__tests__/subscription-handler-backfill.test.ts` (test-plan #E29)
- [x] 12.4 Inverted range: `fromSeq > toSeq` · handler · `error: "out_of_range"` with empty events — see `packages/server/src/__tests__/subscription-handler-backfill.test.ts` (test-plan #E30)
- [x] 12.5 Events strictly inside the gap: valid in-gap range · handler · every returned seq above `headMaxSeq` and below `tailMinSeq` — see `packages/server/src/__tests__/subscription-handler-backfill.test.ts` (test-plan #E31)
- [x] 12.6 Bounded range read: buffer of 20000 with request `[5000, 5100]` · `getEventsRange` · exactly the 101 in-range events ascending, none outside — see `packages/server/src/__tests__/memory-event-store.test.ts` (test-plan #E32)
- [x] 12.7 Range read is sub-linear: buffer of 20000 with a narrow range · `getEventsRange` · probe count consistent with binary search, not a full 20000 scan — see `packages/server/src/__tests__/memory-event-store.test.ts` (test-plan #E33)

## 13. Tests — bounded delivery (L1, perf)

- [x] 13.1 Delivered count bounded: seeded session of 50000 stored events with `maxReplayEvents=500` · one subscribe · delivered event count ≤ 500 — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #P1)
- [x] 13.2 Wire bytes bounded: same seeded session windowed vs unwindowed · one subscribe · serialized `event_replay` payload bytes reduced by at least 90% versus `maxReplayEvents=0` — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #P2)
- [x] 13.3 Backfill response bounded: one `history_backfill` at max span · one request · serialized response within the per-event ceiling times 500 — see `packages/server/src/__tests__/subscription-handler-backfill.test.ts` (test-plan #P3)

## 14. Tests — reducer tolerance (L1)

- [x] 14.1 Orphan `message_end`: segment beginning with `message_end` and no `message_start` · `reduceEvent` fold · returns a state without throwing — see `packages/client/src/lib/__tests__/event-reducer.window-edges.test.ts` (test-plan #F1)
- [x] 14.2 Orphan `tool_execution_end`: segment beginning with `tool_execution_end` and no start · `reduceEvent` fold · returns a state without throwing — see `packages/client/src/lib/__tests__/event-reducer.window-edges.test.ts` (test-plan #F2)
- [x] 14.3 In-stream seq discontinuity: head seqs 1–20 then tail seqs 4800–5000 in one replay · reducer fold over the batches · one coherent state, no reset fired on the tail batch — see `packages/client/src/lib/__tests__/event-reducer.window-edges.test.ts` (test-plan #F3)

## 15. Tests — error handling (L1)

- [x] 15.1 Unsubscribed session: socket not subscribed · `history_backfill` for it · one response with `error: "not_subscribed"`, empty events, and no store read — see `packages/server/src/__tests__/subscription-handler-backfill.test.ts` (test-plan #X1)
- [x] 15.2 Concurrent request: first still in flight · second request for the same session · second gets `error: "in_flight"` and the first still receives its own response — see `packages/server/src/__tests__/subscription-handler-backfill.test.ts` (test-plan #X2)
- [x] 15.3 Stale generation: unsubscribe and re-subscribe while a backfill is in flight · response completes after re-subscribe · one response with `error: "stale_generation"`, nothing spliced — see `packages/server/src/__tests__/subscription-handler-backfill.test.ts` (test-plan #X3)
- [x] 15.4 Exactly one response: each refusal path in turn · request issued · exactly one `history_backfill_result` per request, never zero and never two — see `packages/server/src/__tests__/subscription-handler-backfill.test.ts` (test-plan #X4)
- [x] 15.5 Store hole: requested range lies in an already-trimmed region · request · zero events with a truthful `remainingGapCount` so the client stop rule terminates — see `packages/server/src/__tests__/memory-event-store.test.ts` (test-plan #X5)
- [x] 15.6 No disk read: session file made unreadable · backfill served · request succeeds from the store with no session-file read attempted — see `packages/server/src/__tests__/subscription-handler-backfill.test.ts` (test-plan #X6)
- [x] 15.7 Catch-up after a windowed replay: window elides the top of the input · `clearReplaying` runs with the returned seq · catch-up query returns empty, nothing re-sent — see `packages/server/src/__tests__/subscription-handler-window.test.ts` (test-plan #X7)

## 16. Tests — rendered UI

> **Level deviation (agreed with the user during ship-it).** F4–F11 were
> catalogued L3 but are covered at jsdom level in
> `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx`
> and `packages/client/src/components/chat/__tests__/HistoryGapDivider.test.tsx`.
> Reason: windowing only fires when the SERVER runs with a non-zero
> `maxReplayEvents`, which is a restart-only field on the docker harness every
> other e2e spec shares; and `history_window` / `history_backfill_result` arrive
> over the WebSocket, which `page.route()` cannot intercept. F12/F13 stay L3 in
> `tests/e2e/max-replay-events-setting.spec.ts`.

- [x] 16.1 Explicit reset precedes a window: session A viewed then re-subscribed with `lastSeq=0` and a window · subscribe · transcript contains no rows from the prior subscription — see `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx` (test-plan #F4)
- [x] 16.2 Gap divider renders: windowed session with `gapCount=1200` · session opened · a divider between head and tail reports 1200 earlier events — see `packages/client/src/components/chat/__tests__/HistoryGapDivider.test.tsx` + `useMessageHandler.history-gap.test.tsx` (test-plan #F5)
- [x] 16.3 Click-to-load splices: windowed session showing a divider · user clicks the load button · earlier rows appear between head and tail with both still present — see `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx` (test-plan #F6)
- [x] 16.4 Splice preserves the scroll anchor: windowed session scrolled to the divider · click load and wait for the splice · the row under the viewport top is at the same visual position after — see `packages/client/src/components/chat/__tests__/HistoryGapDivider.test.tsx` (test-plan #F7)
- [x] 16.5 Splice does not reset the transcript: windowed session with tail rows rendered · click load · tail rows retain identity and the transcript is not rebuilt — see `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx` (test-plan #F8)
- [x] 16.6 Exhausted gap removes the affordance: gap fully backfilled with `remainingGapCount=0` · final splice · divider and button no longer offered — see `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx` (test-plan #F9)
- [x] 16.7 No backfill before replay completes: session mid-hydration · user attempts to load earlier · no `history_backfill` sent before the terminal batch — see `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx` (test-plan #F10)
- [x] 16.8 Windowed replay is not cached: windowed session under the 5 MB cap then a page reload · reload · client re-subscribes with `lastSeq: 0` and the gap divider is present again — see `packages/client/src/hooks/__tests__/useMessageHandler.replay-cache.test.tsx` (test-plan #F11)
- [x] 16.9 Settings control renders and writes: settings panel with `maxReplayEvents=500` · open Memory Limits, change to 1000, save · config write carries 1000 with the other three `memoryLimits` values unchanged — see `tests/e2e/max-replay-events-setting.spec.ts` (test-plan #F12)
- [x] 16.10 Restart-required affordance: settings panel · change the control · panel indicates a server restart is required as the sibling controls do — see `tests/e2e/max-replay-events-setting.spec.ts` (test-plan #F13)

## 17. Manual verification

- [ ] 17.1 Read the gap divider copy at `gapCount` of 1 and of 1200 and confirm singular/plural and phrasing read naturally (test-plan: manual-only) (test-plan #F14)

## 18. Documentation

- [x] 18.1 Document `memoryLimits.maxReplayEvents` and the gap/backfill protocol in `docs/architecture.md` via a DocScribe subagent in caveman style
- [x] 18.2 Update the directory `AGENTS.md` rows for every touched file per the Documentation Update Protocol
