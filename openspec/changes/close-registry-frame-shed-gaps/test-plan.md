# Test Plan — close-registry-frame-shed-gaps

Stage: design   Generated: 2026-06-12

All Triples resolved concretely; the one spec gap found (a reconciled `session_added`
carrying an already-ended record vs `endedTotals`) was closed via the HARD gate before
this file was written, and is covered by E16/E17.

L2 (qa VM smoke) is deliberately empty: this change introduces no install, spawn, or
multi-OS runtime behaviour. Do not invent an L2 row for it.

L3 rows read the dashboard against the harness port recorded in
`.pi-test-harness.json` (`dashboardPort`) by `docker/test-up.sh` — never a hardcoded
`:18000`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Frame class fixed by type; `sessions_reordered` is `state` | decision-table | L1 | automated | `sessions_reordered {cwd:"/a"}` | `frameClassOf(msg)` | returns `{cls:"state", key:"sessions_reordered:/a"}` |
| E2 | Entity-keyed state frames share a key per entity | EP | L1 | automated | two reorders for `/a`, one for `/b` | `frameClassOf` on each | the two `/a` frames yield an identical key; the `/b` key differs |
| E3 | Deferred reorder is latest-wins | state-transition | L1 | automated | socket above threshold; reorders `/repoA`=[a,b], [b,a], [a,b] then `/repoB`=[c] | socket drains | socket receives exactly 2 frames: one `/repoA` carrying `[a,b]` (the last) and one `/repoB`; `droppedFrames.total` unchanged by them |
| E4 | Kind precedence is LWW; `updated` never downgrades | decision-table | L1 | automated | debt entry pre-seeded with each of `updated`/`added`/`removed` | record each of `updated`/`added`/`removed` over it (9 combinations) | resulting kind is the new one except `updated` over `added`→`added` and `updated` over `removed`→`removed` |
| E5 | Flush: `removed` owed, no record | state-transition | L1 | automated | debt `{kind:"removed"}` for `s1`; `sessionManager.get("s1")` undefined | flush below threshold | socket receives `session_removed {sessionId:"s1"}` |
| E6 | Flush: `removed` owed, record no longer ended | state-transition | L1 | automated | debt `{kind:"removed"}` for `s2`; record exists with `status:"active"` | flush | socket receives `session_added` for `s2` with `reconciled:true`, and NO `session_removed` |
| E7 | Flush: `removed` owed, record ended, `sawAdd` true | state-transition | L1 | automated | debt `{kind:"removed", sawAdd:true}` for `s3`; record `status:"ended"` | flush | socket receives `session_added` for `s3` carrying the ended record and `reconciled:true`, and NO bare `session_removed` |
| E8 | Flush: `removed` owed, record ended, `sawAdd` false | state-transition | L1 | automated | debt `{kind:"removed", sawAdd:false}` for `s4`; record `status:"ended"` | flush | socket receives `session_removed {sessionId:"s4"}` and NO `session_updated` |
| E9 | Flush: `added` owed | state-transition | L1 | automated | shed `session_added` for `s5` with `spawnRequestId:"r1"` | flush while `s5` exists | socket receives `session_added` with the current full record, `spawnRequestId:"r1"`, `reconciled:true` |
| E10 | Flush: `updated` owed carries the clearing values | BVA | L1 | automated | shed `session_updated` for `s6`; record has `currentTool` unset and `hostPressure` unset | flush | frame carries current `status`, `currentTool:null`, `hostPressure:null` (not `undefined`, not the stale tool name) |
| E11 | `sawAdd` survives kind supersede | state-transition | L1 | automated | shed `session_added` then shed `session_removed` for `s7` | inspect entry before flush | kind is `removed` AND `sawAdd` is still true |
| E12 | Registration is the only path to a non-ended record | decision-table | L1 | automated | a `memory-session-manager` instance | enumerate every write path (`register`, `unregister`, `update`, `restore`, `remove`) | only `register` yields a non-ended `status`; a `restore`d record stays `ended` |
| E13 | Debt record is byte-free | EP | L1 | automated | 500 shed registry frames of mixed kinds on one socket | read pending-state byte accounting | pending-state bytes attributable to the debt register is 0; `stalledSocketsTerminated` not incremented by it |
| E14 | Reconcile counters count every kind | EP | L1 | automated | one shed frame of each of the three kinds | flush | `statusReconcileQueued` +3 and `statusReconcileSent` +3; no new `/api/health` field appears |
| E15 | Archived session reconciles as removed | state-transition | L1 | automated | debt owed for `s8`; `s8` archived so no record remains | flush | socket receives `session_removed {sessionId:"s8"}` |
| E16 | An added ended session counts toward the ended total | BVA | L1 | automated | client holds no `s9`; `endedTotals["/repoA"]` is 4 | `session_added` for `s9` with `status:"ended"`, group key `/repoA` | `endedTotals["/repoA"]` becomes 5 and the expander label agrees with the rendered ended rows |
| E17 | A re-delivered ended session is not double-counted | BVA | L1 | automated | client already holds ended `s9`; `endedTotals["/repoA"]` is 5 | a second `session_added` for `s9` with the same ended record | `endedTotals["/repoA"]` stays 5 |
| E18 | Page reply sets generation and exhausted | decision-table | L1 | automated | `pageReplyGen["/a"]`=1, `/a` not exhausted | `sessions_page_result {cwd:"/a", sessions:[], order:[], hasMore:false}` then a second with `hasMore:true` | after the first: gen=2 and `/a` exhausted; after the second: gen=3 and `/a` not exhausted |
| E19 | Every `endedTotals` mutation re-arms paging | decision-table | L1 | automated | `/repoA` marked exhausted | each of the six mutations in turn: `session_updated`→ended, `session_removed`, `session_archived`, snapshot, App server-switch reset, `session_added` of an unheld ended session | the exhausted mark for `/repoA` clears in all six cases |
| E20 | Paging marks live in the group-key space | EP | L1 | automated | worktree session cwd `/repoA/.worktrees/wt1`, group key `/repoA`; `sessions_page_result {cwd:"/repoA", hasMore:false}` | that session transitions to ended, changing `endedTotals["/repoA"]` | the exhausted mark clears (keys matched; no raw-cwd/group-key split) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Reorder retention is coalesced, not accumulated | threshold | L1 | automated | one socket held above threshold; 200 reorders spread across 20 group keys | retained pending-state reorder frames ≤ 1 per group key (≤20 total), independent of the 200 event count | duration of the saturation |
| P2 | Debt register stays O(ids) under flood | soak | L1 | automated | 1000 distinct sessions each shedding all three kinds on one socket | debt entry count ≤ 1000 and per-entry payload bytes = 0; no queued frame retained | until drain |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | In-flight mark releases on any reply | state-transition | L1 | automated | page request in flight for `/repoA`; fake timers; `pagedCount` unchanged | `sessions_page_result {cwd:"/repoA", sessions:[], hasMore:false}` | mark releases immediately with the 15 s timer never advanced — proving release does not depend on the timeout |
| F2 | Exhausted cwd suppresses the affordance and re-arms | state-transition | L1 | automated | `endedTotals["/repoA"]` exceeds held ended; last reply `hasMore:false` | render, then click where "more" was, then change `endedTotals["/repoA"]` | no "more" control rendered; the click sends no `sessions_page`; after the total changes the control returns |
| F3 | A reconciled add never navigates, on any tier | decision-table | L1 | automated | browser displaying session `X`; pending spawn `r2` outstanding | `session_added {spawnRequestId:"r2", reconciled:true}`, and separately a reconciled add matching only by cwd, and one matching only by worktree | displayed session stays `X` in all three cases; the `r2` pending-spawn record is consumed and its placeholder cleared |
| F4 | A reconciled add with no request id touches no spawn state | state-transition | L1 | automated | unrelated user spawn pending for `/repoA` with its own placeholder | `session_added` for a DIFFERENT `/repoA` session with `reconciled:true` and no `spawnRequestId` | displayed session unchanged; the `/repoA` placeholder still present; the unrelated spawn still auto-navigates when its own `session_added` arrives |
| F5 | A reconciled add is an upsert that spares siblings | state-transition | L1 | automated | client holds `s5` plus a sibling in the same cwd with `resuming:true` | reconciled `session_added` for `s5` | `s5` row updated not duplicated; the sibling's `resuming` flag is still true |
| F6 | Deferred reorder does not lose a concurrently added session | state-convergence | L1 | automated | client holds order `[a,b]` for `/repoA` | `session_added` for `c`, then a deferred `sessions_reordered` for `/repoA` omitting `c` | order converges to `[...reordered, c]` — `c` retained at the tail, never evicted |
| F7 | A shed registry burst still yields a complete sidebar | state-convergence | L3 | automated | harness dashboard; a browser socket driven above the shed threshold while sessions are spawned and ended | socket drains | within 1 s of drain the sidebar shows a row for every session the server holds, with statuses matching `/api/health`; no session is missing until reconnect |
| F8 | Paging never dead-ends on the same offset | state-transition | L3 | automated | harness with a stub ended group whose pageable set is shrunk out-of-band so the reply is empty | expand the ended list, then trigger an `endedTotals` change | the "more" control disappears after the empty reply rather than re-requesting the same offset, and reappears after the total changes |
| F9 | Sidebar settling under a reconcile burst feels stable | visual/subjective | — | manual-only | dashboard sidebar during a large drain-and-reconcile burst | a human watches the sidebar settle | [judgment: no distracting flicker, reshuffling, or scroll jump — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | A shed reconcile re-records for every kind | fault-injection (abort) | L1 | automated | socket re-crosses the threshold during flush | a reconcile `session_added` and a reconcile `session_removed` are each themselves shed | both ids remain owed with their kind intact and are retried on a later drain — not silently dropped |
| X2 | Teardown releases the register and its timer | fault-injection (abort) | L1 | automated | socket close, socket error, and stalled-terminate | each teardown path with debt outstanding | the socket's entries are dropped and its reconcile interval is cleared in all three paths (no leaked timer) |
| X3 | A partial drain leaves the remainder owed | fault-injection (delay) | L1 | automated | threshold re-crossed midway through a multi-entry flush | flush with 5 owed ids, saturating after the 2nd | the first 2 are delivered and counted sent; the remaining 3 stay owed; `statusReconcileSent` counts only delivered frames |
| X4 | A reconnect snapshot re-arms a stale exhausted mark | fault-injection (abort) | L3 | automated | `/repoA` marked exhausted, then the socket drops and reconnects with identical `endedTotals` | reconnect snapshot applied | the exhausted mark clears and the "more" control is available again, despite the totals being byte-identical |

---

## Coverage summary

- Requirements covered: 17/17
- Scenarios by class: edge 20 · perf 2 · frontend 9 · error 4
- Scenarios by level: L1 29 · L2 0 · L3 4 · manual-only 1
- Scenarios by disposition: automated 34 · manual-only 1

## New infra needed

None. Every row extends an existing harness:
- server L1 → `packages/server/src/__tests__/browser-gateway-host-pressure-reconcile.test.ts` (reconcile + force-shed pattern), `browser-gateway-dropped-frames.test.ts` (shed accounting)
- client handler L1 → `packages/client/src/components/__tests__/useMessageHandler.tier25-fallback.test.tsx` (spawn-cascade tiers), `useMessageHandler.snapshot-replace.test.tsx` (snapshot apply)
- client component L1 → `packages/client/src/components/__tests__/SessionList.test.tsx`
- session manager L1 → `packages/server/src/__tests__/session-death-attribution.test.ts` (register/unregister status transitions)
- L3 → `tests/e2e/sessions-page-stub-group.spec.ts` (ended paging + stub group)
