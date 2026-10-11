## 1. Server: evicted-end record (TDD, design D1)

- [x] 1.1 Add tests to `packages/server/src/__tests__/memory-event-store.test.ts` (exemplar: its `getTrimStats` / `toolExecutionEnd` trim cases):
  - (test-plan #E1) small per-session byte cap; real ends `a`, `b`, a synthesized end `{c, healedBy:"session_ended"}` and a 300-char-id end are all trimmed → `wasToolEndEvicted` true for `a`/`b`, false for `c`, the long id and a never-stored id;
  - (test-plan #E2) all sessions pinned and the global budget exceeded → the `dropNonEssentials` fallback records dropped ends in their own session.

  Verify they fail: `npx vitest run packages/server/src/__tests__/memory-event-store.test.ts`.
- [x] 1.2 Add tests to the same file:
  - (test-plan #E3) 513 ends dropped for one session → record size 512, the first id gone, the last present;
  - (test-plan #E4) after `deleteEventsForSession(s)`, and separately after LRU eviction of `s`, `wasToolEndEvicted(s,"a") === false`;
  - (test-plan #E1b) `a` recorded, then a live top-level start for `a` is ingested via the store's removal hook → `wasToolEndEvicted(s,"a") === false`.

  Verify they fail.
- [x] 1.3 Implement this in `packages/server/src/persistence/memory-event-store.ts`:
  - a bounded insertion-ordered `evictedToolEnds` set on `SessionBuffer` (capacity 512);
  - push to it INSIDE the drop loops wherever `toolEndDropped` is incremented (both `trimBufferToLimit` passes and `dropNonEssentials`), skipping ends with `data.healedBy` and ids over 256 chars;
  - `wasToolEndEvicted(sessionId, toolCallId)` and `forgetEvictedToolEnd(sessionId, toolCallId)` on the store interface.

  Verify the 1.1–1.2 tests pass and `npx tsc --noEmit -p packages/server` exits 0.

## 2. Server: in-flight hint (TDD, design D2)

- [x] 2.1 Write a test (test-plan #E5) in a new `packages/server/src/session/__tests__/in-flight-tool-calls.test.ts` (exemplar: `packages/server/src/session/__tests__/open-tool-calls.test.ts`):
  - start/end of `a`;
  - nested start `n` never in flight;
  - `agent_settled` empties `s` and removes its entry (size probe);
  - `clear(s)` leaves `t`;
  - 257 starts → at most 256 ids held.

  Verify it fails (module missing).
- [x] 2.2 Implement `packages/server/src/session/in-flight-tool-calls.ts` (`observeLive`, `isInFlight`, `clear`; empty sessions removed; cap 256 per session; cleared on `agent_settled`). Verify the 2.1 test passes.
- [x] 2.3 Write a test (test-plan #E6) in event-wiring style (exemplar: `packages/server/src/__tests__/recovery-e2e.test.ts`):
  - a live start for `a`, then `session_register`, then a replayed `tool_execution_end{a}` and a replayed `agent_settled` before `replay_complete` → the hint changes only through the register's `clear`;
  - a session end clears `s`, and so does session removal (`sessionManager.remove`);
  - a live start also calls `forgetEvictedToolEnd` (test-plan #E1b, route side).

  Verify it fails.
- [x] 2.4 Wire the hint in `packages/server/src/event-wiring.ts`:
  - `observeLive` only in the live (non-replaying) event-forward insert branch;
  - on a live top-level start, also call `eventStore.forgetEvictedToolEnd(sessionId, id)`;
  - `clear` on every `session_register`, in `sessionManager.onEnded` after the open-tool heal, and on session removal;
  - expose `isInFlight` through an accessor.

  Verify the 2.3 test passes.

## 3. Server: route status split + health counters (TDD, design D3/D5/D6)

- [x] 3.1 Extend `packages/server/src/__tests__/session-routes-tool-result.test.ts`. Add the new deps to its harness and to every other `registerSessionRoutes` harness (`grep -rln "registerSessionRoutes" packages/server/src`):
  - (test-plan #E7) stored end → `200` (regression guard, passes today);
  - (test-plan #E8) id in the evicted record, with and without `?pending=1` → `410 {error:"result no longer available"}`;
  - (test-plan #E9) evicted record plus a stored end → `200`;
  - (test-plan #E10) in the hint: `?pending=1` → `202 {pending:true}`; no flag, `?pending=true`, `?pending=0` or `?pending=1&pending=1` → `404`;
  - (test-plan #E11) in the hint with the start trimmed → `202`;
  - (test-plan #E12) unknown session → `404`, and an owner-gate-rejected principal never gets `410`/`202`.

  Verify that E8, E10 (`202` row) and E11 fail. E7, E9 and E12(a) already pass and act as regression guards.
- [x] 3.2 Write a test (test-plan #E13) in `packages/server/src/__tests__/health-shape.test.ts` (exemplar: its `storeTrim` assertions): after one `202` and one `410`, `toolResult` deep-equals `{pending:1, gone:1}` and prior fields are unchanged. Verify it fails.
- [x] 3.3 Implement the route in `packages/server/src/routes/session-routes.ts`:
  - deps `wasToolEndEvicted` (store), `isInFlight` (accessor from 2.4), `toolResultStats` sink;
  - D5 order after the existing `networkGuard` and `gateHttpSession`;
  - `pending === "1"` exactly.

  Wire it in `packages/server/src/server.ts`, and add `toolResult` to `/api/health` in `packages/server/src/routes/system-routes.ts`. Verify the 3.1–3.2 tests pass and `npx tsc --noEmit -p packages/server` exits 0.

## 4. Client (TDD, design D4/D7)

- [x] 4.1 Write a test (test-plan #E20) in `packages/client/src/lib/__tests__/event-reducer.stuck-tool-baseline.test.ts` (exemplar: its superseded-heal cases):
  - a `healedBy:"result_evicted"` synth finalizes only a `running` row;
  - a later real end overwrites it;
  - a second synth is ignored.

  Verify it fails (helper missing).
- [x] 4.2 Add `synthesizeEvictedEnd(toolCallId, now)` and its sentinel ("result no longer available") next to `synthesizeSupersededEnd` in `packages/client/src/lib/chat/event-reducer.ts`. Verify the 4.1 test passes and `npx vitest run packages/client/src/lib` passes.
- [x] 4.2b Write a test (test-plan #E22) in `packages/client/src/components/__tests__/ToolCallStep.test.tsx` (exemplar: its superseded-badge case): a row with `healedBy:"result_evicted"` renders the eviction badge, with text distinct from the superseded badge. Verify it fails, then extend `packages/client/src/components/chat/ToolCallStep.tsx` (~`:100`, `isSuperseded`) with the eviction badge, and verify it passes.
- [x] 4.3 Extend `packages/client/src/hooks/__tests__/useStaleToolReconcile.test.ts` (exemplar: its mocked-fetch tick tests):
  - (test-plan #E14) the URL ends `?pending=1`;
  - (test-plan #E15) `202 {pending:true}` ×3 with no later inference → `running`, no end reduced;
  - (test-plan #E16) `410` → `complete`, `healedBy:"result_evicted"` on the same tick, heal counter +1, no further fetch;
  - (test-plan #E17) `404` ×2 plus a later inference → superseded (unchanged);
  - (test-plan #E18) `202` ×10 with no later inference → never healed;
  - (test-plan #E19) `202` ×2 plus a later inference → superseded.

  Verify the new cases fail.
- [x] 4.4 Implement this in `packages/client/src/hooks/useStaleToolReconcile.ts`:
  - send `?pending=1`;
  - before the `res.ok` test, branch `202` → count like a 404 and re-arm, `410` → dispatch `synthesizeEvictedEnd`, bump the heal counter, label it in the console warning;
  - then `200` apply, else count a 404.

  Verify the 4.3 tests pass.
- [x] 4.5 Write a test (test-plan #E21) in `packages/client/src/hooks/__tests__/useToolFullResult.test.ts` (exemplar: its 404 case): `410 {error:"result no longer available"}` and `404 {error:"tool call still in flight or unknown"}` both give `error === t("tool.resultEvicted")`. Verify it fails, then map `404`/`410` to `tool.resultEvicted` ahead of the `body.error` fallback in `packages/client/src/hooks/useToolFullResult.ts`, and verify it passes.

## 5. Close-out

- [x] 5.1 Run `openspec validate distinguish-tool-result-pending-vs-gone --strict` and verify it prints "is valid".
- [x] 5.2 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|Tests +[0-9]+ failed' /tmp/pi-test.log`. Verify exit 0 and no hits.
- [x] 5.3 Update the DOX records with `See change: distinguish-tool-result-pending-vs-gone`:
  - the new `in-flight-tool-calls.ts` row in `packages/server/src/session/AGENTS.md`;
  - the records for `memory-event-store.ts`, `event-wiring.ts`, `session-routes.ts`, `system-routes.ts`, `useStaleToolReconcile.ts`, `useToolFullResult.ts`, `event-reducer.ts` and `ToolCallStep.tsx`.

  Delegate the `docs/` route-contract prose to DocScribe. Verify `git grep -l distinguish-tool-result-pending-vs-gone -- '*AGENTS.md' docs/` lists each record and the DocScribe-edited doc.
- [ ] 5.4 Manual (test-plan: manual-only, #F1), non-gating, after deploy. In the running dashboard, a session runs `sleep 60`. Check:
  - DevTools probes answer `202 {pending:true}`;
  - no red tool-result rows;
  - `/api/health` `toolResult.pending` grows.

  Paste the `toolResult` JSON from `/api/health` and a DevTools screenshot into the PR.
- [x] 5.5 Run the `review-code` skill on the diff, then `npm run quality:changed`. Verify there are no unresolved blocker/major findings and the quality check exits 0.
