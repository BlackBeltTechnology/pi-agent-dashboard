# Test Plan — lazy-load-session-history

Stage: design   Generated: 2026-02-14

All HARD-gate clarifications were resolved before this catalog was written; no
`[NEEDS CLARIFICATION]` markers remain.

Resolved at the gate:
- **G1** — the change is held to a deterministic server-side observable (delivered event count + serialized wire bytes on subscribe), not a wall-clock latency threshold.
- **G2** — the gap affordance is an explicit "N earlier events" divider with a click-to-load button.
- **G3** — moot under G2; click-to-load has no re-arm condition, so the loop-prevention row is dropped.

Constants under test (design.md): `MIN_WINDOW=100`, `HEAD_RATIO=0.1`, `HEAD_MIN=20`, `HEAD_CAP=200`, `SNAP_LOOKUP=200`, `BACKFILL_MAX_SPAN=500`. Cache byte cap `5 MB` (`replay-cache.ts`). Store default `maxEventsPerSession=20000`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | shared-config: field default | EP | L1 | automated | `memoryLimits` object with no `maxReplayEvents` | `parseMemoryLimits(raw)` | returns `maxReplayEvents === 0`, other three fields unchanged |
| E2 | shared-config: minimum window | BVA | L1 | automated | `maxReplayEvents: 99` | `parseMemoryLimits` | returns `100` |
| E3 | shared-config: minimum window | BVA | L1 | automated | `maxReplayEvents: 100` | `parseMemoryLimits` | returns `100` (unclamped) |
| E4 | shared-config: minimum window | BVA | L1 | automated | `maxReplayEvents: 101` | `parseMemoryLimits` | returns `101` |
| E5 | shared-config: zero preserved | BVA | L1 | automated | `maxReplayEvents: 0` | `parseMemoryLimits` | returns `0`, NOT clamped to `100` |
| E6 | shared-config: negative unset | BVA | L1 | automated | `maxReplayEvents: -1` | `parseMemoryLimits` | returns `0` |
| E7 | shared-config: non-numeric | EP | L1 | automated | `maxReplayEvents: "500"` | `parseMemoryLimits` | returns `0` |
| E8 | replay: fits-entirely short-circuit | BVA | L1 | automated | compacted array of 500 events, `windowLimit=500` | `sendEventBatches(..., 500)` | all 500 delivered, each seq exactly once, `gapCount === 0` |
| E9 | replay: window fires at limit+1 | BVA | L1 | automated | compacted array of 501 events, `windowLimit=500` | `sendEventBatches(..., 500)` | delivered count ≤ 500, `gapCount === 1` |
| E10 | replay: no overlap on small session | BVA | L1 | automated | compacted array of 40 events, `windowLimit=1000` | `sendEventBatches(..., 1000)` | 40 events delivered, zero duplicate seqs, `gapCount === 0` (never negative) |
| E11 | replay: head/tail split at MIN_WINDOW | BVA | L1 | automated | 5000 events, `windowLimit=100` | window computed | head = 20 (`HEAD_MIN` floor, not `floor(100*0.1)=10`), tail = 80 |
| E12 | replay: head/tail split nominal | EP | L1 | automated | 5000 events, `windowLimit=500` | window computed | head = 50, tail = 450 |
| E13 | replay: head cap | BVA | L1 | automated | 50000 events, `windowLimit=5000` | window computed | head = 200 (`HEAD_CAP`), tail = 4800 |
| E14 | replay: windowing keyed on content | decision-table | L1 | automated | warm session, subscribe `lastSeq=0`, `maxReplayEvents=500` | `handleSubscribe` | window applied despite the delta branch serving it |
| E15 | replay: delta never windowed | decision-table | L1 | automated | warm session, subscribe `lastSeq=900` of 5000, `maxReplayEvents=500` | `handleSubscribe` | all 4100 remaining delivered, no seq gap after `lastSeq`, no `history_window` emitted |
| E16 | replay: windowing disabled | decision-table | L1 | automated | 50000 events, `maxReplayEvents=0` | subscribe `lastSeq=0` | all 50000 delivered, no non-zero `gapCount` |
| E17 | replay: high-water mark | state | L1 | automated | array whose highest-seq event is a superseded `message_update` | `sendEventBatches` with a window that elides the top | return value === max seq of the INPUT array; follow-up `getEvents(ret+1)` returns `[]` |
| E18 | replay: tail snap forward | BVA | L1 | automated | cut index falls mid-message, `message_start` 12 events later | window computed | first tail event is that `message_start`; delivered count ≤ limit |
| E19 | replay: snap never exceeds budget | BVA | L1 | automated | `windowLimit=500`, boundaries requiring maximal snapping | window computed | delivered count ≤ 500 |
| E20 | replay: snap lookup bound | BVA | L1 | automated | no boundary event within `SNAP_LOOKUP=200` of the cut | window computed | exact cut index used; no unbounded backward scan |
| E21 | replay: head trailing snap | BVA | L1 | automated | head cut lands after a `message_start` with no `message_end` | window computed | head ends on a completed `message_end`; no dangling open message |
| E22 | replay: gapCount excludes trimmed events | EP | L1 | automated | store already middle-trimmed, stored seqs 1–5000 and 18000–20000 | window computed | `gapCount` === count of gap events HELD, and `< tailMinSeq - headMaxSeq - 1` |
| E23 | compaction: omitted boundary unchanged | EP | L1 | automated | any array, no explicit boundary | `compactEventsForReplay(arr)` | output identical to the pre-change implementation |
| E24 | compaction: external boundary supersedes slice | EP | L1 | automated | middle slice + boundary indicating a later `message_end` outside it | `compactEventsForReplay(slice, boundary)` | every non-exempt `message_update` dropped |
| E25 | compaction: exemptions hold | decision-table | L1 | automated | slice containing a thinking update and a text update before `tool_execution_start` | `compactEventsForReplay(slice, boundary)` | both retained |
| E26 | compaction: window applied after | EP | L1 | automated | 20000 stored compacting to 1000, `windowLimit=500` | `sendEventBatches(..., 500)` | delivered events are all post-compaction survivors; count ≤ 500 |
| E27 | backfill: span clamp | BVA | L1 | automated | request span of 501 | `history_backfill` handler | ≤ 500 events served, NO error code returned |
| E28 | backfill: span at max | BVA | L1 | automated | request span of exactly 500 | handler | up to 500 served, no error |
| E29 | backfill: range outside gap | EP | L1 | automated | range not intersecting the gap | handler | `error: "out_of_range"`, `events: []` |
| E30 | backfill: inverted range | EP | L1 | automated | `fromSeq > toSeq` | handler | `error: "out_of_range"`, `events: []` |
| E31 | backfill: events strictly inside gap | EP | L1 | automated | valid in-gap range | handler | every returned seq `> headMaxSeq` and `< tailMinSeq` |
| E32 | store: bounded range read | BVA | L1 | automated | buffer of 20000, request `[5000, 5100]` | `getEventsRange` | exactly the 101 in-range events, ascending; no event outside the bounds |
| E33 | store: range read is sub-linear | BVA | L1 | automated | buffer of 20000, narrow range | `getEventsRange` | probe count consistent with binary search, not a full scan of 20000 |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | replay: bounded delivery | threshold | L1 | automated | seeded session of 50000 stored events, `maxReplayEvents=500` | delivered event count ≤ 500 | single subscribe |
| P2 | replay: bounded wire bytes | threshold | L1 | automated | same seeded session, windowed vs unwindowed | serialized `event_replay` payload bytes reduced ≥ 90% vs `maxReplayEvents=0` | single subscribe |
| P3 | backfill: bounded response | threshold | L1 | automated | one `history_backfill` at max span | serialized response ≤ the per-event ceiling × 500 | single request |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | reducer: orphan message_end | state-transition | L1 | automated | segment beginning with `message_end`, no `message_start` | `reduceEvent` fold | returns a state, does not throw |
| F2 | reducer: orphan tool_execution_end | state-transition | L1 | automated | segment beginning with `tool_execution_end`, no start | `reduceEvent` fold | returns a state, does not throw |
| F3 | reducer: in-stream seq discontinuity | state-transition | L1 | automated | head seqs 1–20 then tail seqs 4800–5000 in one replay | reducer fold over the batches | single coherent state; no reset fired on the tail batch |
| F4 | replay: explicit reset precedes window | state-transition | L3 | automated | session A viewed, then re-subscribed with `lastSeq=0` and a window | subscribe | transcript contains no rows from the prior subscription |
| F5 | UI: gap divider renders | state-transition | L3 | automated | windowed session, `gapCount=1200` | session opened | a divider is visible between head and tail reporting 1200 earlier events |
| F6 | UI: click-to-load splices | state-transition | L3 | automated | windowed session with a divider | user clicks the load button | earlier rows appear between head and tail; head and tail rows both still present |
| F7 | UI: splice preserves scroll anchor | state-convergence | L3 | automated | windowed session scrolled to the divider | click load, wait for splice | the row under the viewport top before the click is at the same visual position after |
| F8 | UI: splice does not reset transcript | state-convergence | L3 | automated | windowed session with tail rows rendered | click load | tail rows retain identity; transcript is not rebuilt from scratch |
| F9 | UI: exhausted gap removes affordance | state-transition | L3 | automated | gap fully backfilled, `remainingGapCount=0` | final splice | the divider/button is no longer offered |
| F10 | UI: no backfill before replay completes | state-transition | L3 | automated | session mid-hydration | user attempts to load earlier | no `history_backfill` is sent before the terminal batch |
| F11 | cache: windowed replay not persisted | state-transition | L3 | automated | windowed session under the 5 MB cap, then page reload | reload | client re-subscribes `lastSeq: 0` and the gap divider is present again |
| F12 | settings: control renders + writes | decision-table | L3 | automated | settings panel, `maxReplayEvents=500` | open Memory Limits, change to `1000`, save | config write carries `maxReplayEvents: 1000` and the other three `memoryLimits` values unchanged |
| F13 | settings: restart-required affordance | state-transition | L3 | automated | settings panel | change the control | panel indicates a server restart is required, as the sibling controls do |
| F14 | UI: divider copy reads naturally at boundaries | visual/subjective | — | manual-only | `gapCount` of 1, and of 1200 | human reads the divider | [judgment: singular/plural and phrasing read correctly — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | backfill: unsubscribed session | fault-injection | L1 | automated | socket not subscribed to the session | `history_backfill` for it | one response, `error: "not_subscribed"`, `events: []`, and no store read performed |
| X2 | backfill: concurrent request | fault-injection | L1 | automated | first request still in flight | second request for the same session | second responds `error: "in_flight"`; first still receives its own response |
| X3 | backfill: stale generation | fault-injection | L1 | automated | unsubscribe + re-subscribe while a backfill is in flight | response completes after the re-subscribe | one response with `error: "stale_generation"`; no event spliced into the new transcript |
| X4 | backfill: exactly one response | fault-injection | L1 | automated | each refusal path in turn | request issued | exactly one `history_backfill_result` per request, never zero and never two |
| X5 | backfill: store hole | fault-injection | L1 | automated | requested range lies in a region the store already trimmed | request | zero events returned with a truthful `remainingGapCount`; client's stop rule terminates |
| X6 | backfill: no disk read | fault-injection | L1 | automated | session file made unreadable | backfill request served | request succeeds from the store; no session-file read attempted |
| X7 | replay: catch-up after windowed replay | fault-injection | L1 | automated | window elides the top of the input | `clearReplaying` runs with the returned seq | catch-up query returns `[]`; no already-delivered event is re-sent |

---

## Coverage summary

- Requirements covered: 23/23
- Scenarios by class: edge 33 · perf 3 · frontend 14 · error 7
- Scenarios by level: L1 46 · L2 0 · L3 10 · manual-only 1
- Scenarios by disposition: automated 56 · manual-only 1

## New infra needed

None. L1 rows extend the existing vitest suites under `packages/*/src/**/__tests__/`; L3 rows extend `tests/e2e/*.spec.ts` against the docker harness (port read from `.pi-test-harness.json`, never hardcoded). No L2 rows — this change adds no process, install, or multi-OS runtime behaviour.
