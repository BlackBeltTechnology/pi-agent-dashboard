## 1. Lock the baseline (performance-optimization: measure first)

- [x] 1.1 Capture `/api/health` `server.heapUsed` / `rss` / `activeSessions` on a server that has run real subagent work, sampling every 10 s for ≥ 60 s. Record the GC floor, not a single reading.
- [x] 1.2 Promote the CDP probe from `/tmp/heap-probe*.mjs` into `scripts/`: `SIGUSR1` the server pid, connect CDP, `Runtime.queryObjects` on `Array.prototype`, report `{seq,event}` buffers ranked by estimated bytes with a per-event-type breakdown. NEVER restart the server to investigate — a restart destroys the evidence. Document in the header that this opens `127.0.0.1:9229` until the next restart.
- [x] 1.3 Record, per fat buffer: event count, avg bytes/event, and the `tool_execution_update` share. These are the before-numbers; per the P2 decision they are EVIDENCE, not a pass/fail gate.

## 2. Collapse policy in the store (D1, D5, D7)

- [x] 2.1 Implement the subsumption predicate: resolve details as `data.partialResult.details` ONLY (never top-level `data.details`); neither-has-details ⇒ subsume; else require same-key-set with same JS value types, non-empty `entries` not replaced by empty, and "sets rendered result" preserved across BOTH sources (extractable `partialResult.content` text OR non-object `partialResult`).
- [x] 2.2 Implement creating-tick pinning: the first update per `toolCallId` carrying `details.agentId` is retained and never collapsed.
- [x] 2.3 Wire collapse into `insertEvent`, ordered AFTER `truncateEventData` and BEFORE `trimBufferToLimit` / `evictIfNeeded`.
- [x] 2.4 Implement fail-open: an update with no `data.toolCallId` (including a `{__truncated}` placeholder) is retained and collapses nothing.

## 3. Index and invariants (D4, D6)

- [x] 3.1 Add the per-buffer index as `Map<toolCallId, { creatingSeq, newestSeq }>` — two independent pointers, keyed by seq, NEVER by array position.
- [x] 3.2 Implement the verified lookup: confirm the located entry exists, is a `tool_execution_update`, and carries the same `toolCallId` before removal. A miss is a no-op. A negative/unresolved index must never reach array removal.
- [x] 3.3 Locate the entry by scanning BACKWARD from the tail or by binary search on `seq`. A forward linear scan (the shape `getEvent` uses) is forbidden — it is the O(buffer length) path.
- [x] 3.4 Release the index with its buffer in `evictIfNeeded` and `deleteEventsForSession`, so it cannot accumulate an entry per `toolCallId` of every evicted session.
- [x] 3.5 Add the per-insert "entries examined" probe counter that P1 asserts against. Keep it distinct from the `collapsedUpdates` telemetry counter — they answer different questions.

## 4. Instrumentation and health wiring (D9)

- [x] 4.1 Add the cumulative `collapsedUpdates` counter to `getTrimStats()`, mirroring `trimmedEventsTotal` / `evictedSessionsTotal` (never reset on read).
- [x] 4.2 Derive the health route's store-stats annotation (`system-routes.ts:122-124`) from the store's exported `TrimStats` instead of restating it inline.
- [x] 4.3 Give the `?? { … }` fallback literal (`system-routes.ts:569-572`) an explicit `TrimStats` annotation — `a ?? b` does NOT check `b` against `A`, so without this a new required field is silently omitted.
- [x] 4.4 Update the exact-shape `toEqual` assertion at `memory-event-store.test.ts:540` for the additive field.

## 5. L1 store tests — folded from the manifest

- [x] 5.1 Newest-wins for one tool call: buffer with `tool_execution_start` t1 @seq1 + subsuming updates @seq2,3,4 · insert subsuming update @seq5 · exactly one non-pinned update for t1 remains, it is seq5, seq1 still present (test-plan #E1) — see `packages/server/src/__tests__/memory-event-store.test.ts`
- [x] 5.2 Non-subsuming on missing key: retained update carrying `agentSessionId` · insert update omitting it · both retained, `collapsedUpdates` does not increment (test-plan #E2) — see `memory-event-store.test.ts`
- [x] 5.3 Non-subsuming on empty entries: retained update with `details.entries` length 3 · insert update with `entries: []` · both retained (test-plan #E3) — see `memory-event-store.test.ts`
- [x] 5.4 Non-subsuming on type downgrade: retained update with `details.activity: "thinking"` · insert update with `details.activity: 123` · both retained (test-plan #E4) — see `memory-event-store.test.ts`
- [x] 5.5 Non-subsuming on lost result source: retained update with plain-string `partialResult` · insert structured update carrying `details` but no `content` · both retained (test-plan #E5) — see `memory-event-store.test.ts`
- [x] 5.6 Per-toolCallId isolation: interleaved subsuming updates for t1 and t2 · insert all · newest retained for each, neither collapses the other (test-plan #E6) — see `memory-event-store.test.ts`
- [x] 5.7 Fail-open on missing toolCallId: buffer holding t1 updates · insert update with no `data.toolCallId` · it is retained, no other event removed (test-plan #E7) — see `memory-event-store.test.ts`
- [x] 5.8 Placeholder escapes collapse: over-ceiling unreducible updates reduced to `{__truncated}` (no `toolCallId`) · insert a run · none collapse, `collapsedUpdates` stays 0 (test-plan #E8) — see `memory-event-store.test.ts`
- [x] 5.9 Pin vs gate conflict: t1 whose only retained update is the creating one · insert a subsuming update · BOTH retained, proving the two-pointer index (test-plan #E9) — see `memory-event-store.test.ts`
- [x] 5.10 Non-update types untouched: buffer with `message_start`/`message_end`/`tool_execution_start`/`tool_execution_end` · run collapse · none dropped by the collapse policy (test-plan #E11) — see `memory-event-store.test.ts`
- [x] 5.11 Details resolution source: retained update t1 · insert update carrying top-level `data.details` but no `partialResult` · `data.details` is not used for subsumption, predecessor not dropped on its strength (test-plan #E12) — see `memory-event-store.test.ts`
- [x] 5.12 Max-seq invariant: buffer whose highest-seq event is a `tool_execution_update` · run collapse · `getMaxSeq` returns that seq unchanged (test-plan #E13) — see `memory-event-store.test.ts`
- [x] 5.13 Broadcast re-read: update that supersedes an earlier one · read back by the `seq` `insertEvent` returned · `getEvent(sessionId, seq)` returns it (test-plan #E14) — see `memory-event-store.test.ts`
- [x] 5.14 Essential head under flood: session whose first events are `message_start`/`message_end` · insert a subagent flood past the cap with collapse enabled · essential head present and buffer length ≤ `cap + TRIM_SLACK` (test-plan #E15) — see `memory-event-store.test.ts`
- [x] 5.15 Find cost is not O(buffer length): large non-update tail (≥ 5 000 events) then many subsuming updates interleaved across ≥ 50 distinct `toolCallId`s · per-insert "entries examined" probe ≤ K, constant as buffer grows 100 → 20 000 (test-plan #P1) — see `memory-event-store.test.ts`
- [x] 5.16 Buffer stays bounded: 10 000 updates across many `toolCallId`s plus trim pressure · buffer length ≤ `cap + TRIM_SLACK` at every observable point (test-plan #P3) — see `memory-event-store.test.ts`
- [x] 5.17 Trim removed the retained update: per-session trim drops the retained update for t1 · insert a later update against the stale index entry · no-op collapse, NO other event removed, `getMaxSeq` unchanged (test-plan #X1) — see `memory-event-store.test.ts`
- [x] 5.18 Negative-index guard: index entry whose seq is absent from the buffer · run collapse · unresolved lookup never reaches array removal, the buffer's LAST element is not deleted (test-plan #X2) — see `memory-event-store.test.ts`
- [x] 5.19 Index lifetime: cycle many sessions through LRU eviction and `deleteEventsForSession` · measure index size after · index released with each buffer, no residue for evicted sessions (test-plan #X3) — see `memory-event-store.test.ts`
- [x] 5.20 Evict-then-reingest: session evicted then re-ingested with the same `toolCallId` · insert an update · no action taken on any entry from the previous residency (test-plan #X4) — see `memory-event-store.test.ts`
- [x] 5.21 Late update after end: `tool_execution_end` for t1 already stored · insert a late/reordered update for t1 · policy applies unchanged, no corruption, `getMaxSeq` unchanged (test-plan #X7) — see `memory-event-store.test.ts`

## 6. L1 client-reducer tests — folded from the manifest

- [x] 6.1 Replay equivalence: update-only subsequence for one `toolCallId` containing a tick omitting `agentSessionId`, one with empty `entries`, one with no extractable `content`, and a plain-string→structured pair, with NO terminal `tool_execution_end` carrying `result`/`details` · fold full sequence and collapsed subset through the real reducer · `result`, `toolDetails`, `subagents` converge equal, `type`/`description` equal BY VALUE, entry reachable under both agent id and `agentSessionId` (test-plan #F1) — see `packages/client/src/lib/__tests__/event-reducer.replay-idempotency.test.ts`
- [x] 6.2 Anti-vacuity of the equivalence test: take the 6.1 fixture · remove the subsumption gate, then remove creating-tick pinning · 6.1 FAILS in both mutations. A uniform-full-snapshot fixture does not satisfy this and must be rejected in review (test-plan #F2) — see `event-reducer.replay-idempotency.test.ts`
- [x] 6.3 Creating-tick value fidelity: creating update with `subagentType: "Explore"`, `description: "d1"` · insert many subsuming updates carrying `subagentType: "Other"` · creating update present and folded entry keeps `type === "Explore"`, `description === "d1"` by value (test-plan #E10) — see `event-reducer.replay-idempotency.test.ts`

## 7. L1 health-route tests — folded from the manifest

- [x] 7.1 Health payload additivity: request `/api/health` · serialize `storeTrim` · new counter present AND every pre-existing field present with original name and type (test-plan #X5) — see `packages/server/src/__tests__/health-shape.test.ts`
- [x] 7.2 Health fallback shape: `eventStore` absent so the `??` fallback literal is taken · request `/api/health` · fallback satisfies `TrimStats`, so a new required field cannot be silently omitted (test-plan #X6) — see `health-shape.test.ts`

## 8. L3 Playwright tests — folded from the manifest

- [x] 8.1 Completed subagent after refresh: a completed subagent run · reload the page and expand the subagent card · timeline renders, no "Subagent not found" placeholder (test-plan #F3) — see `tests/e2e/subagent-inspector.spec.ts`
- [x] 8.2 Live cadence preserved: a running subagent · observe the timeline over a 10 s window · it advances ≥ 2 distinct states, proving collapse is retention-only (test-plan #F4) — see `tests/e2e/subagent-detail-dialog.spec.ts`
- [x] 8.3 Collapse fires in production shape: a real session spawning a subagent with sustained ticks · read `/api/health` at the harness port from `.pi-test-harness.json` (`dashboardPort`, never a hardcoded `:18000`) · retained updates per `toolCallId` ≤ 2 AND `storeTrim.collapsedUpdates` > 0 (test-plan #P2) — see `tests/e2e/subagent-inspector.spec.ts`

## 9. Manual verification (deferred post-merge by ship-change)

- [x] 9.1 Watch the streaming subagent view during a live run and confirm no perceptible regression in smoothness (test-plan: manual-only)

## 10. Verify, review, document

- [x] 10.1 Re-run the probe from 1.2 against the built change and record the new numbers beside the 1.3 baseline as evidence.
- [x] 10.2 `review-code` pass over the diff; `insertEvent` is the choke point every ingress funnels through, so scrutinise ordering against the existing shed policies.
- [x] 10.3 Update the `memory-event-store.ts` purpose row in `packages/server/src/persistence/AGENTS.md` with a `See change:` reference.
- [x] 10.4 If any `docs/` prose is needed, delegate to DocScribe (caveman style) — do not edit `docs/` directly.
- [x] 10.5 File the deferred follow-ups as their own changes: bridge-side bandwidth reduction (with its UX trade); the `subagent_started` / `subagent_*` full-`details` payload (~55 MB measured); and dropping a completed call's final update on `tool_execution_end` (gated on verifying live-end `details` equivalence across producer versions).
