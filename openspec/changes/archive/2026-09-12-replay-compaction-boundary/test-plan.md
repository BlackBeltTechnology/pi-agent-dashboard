# Test Plan — replay-compaction-boundary

Stage: design   Generated: 2026-09-07

No clarification gate fired: every Triple slot resolved from the spec deltas plus
the two behaviours already verified in review (register-time reset semantics,
`extractSessionUpdates` running on replayed events). No performance requirement
exists in this change, so the performance class is intentionally empty rather
than gap-marked.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 boundary synthesis | state-transition | L1 | automated | entries `[message A, compaction C, message B]` | `replayEntriesAsEvents` | emitted stream contains exactly one `session_compact`, its index between A's and B's events, `timestamp === C.timestamp` |
| E2 | R1 no-compaction regression | EP (null class) | L1 | automated | entries with no `compaction` (existing fixture) | `replayEntriesAsEvents` | output deep-equals the pre-change output — zero added, removed or reordered events |
| E3 | R1 multiplicity | BVA (count 0/1/2/3) | L1 | automated | branches with 0, 1, 2 and 3 `compaction` entries | `replayEntriesAsEvents` | emitted `session_compact` count equals entry count, in entry order |
| E4 | R1 positional boundaries | BVA (position min/max) | L1 | automated | `compaction` as the FIRST entry, and as the LAST entry, of the branch | `replayEntriesAsEvents` | event emitted in both cases, first/last in the stream respectively; no throw, no swallowed neighbours |
| E5 | R2 no fabricated metadata | decision-table (3 absent fields) | L1 | automated | a `compaction` entry carrying `summary`, `tokensBefore`, `firstKeptEntryId`, `fromHook`, `details` | `replayEntriesAsEvents` | emitted `data` has no `reason`, no `willRetry`, no `estimatedPostCompactionTokens` key |
| E6 | R2 summary not rendered | EP (large payload) | L1 | automated | `compaction` entry with a 64 KB `summary` string | `replayEntriesAsEvents` | no emitted event payload contains any substring of that summary |
| E7 | R1 schema drift | fault-injection (malformed input) | L1 | automated | `compaction` entries missing `timestamp`, missing `tokensBefore`, and carrying an unknown extra field (`usage`) | `replayEntriesAsEvents` | one `session_compact` per entry, no throw; missing timestamp degrades to the converter's existing fallback, unknown field ignored |
| E8 | R1+R2 reducer parity | equivalence (live vs replayed) | L1 | automated | the synthesized event and a metadata-free live `session_compact` | reduce both with the client reducer | identical resulting message row shape and `compaction` metadata (unset in both) |
| E9 | R3 latch convergence | state-transition (illegal edge) | L1 | automated | event sequence `session_before_compact` → replayed old `session_compact` → real `session_compact` | `extractSessionUpdates` per event | final derived state is `{compacting:false}`; the early clear (design D6's accepted trade-off) is asserted as transient, never leaving `compacting` stuck `true` |

### Performance

None — this change states no latency, throughput or memory threshold, and adds
one synthesized event per compaction (141 across 400 sessions) to a stream of
~1k events per session. No threshold in the spec, so no perf row is invented.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R1 cold reload | state-convergence | L3 | automated | a harness session whose file contains a `compaction` entry with messages on both sides, events evicted from the server buffer | open the session in the browser after a register-time store wipe + bridge replay (AS BUILT: the disk cold-load producer is unreachable in this harness — a container respawn wipes the RAM-backed session file — and is gated at L2 by `loadAndReplay` in `packages/server/src/__tests__/session-load-worker.test.ts`) | transcript converges to exactly one `── Session compacted ──` row, with message rows both above and below it |
| F2 | R3 reconnect replay | state-transition (re-entry) | L3 | automated | a session already showing one compaction boundary live | force a bridge reconnect so `replaySessionEntries()` re-forwards the branch | transcript still converges to exactly ONE boundary row — no duplicate divider after the register-time wipe/reset or skip-insert path |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R1 unreadable branch | fault-injection (corrupt input) | L1 | automated | a branch whose `compaction` entry is truncated/partially-parsed garbage alongside valid messages | `replayEntriesAsEvents` | the valid message events are still emitted; the converter does not abort the whole replay over one bad entry |

---

## Coverage summary

- Requirements covered: 3/3 (R1 boundary synthesis, R2 no fabrication, R3 single render)
- Scenarios by class: edge 9 · perf 0 · frontend 2 · error 1
- Scenarios by level: L1 10 · L2 0 · L3 2
- Scenarios by disposition: automated 12 · manual-only 0

## New infra needed

None. Every level already has an exemplar to extend:
`packages/shared/src/__tests__/state-replay.test.ts` (E1–E7, X1),
`packages/client/src/lib/__tests__/event-reducer-compaction.test.ts` (E8),
`packages/server/src/__tests__/event-status-extraction.test.ts` (E9),
`tests/e2e/custom-entry-replay-parity.spec.ts` (F1, F2 — the closest precedent,
same replay-parity shape).
