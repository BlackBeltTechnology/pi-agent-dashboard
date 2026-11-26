# Test Plan — fix-automation-run-store-eventloop-block

Stage: design   Generated: 2026-11-26

No clarifications are open. Every Triple below is filled from proposal.md, design.md and the delta spec: thresholds `SLOW_RUN_STORE_OP_MS` = 1000 ms, `STOP_GRACE_MS` = 60 s, semaphores per-scope 1 / global 3, max-age eligibility `now − startedAt > maxRunAgeMs`, health budget < 50 ms (tasks 5.3).

Shared L1 fault-injection seam: `vi.mock("node:fs/promises")` with per-path delay/hang/reject control, plus `vi.useFakeTimers()` where a threshold is crossed. Exemplars live in `packages/automation-plugin/src/__tests__/` (`run-store.test.ts` for store, `engine.test.ts` for reaper/engine with `nowRef`, `stop-pipeline.test.ts` / `routes-stop.test.ts` for Stop, `routes-list-home.test.ts` for listing routes).

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Exactly-once / writes apply in order | state-transition | L1 | automated | run R started via `startRun` (write-behind) | `setSessionId(R,"s1")` then `finishRun(R,{status:"done"})` issued synchronously back-to-back, then `drainRunStore()` | `run.json` of R has `status:"done"` AND `sessionId:"s1"` |
| E2 | Exactly-once under async persistence (CAS) | decision-table (2 racers) | L1 | automated | running on-disk record R | two `finishRunIfRunning(R)` calls issued in the same tick | results are exactly one `true` and one `false`; the `run.json` write count for R is 1 |
| E3 | Exactly-once / parent-link integrity | state-transition | L1 | automated | parent P started | 5 `startChildRun(P, …)` issued synchronously, then `drainRunStore()` | P's `children` contains all 5 child ids; 5 child `run.json` exist |
| E4 | Slow storage ops are logged | BVA | L1 | automated | one store op whose `readFile` resolves after D ms, fake timers | D ∈ {999, 1000, 5000} | 999 → 0 `run-store op slow` lines; 1000 → exactly 1; 5000 → exactly 1 (emitted at 1000 ms while pending) |
| E5 | Stop grace before reaper intervenes | BVA | L1 | automated | live overdue run whose Stop started A ms ago, host abort never resolves | sweep fires with A ∈ {59_999, 60_000} | 59_999 → not finalized, `abortSpawnedRun` not called by reaper; 60_000 → finalized `error`, slot freed (`completeRun` called once) |
| E6 | Reaping live runs; age from sweep-start clock | BVA | L1 | automated | live run with age = `maxRunAgeMs` and one with `maxRunAgeMs + 1` (nowRef) | sweep fires | first untouched; second finalized `error` |
| E7 | Pruning decoupled (rerun bit) | state-transition | L1 | automated | retention 3; a prune in flight (listing delayed 200 ms) | 5 runs of the same automation finish during the delayed prune, then `drainRunStore()` | exactly 3 terminal top-level records remain for that automation; no running occurrence removed |
| E8 | Unreadable record is skipped, not fatal | EP | L1 | automated | scope with 3 valid records, 1 `run.json` with invalid JSON, 1 whose `readFile` rejects EACCES | `listRuns` and an orphan disk pass | listing returns the 3 valid records sorted by `startedAt`; overdue valid orphans finalized |
| E9 | Runs listing on a slow scope (coalescing) | decision-table | L1 | automated | 2 concurrent `/runs` requests same (scope,name) + 1 with another name; fs listing delayed 300 ms | all 3 issued together | `readdir` of the scope runs-root called 2 times (one per distinct name); same-key responses deep-equal |
| E10 | Run-record storage does not block (static guard) | static assertion | L1 | automated | source of `run-store.ts` and `stop-run.ts` | test reads both files | no match for `/\b\w+Sync\(/` in either file |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Run-record storage does not block (sequential listing cost) | threshold (timed) | L1 | automated | tmpdir scope with 400 records (200 parents × 1 child) | `listRuns` wall time < 1000 ms, and max event-loop delay during it (`monitorEventLoopDelay`) < 50 ms | one listing |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Reaping live runs SHALL NOT depend on the run store | fault-injection (abort/hang) | L1 | automated | every fs call for scope A never resolves | sweep fires with a live run in A overdue | in that same sweep the run is finalized `error` in memory, `completeRun` called once, `abortSpawnedRun` called once; the sweep's in-memory pass settles without any fs call resolving |
| X2 | Orphan reaping single-flight per scope + observable | fault-injection (hang) | L1 | automated | scope A disk pass hung; scope B has an overdue on-disk orphan | 2 scheduled ticks (60 s apart) | tick 2 starts no second A pass (A `readdir` call count stays 1); exactly one `reaper disk sweep still pending: <ms>ms scope=<A>` line per tick after the first; B's orphan finalized `error` |
| X3 | Bounded threadpool use (semaphores) | fault-injection (hang) | L1 | automated | scopes A, B, C hang every fs call; scope D healthy | concurrent listings on A, B, C and D | ≤ 1 pending fs call per hung scope, ≤ 3 pending fs calls total; D's listing waits and logs one `run-store queue wait` line after 1000 ms (fake timers) |
| X4 | Stop sees persisted state | fault-injection (delay) | L1 | automated | run R finalized in memory (`done`) and its write delayed 500 ms | user Stop on R issued during the delay | Stop outcome is already-finished, not `REAPER_REJECT`; R ends `done` |
| X5 | Stop during reaper / exactly one termination | state-transition | L1 | automated | live overdue run whose Stop started 1 s ago (host abort resolves after 200 ms) | sweep fires during the Stop | final status `stopped`; reaper did not finalize; `abortSpawnedRun` called exactly once in total |
| X6 | Stop dedupe stays synchronous | state-transition (race) | L1 | automated | orphan parent P with orphan child C | direct Stop on C and Stop on P (cascade) issued in the same tick | the orphan kill / abort for C is invoked exactly once; C ends `stopped` |
| X7 | Disposed engine writes nothing | fault-injection (delay) | L1 | automated | disk pass listing delayed 300 ms with an overdue orphan in it | `engine.dispose()` called while the listing is pending | after the listing resolves, 0 `run.json` writes occur for that scope |
| X8 | Write-behind failure is logged, decision stands | fault-injection (abort) | L1 | automated | `writeFile`/`rename` for run R rejects EIO | R completes (`onSessionEnded`) | one warn line naming R's runId; no `unhandledRejection` emitted; slot freed (`completeRun` called once) |
| X9 | Slow run store does not stall the server during a sweep | fault-injection (delay) | L1 | automated | each `readFile` in scope A delayed 300 ms, 5 records, 1 overdue orphan | `reapStaleRuns()` started | a `setImmediate` scheduled right after the call fires within 50 ms while the sweep is pending; when the sweep resolves the overdue orphan is `error` |
| X10 | Runs listing on a slow scope does not stall other requests | fault-injection (delay) | L1 | automated | Fastify app with the automation routes + a trivial `/ping` route; scope fs delayed 300 ms per read | `GET /runs` started, then `GET /ping` | `/ping` responds within 50 ms while `/runs` is pending; `/runs` JSON deep-equals the response on undelayed fs |
| X11 | Direct reaper call joins a pending pass | state-transition | L1 | automated | scheduled disk pass for A pending (delayed 300 ms) with an overdue orphan | `await engine.reapStaleRuns()` | resolves only after the pending pass settles (elapsed ≥ remaining delay); the orphan is `error` on return; A `readdir` count stays 1 |
| X12 | Orphan parent finalizes in the same pass as its last child | state-transition | L1 | automated | orphan parent with one stale running child on disk (no live state) | one sweep | child `error` AND parent finalized in that same sweep (preserves `engine.test.ts:847`) |
| M1 | Run-record storage does not block (field) | fault-injection (real iCloud) | — | manual-only | macOS host, iCloud-backed `~/Documents/.pi/automation` scope, server restarted on the change | sample `/api/health` every 3 s ≥ 10 min, one automation run finishing | `/api/health` < 50 ms throughout; no `eventLoopSpikes` entry ≥ 1 s coincides with run-store activity [host-specific FileProvider behaviour, no CI equivalent] |

## Coverage summary

- Requirements covered: 7/7 (storage non-blocking: E8, E10, P1, X9, X10, M1 · exactly-once: E1, E2, E3, X4, X5, X6, X8 · live reaping independent of storage: E6, X1 · Stop grace: E5, X5 · orphan single-flight: X2, X11, X12, X7 · slow-op logging: E4, X3 · threadpool bound (design invariant): X3)
- Scenarios by class: edge 10 · perf 1 · frontend 0 · error 13
- Scenarios by level: L1 23 · L2 0 · L3 0
- Scenarios by disposition: automated 23 · manual-only 1

## New infra needed

- None. A shared `fs/promises` fault-injection helper (delay/hang/reject per path) is test-support code inside `packages/automation-plugin/src/__tests__/`, not a new level.
