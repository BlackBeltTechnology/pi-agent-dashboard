# Test Plan — fix-backpressure-status-and-subagent-frames

Stage: design   Generated: 2026-09-14

Clarifications C1/C2/C3 were resolved at the HARD gate before this file was
written (reconcile bound = 1 s after drain; perf budget = 100-debt flush < 1 ms
wall, L1 timed; occupancy = `max` + `p95` + cumulative ms above threshold).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Shed `session_updated` reconciled | state-transition | L1 | automated | Fake socket with `bufferedAmount` = 5 MB (> 4 MB); session `s1` at `status:"streaming"`, `currentTool:"Agent"` in the session manager | `broadcast({type:"session_updated", sessionId:"s1", updates:{status:"streaming"}})` sheds, then `bufferedAmount` drops to 0 and the reconcile tick fires | Socket receives one `session_updated` for `s1` whose `updates` carry `status:"streaming"` and `currentTool:"Agent"` read from current state, not from the shed payload |
| E2 | Debt capture is type-scoped | decision-table | L1 | automated | Saturated socket | `broadcast` of each of `session_updated` / `sessions_reordered` / `session_added` / `session_removed` / `file_changed`, each shed | Only the `session_updated` id enters the debt set; reconcile-queued counter increments exactly once; the other four leave the set empty |
| E3 | Debt set is id-only and deduped | BVA | L1 | automated | Saturated socket; 100 distinct session ids, each shed 10× (1 000 sheds) | All sheds recorded | Debt set size = 100 (not 1 000); no serialized payload retained for it; `stalledSocketsTerminated` = 0 |
| E4 | Boundary: at-threshold is not over-threshold | BVA | L1 | automated | Socket with `bufferedAmount` exactly = `MAX_WS_BUFFER` (4 194 304) | `broadcast` of a `session_updated` | Frame is sent, NOT shed, and no debt is recorded (the shed predicate is `>`, not `>=`) |
| E5 | Settled-value semantics | state-transition | L1 | automated | Saturated socket; session `s1` transitions `idle`→`streaming`→`idle`, all three frames shed | Socket drains; reconcile fires | Exactly ONE `session_updated` is delivered, carrying `idle`; no `streaming` frame is synthesized |
| E6 | Reconcile does not resurrect a removed row | decision-table | L1 | automated | Client store holding no row for `s9`; server emits a reconcile `session_updated` for `s9` | Client message handler processes it | Store still holds no row for `s9` (the `if (existing)` guard makes it a no-op) |
| E7 | Health counters present pre-event | BVA | L1 | automated | Freshly booted gateway, zero sheds | `/api/health` read | Reconcile queued + sent counters are present and numeric, both `0`; occupancy `max`/`p95`/msAboveThreshold present and numeric |
| E8 | A shed status counts as both drop and debt | decision-table | L1 | automated | Saturated socket, one `session_updated` shed | Counters read | `droppedFrames.serverToBrowser.total` incremented AND reconcile-queued incremented (the reconcile does not mask the drop) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Reconcile adds no hot-path cost | timed unit | L1 | automated | Debt set of 100 ids, session manager populated, socket under threshold | Wall time of one full reconcile flush < 1 ms | single flush, median of 20 runs |
| P2 | Debt capture adds no per-frame cost | timed unit | L1 | automated | 10 000 `broadcast` calls of non-`session_updated` types onto a saturated socket | Added wall time vs. a baseline without the dirty-id argument < 5 % | 10 000 iterations |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Stale badge heals in the real UI | state-convergence | L3 | automated | Dashboard open against the docker harness (port from `.pi-test-harness.json` `dashboardPort`); a session driven to `streaming` while its socket is saturated | Saturation released | The session card converges to the working/streaming indicator within 1 s of drain, without a page reload |
| F2 | No reload required, no flicker of a wrong state | state-convergence | L3 | automated | Same as F1, with a session that ends while saturated | Saturation released | Card converges to `ended` exactly once; no intermediate incorrect status is rendered after the reconcile |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Shed reconcile is retried | fault-injection (re-saturate) | L1 | automated | Socket re-crosses the threshold between the under-threshold check and the send, so the reconcile frame is itself shed | Next reconcile tick with the socket under threshold | The session id is still (or again) owed; a later reconcile delivers it; no unbounded growth of the debt set (size stays 1) |
| X2 | Teardown on close releases set + timer | fault-injection (abort) | L1 | automated | Socket with a non-empty debt set and an active reconcile timer | Socket `close` event | Debt set removed, interval cleared; no timer callback fires afterwards (assert via fake timers advancing 10 intervals) |
| X3 | Teardown on error and on stalled-terminate | fault-injection (abort) | L1 | automated | Same as X2, two variants: socket `error` event; and `sendState` byte-ceiling `ws.terminate()` path | Each teardown path | Debt set removed and interval cleared in both variants; `stalledSocketsTerminated` still increments on the terminate variant |
| X4 | Missing session at reconcile time | fault-injection (delete) | L1 | automated | Debt recorded for `s1`; `s1` removed from the session manager before the reconcile tick | Reconcile fires | No frame sent for `s1`, no throw, debt discarded, reconcile-sent counter not incremented |
| X5 | Timer does not run when nothing is owed | state-transition | L1 | automated | Socket that sheds only transcript `event` frames (no `session_updated`) — the incident's exact shape | 10 reconcile intervals elapse | No reconcile timer was ever started; no frames sent (proves the reconcile does not depend on the pending-state timer, which is never created in this case) |

---

## Coverage summary

- Requirements covered: 3/3 (shed-reconcile, occupancy observability, modified health counters)
- Scenarios by class: edge 8 · perf 2 · frontend 2 · error 5
- Scenarios by level: L1 15 · L2 0 · L3 2
- Scenarios by disposition: automated 17 · manual-only 0

## New infra needed

None. L1 rows extend the existing `packages/server/src/__tests__/browser-gateway-*.test.ts`
family (`browser-gateway-critical-frames.test.ts` is the nearest harness
exemplar); E6 extends the client's `useMessageHandler` test family; L3 rows
extend `tests/e2e/` against the docker harness.
