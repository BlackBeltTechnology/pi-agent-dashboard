## 1. Lock the baseline (performance-optimization: measure first)

- [ ] 1.1 Capture `/api/health` `server.heapUsed` / `rss` / `activeSessions` on a
      server that has run real subagent work, sampling every 10 s for ≥ 60 s.
      Record the GC floor, not a single reading — the floor is the number this
      change must move.
- [ ] 1.2 Save `scripts/heap-probe.mjs` (from the investigation, currently in
      `/tmp`): `SIGUSR1` the server pid, connect CDP, `Runtime.queryObjects` on
      `Array.prototype`, and report `{seq,event}` buffers ranked by estimated
      bytes with a per-event-type breakdown. NEVER restart the server to
      investigate — a restart destroys the evidence.
- [ ] 1.3 Record, per fat buffer: event count, avg bytes/event, and the
      `tool_execution_update` share. These are the before-numbers the
      verification step compares against.
- [ ] 1.4 Note the inspector opens `127.0.0.1:9229` and stays open until the next
      restart; document that in the probe script header.

## 2. Collapse policy in the store (D1, D5, D6)

- [ ] 2.1 Write the failing tests FIRST, from the delta spec scenarios:
      newest-wins for one `toolCallId`, independence across `toolCallId`s,
      no-`toolCallId` retained, non-update types untouched.
- [ ] 2.2 Add a per-buffer `Map<toolCallId, seq|index>` to `SessionBuffer` so
      collapse is amortized O(1) (D6). Confirm the map is dropped together with
      its buffer on LRU evict and on `deleteEventsForSession` — it must not
      outlive the buffer.
- [ ] 2.3 Implement collapse inside `insertEvent`, ordered AFTER
      `truncateEventData` and BEFORE `trimBufferToLimit` / `evictIfNeeded`, so it
      composes with the existing shed policies instead of racing them.
- [ ] 2.4 Assert the fail-open branch: an update with no `data.toolCallId` is
      retained and drops nothing.
- [ ] 2.5 Verify all four tests from 2.1 fail before the implementation and pass
      after.

## 3. Protect the load-bearing invariants (D2, D3, D4)

- [ ] 3.1 Test: `getEvent(sessionId, seq)` returns the just-inserted update for
      the `seq` that `insertEvent` returned (the broadcast re-read path, D2).
- [ ] 3.2 Test: `getMaxSeq` is unchanged by collapse when the newest buffer event
      is a `tool_execution_update` (D4).
- [ ] 3.3 Test: the newest update per `toolCallId` survives even after a
      `tool_execution_end` for the same call is inserted (D3) — the regression
      that would blank completed subagent cards.
- [ ] 3.4 Reducer-level equivalence test: fold the uncollapsed sequence and the
      collapsed sequence through the real client event reducer and assert equal
      message `result`, `toolDetails`, and `subagents` entries. This is the test
      that fails if a future change makes the reducer accumulate instead of
      assign.
- [ ] 3.5 Confirm each test in this group fails on a deliberate revert of the
      behaviour it guards — a guard that cannot fail proves nothing.

## 4. Instrumentation (observability-instrumentation)

- [ ] 4.1 Add the cumulative collapsed-update counter to `getTrimStats()`,
      mirroring `trimmedEventsTotal` / `evictedSessionsTotal` (never reset on
      read).
- [ ] 4.2 Test the counter increments only for collapse, independently of the
      trim and eviction counters.
- [ ] 4.3 Note in the store's `AGENTS.md` row that `getTrimStats()` now carries a
      third shed counter.

## 5. Verify against the baseline (performance-optimization: re-measure)

- [ ] 5.1 Restart the server on the built change, drive real subagent work
      comparable to the baseline capture, and re-run the probe from 1.2.
- [ ] 5.2 Assert the `tool_execution_update` share of each fat buffer collapses to
      ~one event per `toolCallId`, and record the new heap floor against 1.1.
- [ ] 5.3 Assert the collapsed counter is NON-ZERO on that real run. A zero
      counter with a green unit suite means the policy never fired in production
      — treat it as a failed verification, not a pass.
- [ ] 5.4 UI check: with a subagent running, confirm the live timeline still
      ticks at its normal cadence (retention-only change, D2) and that a
      completed subagent still renders its timeline after a page refresh (D3).

## 6. Review and document

- [ ] 6.1 `review-code` pass over the diff; `insertEvent` is the choke point every
      ingress funnels through, so scrutinise ordering against the existing shed
      policies.
- [ ] 6.2 Update the `memory-event-store.ts` purpose row in
      `packages/server/src/persistence/AGENTS.md` with a `See change:` reference.
- [ ] 6.3 If any `docs/` prose is needed, delegate to DocScribe (caveman style) —
      do not edit `docs/` directly.
- [ ] 6.4 File the deferred follow-ups as their own changes: bridge-side
      bandwidth reduction (with its UX trade), and the `subagent_started` /
      `subagent_*` full-`details` payload (~55 MB measured).
