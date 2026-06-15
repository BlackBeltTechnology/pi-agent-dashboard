# Tasks

## 1. Hydration metrics recorder (test-first)
- [x] 1.1 Add `packages/server/src/__tests__/hydration-metrics.test.ts` — ring buffer caps at N, `snapshot()` returns newest-first, overflow drops oldest. Confirm RED (recorder not written).
- [x] 1.2 Implement `packages/server/src/hydration-metrics.ts` — `createHydrationMetrics(capacity)` → `{ record(sample), snapshot() }`. No persistence. Sample: `{ sessionId, wallMs, fileBytes, entryCount, eventCount, at }`.

## 2. Instrument loadSessionEvents
- [x] 2.1 In `directory-service.ts::loadSessionEvents()`, wrap load in `performance.now()`. Capture `fileBytes` via `statSync` (best-effort, swallow errors), `entryCount` (entries length), `eventCount` (events length), `wallMs`.
- [x] 2.2 On success, `metrics.record(sample)` + structured log line. Emit `[hydration] slow load: <wallMs>ms (session=<id> bytes=<n>)` warning above threshold (reuse 5000 ms). No change to returned `LoadResult`.
- [x] 2.3 Pass the shared `HydrationMetrics` instance into `DirectoryService` (constructor/options) so `/api/health` can read the same snapshot.

## 3. Event-loop delay monitor
- [x] 3.1 At server boot, create `perf_hooks.monitorEventLoopDelay({ resolution: 20 })` and `.enable()`. Hold the handle in server scope.
- [x] 3.2 Expose a helper that reads `{ meanMs, p99Ms, maxMs }` (convert ns→ms) then calls `histogram.reset()` so each `/api/health` read reflects the window since the last read.

## 4. Surface in /api/health
- [x] 4.1 In `routes/system-routes.ts` `/api/health`, add `eventLoopDelay: { meanMs, p99Ms, maxMs }`.
- [x] 4.2 Add `hydration: metrics.snapshot()` (newest-first, ≤ N samples).

## 5. Verify
- [x] 5.1 `npm test` green (`npm test 2>&1 | tee /tmp/pi-test.log`; `grep -nE 'FAIL|✗' /tmp/pi-test.log`).
- [x] 5.2 Manual: restart server, open several large historical sessions, `curl -s localhost:8000/api/health | jq '.eventLoopDelay, .hydration'`. Confirm wallMs + loop lag populate and correlate.

## 6. Spec + docs
- [x] 6.1 `openspec validate instrument-session-hydration-timing --strict` passes.
- [x] 6.2 Delegate `docs/architecture.md` + file-index row to a subagent in caveman style (health endpoint gains eventLoopDelay + hydration ring buffer; hydration-metrics.ts is process-local, no persistence).
