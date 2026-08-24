# Test Plan — add-tail-only-replay-window

Stage: design   Generated: 2026-08-22

All four clarification gaps were resolved at the gate before this file was written: `SETTLE_MS = 120`, `windowShape?: "head-tail" | "tail-only"`, per-load `aria-live="polite"` count announcement, and a `handleScroll` bookkeeping budget of <1ms p95. No `[NEEDS CLARIFICATION]` markers remain.

L3 rows run against the docker harness on the port `docker/test-up.sh` derives into `.pi-test-harness.json` (`dashboardPort`) — never a hardcoded `:18000`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | shared-config: mode selects shape | EP | L1 | automated | config `{}` (field absent) | `parseMemoryLimits` | returns `replayWindowMode: "head-tail"` |
| E2 | shared-config: mode selects shape | EP (invalid class) | L1 | automated | `replayWindowMode` = `"tail"`, `7`, `null`, `[]`, `"TAIL-ONLY"` | `parseMemoryLimits` | each returns `"head-tail"`; no throw for any of the five |
| E3 | shared-config: mode selects shape | EP (valid class) | L1 | automated | `replayWindowMode: "tail-only"` | `parseMemoryLimits` | returns `"tail-only"` verbatim |
| E4 | shared-config: clamp is mode-independent | BVA | L1 | automated | `maxReplayEvents` ∈ {0, 1, 5, 99, 100, 101} × mode ∈ {head-tail, tail-only} | `parseMemoryLimits` | 0→0 in both modes; 1/5/99→100 in both; 100→100; 101→101. The two modes return identical values for every input |
| E5 | replay bounded to a configured window | BVA (window vs stream size) | L1 | automated | compacted stream of 499, 500, 501 events; `maxReplayEvents: 500`; `tail-only` | `sendEventBatches` | 499 and 500 → no `history_window` at all (fits-entirely short-circuit); 501 → windowed, exactly 500 delivered |
| E6 | replay bounded to a configured window | boundary (head-free arithmetic) | L1 | automated | compacted stream of 5000; `maxReplayEvents: 500`; `tail-only` | `computeReplayWindow` then the announcement block | returns `headEnd: 0`; announcement emits `headMaxSeq: 0` **without throwing** — pins the `full[-1]` crash |
| E7 | replay bounded to a configured window | decision table (mode × limit) | L1 | automated | mode ∈ {head-tail, tail-only} × `maxReplayEvents` ∈ {0, 500}; stream of 5000 | subscribe with `lastSeq: 0` | limit 0 → 5000 delivered, no window, in BOTH modes; limit 500 → 500 delivered, shape per mode |
| E8 | window boundaries snap inward | boundary | L1 | automated | `tail-only`, tail cut landing mid-assistant-message with a `message_start` 30 events forward | `computeReplayWindow` | first delivered event is that `message_start`; delivered count ≤ limit; no head-edge scan performed |
| E9 | windowed replay announces its shape | EP | L1 | automated | window applied in each mode | announcement emitted | `windowShape` is `"tail-only"` / `"head-tail"` respectively; field is optional in the type |
| E10 | edge crediting never credits an absent head | decision table | L1 | automated | server `GapState` `{hasHead: false, headMaxSeq: 0, tailMinSeq: 4501}`; request `from: 1` | `handleHistoryBackfill` | tail bound retreats; `headMaxSeq` stays `0`; `remainingGapCount` matches a store read |
| E11 | edge crediting never credits an absent head | decision table (both-adjacent) | L1 | automated | a range abutting head **and** tail in a `head-tail` window | `handleHistoryBackfill` | tail is credited (fix-lazy D1a), head is not |
| E12 | head-free window bounds gap at store floor | BVA | L1 | automated | gap `{tailMinSeq: 4501, oldestGapSeq: 3000}`, `BACKFILL_MAX_SPAN: 500` | `nextBackfillRange` repeatedly | successive ranges walk down; the final `fromSeq` is exactly `3000`, never `2999` or lower |
| E13 | head-free window bounds gap at store floor | boundary (floor = 1) | L1 | automated | `oldestGapSeq: 1` | walk to completion | last range starts at `1`; terminus reports "beginning of the session" |
| E14 | head-free window bounds gap at store floor | boundary (floor > 1) | L1 | automated | `oldestGapSeq: 3000` after retention trim | walk to completion | terminus reports "earlier events not retained" and names neither retention nor compaction |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | head-free gap loads on scroll proximity | micro-benchmark | L1 | automated | 5s of synthesised scroll events at 60Hz (≈300 events) driving the bookkeeping path **plus every settle-expiry evaluation and its dispatch through the `handleLoadEarlier` guards** — not the jsdom-degenerate `scrollTop === 0` path, which is vacuous | added time per event **< 1ms p95** | 5s continuous scroll |
| P2 | head-free gap loads on scroll proximity | tail-latency vs baseline | L3 | automated | 20k-event session, continuous scroll-up, `tail-only` vs `head-tail` | no additional dropped frames vs the `head-tail` baseline | 5s scroll |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | head-free gap loads on scroll proximity | state-transition (legal) | L1 | automated | `nearTop`, `pendingUserIntent` true, gap armed/servable/head-free, outside the suppression window | settle timer expires | `shouldAutoLoadHistory` → `true`, exactly once; `pendingUserIntent` clears on issue |
| F2 | head-free gap loads on scroll proximity | state-transition (illegal) | L1 | automated | `nearTop` true but `pendingUserIntent` false (the flag was cleared by the previous request and only stamped scroll events have occurred since) | settle timer expires | → `false`. Covers the splice-induced re-fire and the measurement-commit re-fire |
| F2a | head-free gap loads on scroll proximity | state-transition (small splice) | L1 | automated | a splice smaller than the proximity band leaves the user `nearTop`; the user then scrolls once, un-stamped | settle timer expires | → `true` — the walk does not stall, because intent is tracked rather than position |
| F2b | head-free gap loads on scroll proximity | state-transition (deferred suppression) | L1 | automated | `pendingUserIntent` true; three evaluations occur inside the suppression window, then the stamp lapses | stamp expiry schedules an evaluation | the suppressed evaluations change no state and fire nothing; the post-expiry evaluation fires exactly once |
| F3 | explicit affordance remains available | decision table (shape gate) | L1 | automated | identical state but `windowShape: "head-tail"` | settle timer expires | → `false`. A two-sided gap is never auto-loaded |
| F4 | head-free gap loads on scroll proximity | decision table (gap flags) | L1 | automated | rising edge × each of `pending`, `failed`, `unservable`, `atFloor`, `!armed` | settle timer expires | → `false` for every flag, independently |
| F5 | head-free gap loads on scroll proximity | state-transition (programmatic) | L3 | automated | session saved scrolled to the top, then switched away and back | session-switch restore drives `scrollTop → 0` on first paint | **no** `history_backfill` frame on the wire — the restore stamps the suppression window |
| F6 | head-free gap loads on scroll proximity | state-transition (programmatic) | L3 | automated | transcript scrolled to the bottom | user activates scroll-to-top; view lands on the loading head | **exactly one** `history_backfill` results, not zero and not a chain |
| F7 | head-free gap loads on scroll proximity | BVA on `SETTLE_MS = 120` | L1 | automated | scroll events spaced 110ms apart, then 130ms of silence | timer evaluation | no fire while events are 110ms apart; exactly one fire after the 130ms gap. Pins the momentum boundary the 120ms choice risks |
| F8 | head-free gap loads on scroll proximity | state-transition (touch) | L3 | automated | mobile viewport, touch fling upward into the proximity band | `touchend` fires, momentum continues ~200ms | no request until momentum stops; then exactly one. Asserts the absence of a `touchend`-cleared latch |
| F9 | client splices backfilled events into the gap | invariant (D7a anchor) | L3 | automated | `tail-only`, user parked on the loading head, 200 rows spliced | backfill response applied | the first previously-loaded row holds its viewport position; the loading head leaves the proximity band; scrolling up again produces a second request |
| F10 | client splices backfilled events into the gap | invariant (mode split) | L3 | automated | same splice in `head-tail` | backfill response applied | `scrollTop` is left alone per fix-lazy — the two modes do not share the branch |
| F11 | client stops requesting when gap is exhausted | state-transition | L3 | automated | head-free gap, `remainingGapCount: 0` on the last response | response applied | loading head becomes the terminus row and is **not** removed from the transcript |
| F12 | client stops requesting when gap is exhausted | state-transition (contrast) | L3 | automated | two-sided gap, `remainingGapCount: 0` | response applied | interstitial **is** removed entirely |
| F13 | scroll-to-top affordance | state-transition | L3 | automated | `tail-only` transcript scrolled down | activate scroll-to-top | view top-aligns the loading head; control does not claim the session's earliest message was reached |
| F14 | Memory Limits exposes `replayWindowMode` | decision table | L3 | automated | settings panel with `maxReplayEvents: 0` | panel renders | mode control indicates it has no effect until a positive window is set |
| F15 | Memory Limits exposes `replayWindowMode` | state-transition (partial write) | L3 | automated | config with all `memoryLimits` siblings set | change only `replayWindowMode`, save | written config carries the new mode and every sibling **unchanged** |
| F16 | head-free gap loads on scroll proximity (a11y) | assistive-tech invariant | L3 | automated | `tail-only`, screen-reader semantics, 20 rows spliced | automatic load completes | an `aria-live="polite"` region receives a count announcement ("20 earlier messages loaded"); document focus is unchanged across the splice |
| F18 | client splices backfilled events into the gap | invariant (selection held) | L3 | automated | `tail-only`, a text selection held mid-transcript, loading head fills | splice commit | the selection-anchor compensator stays ACTIVE and the selection holds its position — the inverse of fix-lazy's head-tail suppression |
| F19 | head-free gap loads on scroll proximity | state-transition (programmatic) | L3 | automated | `tail-only`, transcript scrolled to the bottom | `scrollToTurn` navigation to an early turn drives the view near the top | NO `history_backfill` frame — `scrollToTurn` stamps the suppression window |
| F20 | head-free gap loads on scroll proximity | state-transition (programmatic) | L3 | automated | `tail-only`, short transcript pinned at the bottom while content streams | the streaming bottom-pin and the selection compensator write `scrollTop` | NO `history_backfill` frame from either writer |
| F21 | head-free gap loads on scroll proximity (a11y scope) | decision table | L3 | automated | `head-tail` window, user clicks the explicit "Load earlier" affordance | response applied | NO new live-region announcement — the count announcement is scoped to automatic loads in `tail-only` |
| F17 | `replayWindowMode` control is localized | EP | L1 | automated | each of `en`, `zh-CN`, `hu` | resolve label, option labels, hint | every key resolves from its catalog; a deliberately missing key falls back to English, never to a raw key id |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | windowed replay resets client state explicitly | fault (stale state) | L1 | automated | client already holds transcript rows for the session | `tail-only` windowed replay whose first seq is `4501` | prior rows discarded, not appended beneath; asserted **without** relying on `firstSeq === 1` |
| X2 | windowed replay resets client state explicitly | coverage of all paths | L1 | automated | windowed full stream on each of `:571` (stale `lastSeq`), `:616` (warm), `:693` (cold hydration) | subscribe / hydrate | `session_state_reset` precedes `history_window` on **all three**; the never-windowed delta site `:625` sends none |
| X3 | windowed replay resets client state explicitly | regression (D3 sequence change a) | L1 | automated | stream over the limit UNCOMPACTED, under it COMPACTED | warm subscribe | no reset is sent, and the transcript is still correct because the replay starts at seq `1` |
| X4 | windowed replay resets client state explicitly | regression (D3 sequence change b) | L1 | automated | windowed replay carrying `pi-asset:` tokens | reset now follows `replaySessionAssets` | asset tokens still resolve in the delivered window |
| X5 | head-free window bounds gap at store floor | fault (holey store) | L1 | automated | store trimmed mid-gap so a floored range is legal but returns nothing | backfill returns `events: [], remainingGapCount: 0` | terminus is shown, **not** `unservable` — the flooring makes this rare, not impossible |
| X6 | client splices backfilled events into the gap | fault (no splice target) | L1 | automated | response arrives for a session whose gap row is absent (session switched mid-flight) | response applied | `messages[]` unchanged **and** gap bookkeeping not advanced |
| X7 | explicit affordance remains available | fault-injection (refusal) | L3 | automated | server refuses an automatically issued request | response carries an error code | loading head offers an explicit retry; the trigger does not re-fire automatically; no protocol code reaches the user |
| X8 | unservable gap explains non-recoverability | fault (retention trim) | L3 | automated | `maxReplayEvents: 100` with a smaller positive `maxEventsPerSession` | subscribe, then attempt a load | divider states the events cannot be loaded, names neither retention nor compaction, and is not styled or announced as an error |

### Manual-only

| id | requirement | technique | level | disposition | surface | human check | note |
|----|-------------|-----------|-------|-------------|---------|-------------|------|
| M1 | head-free gap loads on scroll proximity | subjective latency | — | manual-only | loading head on a real device | does a deliberate scroll-up feel responsive at `SETTLE_MS = 120`, or dead? | judgment; feeds task 8.4's decision to keep or raise the constant |
| M2 | head-free gap loads on scroll proximity (a11y) | assistive-tech judgment | — | manual-only | VoiceOver / NVDA on the live dashboard | is a programmatic load distinguishable from a user-initiated one; is the terminus announced once rather than on every scroll? | F16 automates the mechanism; only the lived experience is manual |
| M3 | issue #521 field report | exploratory | — | manual-only | large real session in `tail-only` | no stuck tool spinner at a splice seam, no scroll jump, loading proceeds from the tail end | reproduces the reporter's three complaints end to end |

---

## Coverage summary

- Requirements covered: 17/17
- Scenarios by class: edge 14 · perf 2 · frontend 23 · error 8 · manual 3
- Scenarios by level: L1 26 · L2 0 · L3 18 · — 3
- Scenarios by disposition: automated 47 · manual-only 3

## New infra needed

None. L1 extends existing `__tests__` suites (`config.test.ts`, `subscription-handler-window.test.ts`, `subscription-handler-backfill.test.ts`, `useMessageHandler.history-gap.test.tsx`) plus one new pure-predicate suite under `packages/client/src/lib/chat/__tests__/`. L3 extends the existing docker harness alongside `tests/e2e/max-replay-events-setting.spec.ts`. No L2 rows — nothing here is process/install/multi-OS behaviour.
