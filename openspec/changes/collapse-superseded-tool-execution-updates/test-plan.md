# Test Plan — collapse-superseded-tool-execution-updates

Stage: design   Generated: 2026-08-09

Two HARD-gate clarifications were raised and resolved before this catalog was
written; no `[NEEDS CLARIFICATION]` markers remain.

- **P1 observable** → a per-insert "entries examined" probe counter, asserted
  `≤ K` independent of buffer length. This is NEW instrumentation the
  implementation must add; without it the find-cost bound has no observable.
- **P2 threshold** → structural (retained updates per `toolCallId` ≤ 2 AND
  `collapsedUpdates > 0`), not a heap-bytes threshold. Heap figures are recorded
  as evidence, not asserted as a gate.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Collapse retains newest | state-transition | L1 | automated | buffer with `tool_execution_start` t1 @seq1 + subsuming updates t1 @seq2,3,4 | insert subsuming update t1 @seq5 | exactly one non-pinned update for t1 remains; it is seq5; seq1 still present |
| E2 | Subsumption — key presence | decision-table | L1 | automated | retained update t1 whose details carry `agentSessionId` | insert update t1 omitting `agentSessionId` | both retained; `collapsedUpdates` does not increment |
| E3 | Subsumption — empty entries | decision-table | L1 | automated | retained update t1 with `details.entries` length 3 | insert update t1 with `details.entries: []` | both retained |
| E4 | Subsumption — type equality | decision-table | L1 | automated | retained update t1 with `details.activity: "thinking"` (string) | insert update t1 with `details.activity: 123` (number) | both retained — key present but type-downgraded is not subsumption |
| E5 | Subsumption — result source | decision-table | L1 | automated | retained update t1 with `partialResult: "running…"` (plain string) | insert update t1 with structured `partialResult` carrying `details` but no `content` | both retained — successor sets no rendered result |
| E6 | Per-toolCallId isolation | EP | L1 | automated | interleaved subsuming updates for t1 and t2 | insert all | newest retained for t1 AND for t2; neither collapses the other |
| E7 | Fail-open on missing key | BVA | L1 | automated | buffer holding updates for t1 | insert `tool_execution_update` with no `data.toolCallId` | it is retained; no other event removed |
| E8 | Placeholder escapes collapse | BVA | L1 | automated | updates for t1 whose data exceeds the ceiling and is unreducible → `{__truncated}` (no `toolCallId`) | insert a run of them | none collapse; `collapsedUpdates` stays 0 — collapse is conditional on reducibility |
| E9 | Pin vs gate conflict | decision-table | L1 | automated | t1 whose only retained update is the entry-creating one | insert a subsuming update for t1 | creating update still retained AND new update retained (two-pointer index) |
| E10 | Creating-tick value fidelity | state-transition | L1 | automated | creating update t1 with `subagentType: "Explore"`, `description: "d1"` | insert many subsuming updates carrying `subagentType: "Other"` | creating update present; folded entry `type === "Explore"`, `description === "d1"` — by value |
| E11 | Non-update types untouched | EP | L1 | automated | buffer with `message_start`/`message_end`/`tool_execution_start`/`tool_execution_end` | run collapse | none dropped by the collapse policy |
| E12 | Details resolution source | EP | L1 | automated | retained update t1; incoming update carrying top-level `data.details` but no `partialResult` | insert it | `data.details` is NOT used to resolve subsumption; predecessor is not dropped on its strength |
| E13 | Max-seq invariant | BVA | L1 | automated | buffer whose highest-seq event is a `tool_execution_update` | run collapse | `getMaxSeq` returns that seq, unchanged |
| E14 | Broadcast re-read | state-transition | L1 | automated | update that supersedes an earlier one | read back by the `seq` `insertEvent` returned | `getEvent(sessionId, seq)` returns that event |
| E15 | Essential head under flood | BVA | L1 | automated | session whose first events are `message_start`/`message_end`, cap driven past limit | insert a subagent flood with collapse enabled | essential head present; buffer length ≤ `cap + TRIM_SLACK` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Find cost not O(buffer length) | threshold + instrumentation | L1 | automated | large non-update tail (≥ 5 000 events), then many subsuming updates interleaved across ≥ 50 distinct `toolCallId`s | per-insert "entries examined" probe ≤ K, constant as buffer length grows 100 → 20 000 | per-insert, whole run |
| P2 | Collapse fires in production shape | threshold | L3 | automated | a real dashboard session that spawns a subagent producing sustained `tool_execution_update` ticks | retained `tool_execution_update` per `toolCallId` ≤ 2 AND `/api/health` `storeTrim.collapsedUpdates` > 0 | one subagent run |
| P3 | Buffer stays bounded | soak | L1 | automated | 10 000 updates across many `toolCallId`s plus trim pressure | buffer length ≤ `cap + TRIM_SLACK` at every observable point | whole run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Replay equivalence | state-convergence | L1 | automated | update-only subsequence for one `toolCallId` containing a tick omitting `agentSessionId`, one with empty `entries`, one with no extractable `content`, and a plain-string→structured pair; NO terminal `tool_execution_end` carrying `result`/`details` | fold full sequence and collapsed subset through the real client reducer | `result`, `toolDetails` and `subagents` entries converge equal; `type`/`description` equal BY VALUE; entry reachable under both agent id and `agentSessionId` |
| F2 | Anti-vacuity of F1 | mutation check | L1 | automated | the F1 fixture | remove the subsumption gate, then remove creating-tick pinning | F1 FAILS in both mutations — a uniform-full-snapshot fixture does not satisfy this |
| F3 | Completed subagent after refresh | state-transition | L3 | automated | a completed subagent run in a session | reload the dashboard page and expand the subagent card | timeline renders; no "Subagent not found" placeholder |
| F4 | Live cadence preserved | state-convergence | L3 | automated | a running subagent | observe the timeline over a 10 s window | timeline advances ≥ 2 distinct states in the window (collapse is retention-only, ticks still broadcast) |
| F5 | Streaming feels no less responsive | visual/subjective | — | manual-only | dashboard with a live subagent | human watches the streaming view | [judgment: "no perceptible regression in smoothness" — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Trim removed the pinned/retained update | fault-injection (concurrent policy) | L1 | automated | per-session trim drops the retained update for t1 (updates are non-essential) | insert a later update for t1 against the now-stale index entry | lookup resolves to nothing; no-op collapse; NO other event removed; `getMaxSeq` unchanged |
| X2 | Negative-index guard | fault-injection | L1 | automated | index entry whose seq is absent from the buffer | run collapse | an unresolved lookup never reaches array removal; the buffer's last element is NOT deleted |
| X3 | Index lifetime | fault-injection (evict) | L1 | automated | many sessions cycled through LRU eviction and `deleteEventsForSession` | measure index size after the cycle | index released with each buffer; no per-`toolCallId` residue for evicted sessions |
| X4 | Evict-then-reingest | state-transition | L1 | automated | session evicted, then re-ingested with the same `toolCallId` | insert an update | no action taken on any entry left from the previous residency |
| X5 | Health payload additivity | fault-injection (shape) | L1 | automated | `/api/health` request | serialize `storeTrim` | new counter present; every pre-existing `storeTrim` field present with original name and type |
| X6 | Health fallback shape | fault-injection (absent dep) | L1 | automated | `eventStore` absent so the `??` fallback literal is taken | request `/api/health` | fallback satisfies the store's `TrimStats` type — a new required field cannot be silently omitted |
| X7 | Late update after end | state-transition | L1 | automated | `tool_execution_end` for t1 already stored | insert a late/reordered `tool_execution_update` for t1 | policy applies unchanged; no corruption; `getMaxSeq` unchanged |

---

## Coverage summary

- Requirements covered: 2/2 spec requirements; all 17 spec scenarios mapped
- Scenarios by class: edge 15 · perf 3 · frontend 5 · error 7
- Scenarios by level: L1 24 · L2 0 · L3 3 · manual-only 1
- Scenarios by disposition: automated 29 · manual-only 1

## New infra needed

- **P1 probe counter** — a per-insert "entries examined" counter on the store,
  test-visible. Does not exist; without it P1 has no observable. It is
  instrumentation for the test, distinct from the `collapsedUpdates` telemetry
  counter, and should not be conflated with it.
- **P2 subagent-producing e2e fixture** — an L3 spec that drives a real session
  spawning a subagent with sustained ticks, then reads `/api/health` at the
  harness port derived from `.pi-test-harness.json` (`dashboardPort`), never a
  hardcoded `:18000`. Check `tests/e2e/` for an existing subagent-spawning spec
  to extend before authoring a new one.
- No new test LEVEL is required — L1 vitest and L3 Playwright both exist.
