# Test Plan — fix-lazy-history-backfill-ux

Stage: design   Generated: 2026-08-22

Three spec gaps were resolved via the hard gate before this catalog was written:
default `maxReplayEvents` = **2000** (task 1.2 may amend), replay performance
target = **≥5× faster to first paint, windowed vs unwindowed, same session**,
scroll stability tolerance = **≤8px drift**.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | shared-config: absent → default | EP | L1 | automated | `memoryLimits` object with no `maxReplayEvents` | `parseMemoryLimits` | returns `2000`; every sibling limit unchanged |
| E2 | shared-config: explicit zero | EP | L1 | automated | `maxReplayEvents: 0` | `parseMemoryLimits` | returns `0` (unlimited), not `2000` |
| E3 | shared-config: below min | BVA just-below | L1 | automated | `maxReplayEvents: 5` | `parseMemoryLimits` | returns `100` (`MIN_REPLAY_WINDOW`) |
| E4 | shared-config: at min | BVA at-bound | L1 | automated | `maxReplayEvents: 100` | `parseMemoryLimits` | returns `100` |
| E5 | shared-config: negative | EP invalid | L1 | automated | `maxReplayEvents: -1` | `parseMemoryLimits` | returns `2000` (was `0` before this change) |
| E6 | shared-config: non-numeric | EP invalid | L1 | automated | `maxReplayEvents: "500"` | `parseMemoryLimits` | returns `2000` |
| E7 | window not applied at bound | BVA at-bound | L1 | automated | compacted stream of exactly `2000` events, limit `2000` | `computeReplayWindow` | returns `null`; no `history_window` emitted |
| E8 | window applied just past bound | BVA just-above | L1 | automated | compacted stream of `2001` events, limit `2000` | `computeReplayWindow` | window with head `200`, tail `1800` |
| E9 | head floor at small window | BVA on `HEAD_MIN` | L1 | automated | limit `100`, stream of `500` | `computeReplayWindow` | head `20` (floor, not `10`), tail `80` |
| E10 | backfill starts at the tail | BVA | L1 | automated | gap `headMaxSeq=200`, `tailMinSeq=1800` | `nextBackfillRange` | `toSeq === 1799` |
| E11 | final request floors at head | BVA just-above-min | L1 | automated | gap `headMaxSeq=200`, `tailMinSeq=210` | `nextBackfillRange` | `fromSeq === 201`, `toSeq === 209` |
| E12 | full-span request | BVA at-bound | L1 | automated | gap spanning `>500` | `nextBackfillRange` | `toSeq - fromSeq + 1 === 500` |
| E13 | edge crediting matrix | decision table | L1 | automated | 4 combos of (head-adjacent, tail-adjacent) | `handleHistoryBackfill` | (T,T)→tail credited, head unchanged; (T,F)→head; (F,T)→tail; (F,F)→neither |
| E14 | span clamp keeps tail adjacency | BVA + regression | L1 | automated | tail-adjacent request spanning `900` | `handleHistoryBackfill` | `servedTo === tailMinSeq-1`; `servedFrom` raised; tail credited |
| E15 | span clamp keeps head adjacency | BVA | L1 | automated | head-adjacent request spanning `900` | `handleHistoryBackfill` | `servedFrom === headMaxSeq+1`; `servedTo` lowered; head credited |
| E16 | inverted range | EP invalid | L1 | automated | `fromSeq > toSeq` | `handleHistoryBackfill` | one result, `error: "out_of_range"`, `events: []` |
| E17 | range outside the gap | EP invalid | L1 | automated | range entirely above `tailMinSeq` | `handleHistoryBackfill` | `error: "out_of_range"` |
| E18 | gap-facing edge snaps | state-transition | L1 | automated | slice whose lower cut falls mid-message, `message_end` 40 events in | `handleHistoryBackfill` | served range begins at that boundary |
| E19 | no boundary within lookup | BVA at `SNAP_LOOKUP` | L1 | automated | slice with no boundary within `200` | `handleHistoryBackfill` | raw cut served, no error |
| E20 | snap would empty the slice | BVA degenerate | L1 | automated | slice whose only boundary is its own first event | `handleHistoryBackfill` | unsnapped range served; `remainingGapCount` not reported `0` |
| E21 | credited edge is post-snap | regression | L1 | automated | tail-adjacent slice that snaps | `handleHistoryBackfill` | recorded `tailMinSeq === servedFrom`, not the pre-snap bound |
| E22 | orientation picks the edge | decision table | L1 | automated | head-adjacent request | `handleHistoryBackfill` | the **upper** edge is the snapped one |
| E23 | truthful count over a holey store | EP | L1 | automated | store middle-trimmed inside the gap | `handleHistoryBackfill` | `remainingGapCount` equals stored count, less than the seq distance |
| E24 | every unfinished tool elides | EP over position | L1 | automated | backfill segment with unfinished tools at first, middle, last position | segment fully reduced | all three rows carry `elided`; none `running` |
| E25 | live tool stays running | EP | L1 | automated | `tool_execution_start` on the live path, no end | reducer applies it | status `running` |
| E26 | initial replay does not elide | EP | L1 | automated | windowed replay ending with an unfinished tool | replay fully applied | status `running`; still reconcile-eligible |
| E27 | streaming row finalized | state-transition | L1 | automated | backfill segment whose top edge lands mid-message | segment fully reduced | row is no longer `isStreaming` |
| E28 | reconcile selectors reject elided | decision table | L1 | automated | session state with an `elided` tool call | `selectStaleRunningTools`, `selectSupersededHealTargets` | neither selects it |
| E29 | grouping does not absorb elided | decision table | L1 | automated | 3 consecutive tool rows, middle one `elided` | `group-tool-calls` | elided row not collapsed away; not counted in `doneCount` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | proposal: long sessions open fast | comparative | L3 | automated | one session compacting to ~20k events, opened at `maxReplayEvents` `0` then `2000` | time to first rendered transcript row: windowed ≥5× faster | 5 runs, median |
| P2 | D7: subagent-heavy sessions window | comparative | L3 | automated | subagent-heavy session (compacts poorly) at `2000` | window IS applied; same ≥5× ratio holds | 5 runs, median |
| P3 | D9: bounded serialize+send | threshold | L1 | automated | backfill request spanning the full `BACKFILL_MAX_SPAN` | response event count ≤500; handler wall time bounded | per-call |
| P4 | loop terminates without growth | soak | L2 | automated | repeated backfill until gap exhausted on a 20k-event session | loop terminates; server RSS returns to baseline ±10% | full drain |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | splice preserves scroll | state-convergence | L3 | automated | windowed session, divider in viewport | click "Load earlier" | divider bounding-box `y` drifts ≤8px |
| F2 | measurement does not move it | state-convergence | L3 | automated | as F1 | virtualizer measures the spliced rows | divider `y` still within 8px of pre-click, after settle |
| F3 | no re-pin from the near-bottom band | state-transition (illegal edge) | L3 | automated | divider positioned inside the 50px near-bottom band | splice commits | transcript does NOT jump to bottom |
| F4 | selection does not trigger correction | state-transition (illegal edge) | L3 | automated | text selection held in the tail | splice commits | selection preserved; no scroll correction applied |
| F5 | spliced rows land above the tail | state-transition | L3 | automated | windowed session | one backfill | new rows render between the divider and the first tail row, in seq order |
| F6 | fully-filled gap removes the divider | state-transition | L3 | automated | gap smaller than one span | one backfill | divider removed entirely; no residual affordance |
| F7 | unservable divider explains | state-transition | L3 | automated | gap whose store range was trimmed | click "Load earlier" | divider states events are no longer available; no retry; no error styling; does NOT blame retention specifically |
| F8 | elided renders without a spinner | state-transition | L3 | automated | backfill slice orphaning a **subagent** tool call | splice commits | agent row shows "result not loaded"; no spinner; not error-styled |
| F9 | affordance armed only after replay | state-transition (illegal edge) | L3 | automated | session still hydrating | user clicks before terminal batch | no `history_backfill` is sent |
| F10 | single-flight under scroll-spam | state-transition (illegal edge) | L3 | automated | windowed session | two rapid "Load earlier" clicks | second refused `in_flight`; first still splices; divider not stuck pending |
| F11 | resubscribe invalidates in flight | state-transition | L3 | automated | backfill in flight | navigate away and back | `stale_generation`; nothing spliced; divider recovers to a usable state |
| F12 | help text is unconditional | decision table | L3 | automated | both values positive, each ordering | open Memory Limits | interaction help text present; NO pairing-specific warning in any ordering |
| F13 | sibling edit does not pin | state-transition | L3 | automated | stored config with no `maxReplayEvents` | edit `maxEventsPerSession`, save | written config gains no explicit `maxReplayEvents` |
| F14 | explicit zero survives sibling edit | state-transition | L3 | automated | stored config with `maxReplayEvents: 0` | edit a sibling, save | written config still has `0` |
| F15 | control shows effective default | EP | L3 | automated | config with no `maxReplayEvents` | open Memory Limits | control displays `2000`, not `0` |
| F16 | affordance reads as "not loaded" not "broken" | visual/subjective | — | manual-only | elided tool row | human looks at it | [judgment: does it read as unloaded rather than failed — no automatable observable] |
| F17 | repeated Load-earlier feels smooth | visual/subjective | — | manual-only | long gap, several clicks | human scrolls and clicks | [judgment: no disorienting jump — the ≤8px assertion covers the measurable part] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | unsubscribed session | fault-injection | L1 | automated | client not subscribed | `history_backfill` | `error: "not_subscribed"`; store never read |
| X2 | exactly one response per refusal | fault-injection (parametrized) | L1 | automated | each refusal code in turn | `history_backfill` | exactly one `history_backfill_result` per request, always |
| X3 | socket drops mid-backfill | fault-injection (abort) | L3 | automated | WS closed after request, before response | reconnect | divider not left pending; affordance usable after resubscribe |
| X4 | store hole inside the gap | fault-injection | L1 | automated | requested range inside gap bounds but absent from store | `history_backfill` | empty `events`, truthful `remainingGapCount`; client shows unservable, NOT an error |
| X5 | server restart mid-gap | fault-injection (abort) | L3 | automated | `/api/restart` between window announce and backfill | client resubscribes | no crash, no double splice, transcript coherent |
| X6 | new client vs old server | fault-injection (version skew) | — | manual-only | new bundle against a pre-change server | walk the gap | [documented degraded state: stale count + dead button; requires building an old server — see New infra] |
| X7 | compaction empties a slice | fault-injection | L3 | automated | gap slice consisting entirely of superseded `message_update`s | click "Load earlier" | empty response; divider wording remains truthful (does not attribute to retention) |

---

## Coverage summary

- Requirements covered: 13/13 delta-spec requirements
- Scenarios by class: edge 29 · perf 4 · frontend 17 · error 7 (57 total)
- Scenarios by level: L1 35 · L2 1 · L3 18 · manual-only 3
- Scenarios by disposition: automated 54 · manual-only 3

## New infra needed

- **X6 only.** Exercising the new-client-vs-old-server skew needs a pinned pre-change server build, which no current harness provides. Recorded as `manual-only` rather than silently assumed; if it must be automated, that is a separate harness change, not part of this one.
- Everything else routes to existing levels: `subscription-handler-backfill.test.ts` / `subscription-handler-window.test.ts` (L1 server), `event-reducer.window-edges.test.ts` / `useMessageHandler.history-gap.test.tsx` / `useStaleToolReconcile.test.ts` / `config.test.ts` (L1 client+shared), `qa/tests/*.sh` (L2), and the docker Playwright harness (L3).
