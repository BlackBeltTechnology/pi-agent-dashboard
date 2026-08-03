# Test Plan — compact-warm-replay-stream

Stage: apply   Generated: 2026-07-25

## ⚠ Clarifications needed (3)

- [ ] **C1** — P1/P2 threshold: the spec fixes no numeric replay budget. Design says "same order of magnitude as the cold path (~20 batches, < 1 s)". Is the gate (a) wall-clock `< 1 s` on localhost, (b) a byte budget `< 15 MB` for the #399 fixture session, or (c) an event-count ratio `compacted ≤ 2× cold-load count`? A wall-clock gate on the docker harness is flaky; (b)/(c) are deterministic. Blocks P1, P2.
- [ ] **C2** — F3 observable: when a browser subscribes mid-turn and the streaming tail is preserved, what is the exact convergence invariant — `streamingText` equals the last update's joined text, or the rendered assistant row's text content? The spec says "renders the live streaming text" without naming the observable. Blocks F3.
- [ ] **X3** — subagent interleave: does any producer emit a raw `message_update` between a parent `message_start` and a parent `message_end` (bridge forwards subagent inner timelines into the parent buffer)? Design D1 names this as the rule-narrowing trigger but the spec asserts no behaviour for it. Answer decides whether X3 is a passing guard or a rule change.

> Resolve before the blocked scenarios (marked below) can be authored.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Drops superseded updates | EP (valid class) | L1 | automated | window `[start(1), update(2..501), end(502)]` | `compactEventsForReplay(window)` | returns exactly `[seq 1, seq 502]`; zero `message_update` |
| E2 | Drops superseded updates | BVA (min) | L1 | automated | window `[start(1), update(2), end(3)]` — single update | compact | returns `[1, 3]` |
| E3 | Drops superseded updates | BVA (empty) | L1 | automated | `[]` | compact | returns `[]`, no throw |
| E4 | Drops superseded updates | BVA (no end at all) | L1 | automated | `[start(1), update(2..20)]` | compact | returns all 20 events unchanged |
| E5 | Non-message passthrough | decision-table | L1 | automated | window mixing `tool_execution_start/end`, `turn_start/end`, `stats_update`, `session_compact`, `subagent_*` around a finalized message | compact | every non-`message_update` event present, original relative order preserved |
| E6 | Idempotence | EP | L1 | automated | `compact(w)` | `compact(compact(w))` | deep-equal to `compact(w)` |
| E7 | Seq preservation | BVA | L1 | automated | seqs 1..100, seqs 3..98 = updates of a message ended at 99 | compact | output seqs are exactly `[1,2,99,100]`; no surviving event's `seq` mutated |
| E8 | Seq preservation | state-transition (illegal edge) | L1 | automated | window whose FIRST event is a bare `message_end` (subscribe started mid-message, no matching `start`) | compact | no throw; all preceding events kept; `message_end` kept |
| E9 | Streaming tail | decision-table | L1 | automated | `[M1 start/updates/end, M2 start, M2 updates(12), no M2 end]` | compact | M1 updates dropped; all 12 M2 updates kept |
| E10 | Batch size | BVA | L1 | automated | compacted window of exactly 200 events | `sendEventBatches` | 1 batch, `isLast: true` |
| E11 | Batch size | BVA (just above) | L1 | automated | 201 events | `sendEventBatches` | 2 batches; sizes 200 + 1; only the 2nd has `isLast: true` |
| E12 | Batch size | BVA (1000) | L1 | automated | 1000 events | `sendEventBatches` | exactly 5 batches |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Compaction reduces replay | threshold | L3 | automated | #399-shaped fixture session (~20k stored events) subscribed cold via the docker harness (port from `.pi-test-harness.json`) | [NEEDS CLARIFICATION: metric+threshold — see C1] | single subscribe |
| P2 | Compaction reduces replay | ratio | L1 | automated | 20k synthetic events, 93% superseded updates | compacted count ≤ 2× the count `state-replay.ts` produces for the same messages | single call |
| P3 | Compaction cost | micro-perf (timed) | L1 | automated | 20k-event window | `compactEventsForReplay` p95 < 50 ms, single O(n) pass, allocates one output array | 20 iterations |
| P4 | No memory regression | soak | L2 | automated | 10 consecutive cold subscribes to the large fixture | server RSS returns to within +10% of pre-test baseline after GC settle | 10 min |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | SessionState equivalence | state-convergence | L1 | automated | plain assistant message stream | reduce raw vs reduce compacted | `deepEqual(stateRaw, stateCompacted)` |
| F2 | SessionState equivalence | state-convergence | L1 | automated | `[text, toolCall, text]` message (`streamingTextFlushed` reorder path) | reduce raw vs compacted | deep-equal, including message order and no resurrected `text1` |
| F3 | Streaming tail | state-convergence | L3 | automated | browser subscribes while assistant message M is mid-stream | replay completes, then live updates resume | [NEEDS CLARIFICATION: observable — see C2] |
| F4 | SessionState equivalence (thinking) | decision-table | L1 | automated | thinking-bearing message: `thinking_start/delta/end` on updates + inline `thinking` blocks on `message_end` | reduce raw vs compacted under BOTH policies (drop-thinking / exempt-thinking) | exactly one policy yields deep-equal state incl. row content, order, `streamedLive`; that policy is the shipped one (D2) |
| F5 | Reset rule unaffected | state-transition | L3 | automated | large session, cold subscribe, seq gaps present in every batch | client processes batches | no `shouldReset` misfire; final message count equals the pre-change render |
| F6 | Reasoning rows on replay | state-transition | L3 | automated | session with a long reasoning block, reopened | subscribe replay | thinking row present and collapsed exactly as before the change |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Pre-compaction high-water mark | fault-injection (dropped tail) | L1 | automated | window whose highest-seq event (100) is a `message_update` that compaction drops | subscribe replay completes | `clearReplaying` called with `100`, not with the last surviving seq |
| X2 | Catch-up not duplicated | state-transition | L1 | automated | events 229..231 arrive during replay of 1..228, where 228 is compaction-dropped | replay completes | catch-up batch contains exactly 229..231; no event ≤228 re-sent |
| X3 | Positional rule safety | fault-injection (interleave) | L1 | automated | subagent-interleaved window: parent `start`, subagent `message_update`, parent `end` | compact + reduce | [NEEDS CLARIFICATION: expected — see X3/C3; either "subagent update preserved" (rule narrows) or "drop is state-equivalent"] |
| X4 | Socket closes mid-replay | fault-injection (abort) | L1 | automated | `ws.readyState !== OPEN` after batch 2 | `sendEventBatches` | returns `0`, stops sending, no unhandled rejection |
| X5 | Backpressure path still works | fault-injection (delay) | L1 | automated | `bufferedAmount` pinned above 1 MB for 3 polls | `sendEventBatches` with 200-event batches | send pauses then resumes; all batches eventually delivered in order |
| X6 | Warm delta unaffected | state-transition | L1 | automated | `lastSeq > 0` delta window containing only tool events | subscribe | identical batches to pre-change behaviour; `markReplaying` called once |
| X7 | Empty window | state-transition (illegal edge) | L1 | automated | store exists, zero events in range | subscribe | `markReplaying` NOT called; single `event_replay { events: [], isLast: true }` |

---

## Coverage summary

- Requirements covered: 5/5 (all `replay-stream-compaction` requirements + the modified `incremental-event-sync` suppression requirement)
- Scenarios by class: edge 12 · perf 4 · frontend 6 · error 7 (29 total)
- Scenarios by level: L1 23 · L2 1 · L3 5
- Scenarios by disposition: automated 29 · manual-only 0
- Blocked by clarification: P1 (C1), F3 (C2), X3 (C3)

## New infra needed

- A large-session fixture (~20k stored events / #399 shape) usable by both L1 (synthetic builder) and L3 (docker harness seed). L1 builder is cheap; the L3 seed needs a `.jsonl` fixture checked in or generated at harness start — flag for the apply phase.
- P4 (RSS soak) needs an L2 memory probe; `qa/` has no RSS-sampling helper today.
