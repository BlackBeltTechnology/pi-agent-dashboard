# Test Plan — fix-history-backfill-holey-store

Stage: design   Generated: 2026-08-30

The one decision-forcing gap (exhausted two-sided gap presentation) was resolved
with the user during doubt-review — Option B (holey → not-retained terminus).
No unfillable Triple slots remain, so there is no hard-gate clarification.
Concrete constants: `MAX_BACKFILL_EVENTS = 500` (event count); holey ⇔
`gapCount < tailMinSeq − headMaxSeq − 1`; live repro `headMaxSeq=58220,
tailMinSeq=160334, gapCount=92` (92 events over ~102 000 seqs).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | server clamps bound (event count) | BVA at-cap | L1 | automated | store holds exactly 500 events in requested `[floor, tailMinSeq−1]` | one `history_backfill` | all 500 served in one response; `remainingGapCount === 0` (range abuts both edges, no snap holdback) |
| E2 | server serves newest bounded by count | BVA just-above | L1 | automated | store holds 501 events in requested range | one `history_backfill` | exactly 500 served (the newest); `remainingGapCount ≥ 1`; `servedFrom` = seq of the 500th-newest, not the floor |
| E3 | sparse wide range served in one response | EP (holey) | L1 | automated | range spans 102 000 seqs but holds 92 events (≤cap) | one `history_backfill` from `[headMaxSeq+1, tailMinSeq−1]` | all 92 served in one response (modulo one snap step); no refusal keyed on seq distance |
| E4 | servedFrom = lowest SELECTED seq (finding-1 guard) | boundary | L1 | automated | range holds >500 events AND the 500th-newest event is a `message_start` (snap does not fire) | one `history_backfill` | `servedFrom === slice[0].seq` (NOT the requested floor); `tailMinSeq` retreats to `slice[0].seq`; `remainingGapCount > 0` — no premature termination / silent drop |
| E5 | fully-superseded slice retreats tail (livelock guard) | boundary | L1 | automated | selected 500-event slice is entirely superseded `message_update`s | one `history_backfill` → compaction empties delivery | delivered `events: []`; `servedFrom` = selected slice's lowest seq; `tailMinSeq` retreats; `remainingGapCount` strictly decreases |
| E6 | server clamps bound | EP invalid | L1 | automated | requested range disjoint from announced gap | one `history_backfill` | `error: out_of_range`, `events: []` |
| E7 | server clamps bound | EP invalid | L1 | automated | `fromSeq > toSeq` | one `history_backfill` | `error: out_of_range`, `events: []` |
| E8 | count-bounded store read | BVA | L1 | automated | buffer holds 1000 events at/below `maxSeq`, `limit=500`, floor `minSeq` | `getEventsEndingAt(sessionId, minSeq, maxSeq, 500)` | returns the highest 500 seqs in `[minSeq,maxSeq]`, ascending; `result[0].seq` = 501st-highest; never below `minSeq` |
| E9 | client requests full remaining range | EP | L1 | automated | announced two-sided gap `{headMaxSeq, tailMinSeq}`; and a head-free gap `{oldestGapSeq, tailMinSeq}` | `nextBackfillRange(gap)` | two-sided → `{fromSeq: headMaxSeq+1, toSeq: tailMinSeq−1}` (no `−500`); head-free → `{fromSeq: oldestGapSeq, toSeq: tailMinSeq−1}` |
| E10 | successive requests walk downward | state-transition (2 steps) | L1 | automated | first response retreats tail to `servedFrom = S` | client issues next request | next request `toSeq === S − 1`; `fromSeq` still the floor |
| E11 | final request; snap may defer last event | boundary | L1 | automated | remaining gap < cap but a message-boundary snap holds back the lowest events | final `history_backfill` | response `remainingGapCount > 0`; a further request serves the remainder and then reports `remainingGapCount === 0` (walk terminates) |
| E12 | holeyness derived from announced window | decision | L1 | automated | announced `gapCount=92, tailMinSeq−headMaxSeq−1=102113`; and `gapCount == span` | `createHistoryGapState` | first → `holey === true`; second → `holey === false`; computed with no extra request; `holey === false` forced for `tail-only` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | bounded range read does not scan the gap | probe (sub-linearity) | L1 | automated | buffer of 20 000 events, `getEventsEndingAt` `limit=500` over a range spanning most of the buffer | store probe `entriesExamined` bounded by `O(log n + limit)` — assert `< 1000`, NOT 20 000 | single call |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | client continues on empty + remaining (reported-bug guard) | state-transition | L1 | automated | `head-tail` gap, divider placed, armed | `history_backfill_result` `events: [], remainingGapCount: 80` | gap converges to armed+idle: `unservable === false`, `atFloor === false`, affordance shows "Load earlier"; the string "no longer available to load" is never rendered |
| F2 | exhausted contiguous two-sided removes affordance | state-transition | L1 | automated | `head-tail`, `holey === false`, divider placed | `history_backfill_result` `remainingGapCount: 0` (with events) | `HISTORY_GAP_ROW_ID` removed from `messages[]`; gap state cleared |
| F3 | exhausted holey two-sided → not-retained terminus | state-transition | L1 | automated | `head-tail`, `holey === true`, divider placed | `history_backfill_result` `remainingGapCount: 0` | divider NOT removed; resolves to a two-sided terminus state distinct from `atFloor` |
| F4 | head-free empty above non-empty floor keeps affordance | state-transition | L1 | automated | `tail-only` gap, armed | `history_backfill_result` `events: [], remainingGapCount: 12` | `atFloor === false`; loading affordance retained; no terminus |
| F5 | head-free floor terminus distinguishes start vs trimmed | state-transition | L1 | automated | `tail-only`, `remainingGapCount: 0`, with `oldestGapSeq > 1`; and with `oldestGapSeq === 1` | terminal `history_backfill_result` | first → `not-retained` terminus; second → `session-start` terminus |
| F6 | terminus rendering (divider component) | render | L1 | automated | gap state `{exhausted, holey:true, windowShape:"head-tail"}`; and `{atFloor, windowShape:"tail-only", oldestGapSeq>1}` | render `HistoryGapDivider` | both render the `not-retained` `TerminusRow` (`data-testid=history-gap-not-retained`); no retry button; not error-styled |
| G1 | end-to-end holey backfill (user-visible symptom) | state-convergence | L3 | manual-only | docker harness seeded with a holey session (head + trimmed middle + tail, gap ≫ cap in seqs, ≤ a few cap in events) | user clicks "Load earlier" | gap fills within a handful of clicks (not ~205); "These earlier messages are no longer available to load." never appears; a holey-exhausted gap shows the "no longer retained" terminus |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | refusal is not exhaustion (finding-2 guard) | fault-injection | L1 | automated | server responds `error: stale_generation` (payload carries `remainingGapCount: 0`) | client handles `history_backfill_result` | gap → `failed: true` with a retry affordance; divider NOT removed, NO terminus, NOT marked exhausted |
| X2 | divider-less response is a no-op | fault-injection | L1 | automated | `history_backfill_result` arrives when `HISTORY_GAP_ROW_ID` is absent from `messages[]` | client handles it | `pending` cleared; gap bookkeeping (`tailMinSeq`, `remainingGapCount`) unchanged; transcript unchanged |

---

## Coverage summary

- Requirements covered: 8/8 modified+added (plus 2 unchanged reqs guarded regression-style by X1/X2)
- Scenarios by class: edge 12 · perf 1 · frontend 7 (incl. G1) · error 2
- Scenarios by level: L1 21 · L2 0 · L3 1
- Scenarios by disposition: automated 21 · manual-only 1

## New infra needed

- **G1 (L3) requires a seeded HOLEY session fixture in the docker e2e harness** —
  a session whose in-memory store has a trimmed middle (head + gap ≫ cap in seqs
  but ≤ a few × cap in events + tail). No existing harness seed produces one; it
  must be authored (e.g. replay a synthetic event stream past `maxEventsPerSession`
  so retention middle-trims, or inject a pre-holed store). If that seed proves
  disproportionately expensive, G1's risk is already fully covered deterministically
  by F1/F3/X1 at L1 — the fold step may drop G1 to manual-only rather than build
  the fixture. Flagged here so `plan-proposal` folds it as a decision, not a silent
  assumption.

  **DECISION (apply, fix-history-backfill-holey-store 5.1): G1 dropped to manual-only.**
  The seed would require driving a live session past `maxEventsPerSession` inside the
  docker harness to force a retention middle-trim — disproportionately expensive against
  the residual risk: the wire path G1 exercises is covered at L3 by the existing
  contiguous-gap specs (F5 request shape, F6 drain-to-terminal), and holey selection +
  holey termination are covered deterministically at L1 by E3, F1, F3 and X1. Manual
  execution lands as task 5.3 (live reproduction on `01a052cb…`) after deploy.
