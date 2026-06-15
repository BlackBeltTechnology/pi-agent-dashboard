## Why

Before offloading session-event hydration (`loadSessionEvents` → `loadSessionEntries` + `replayEntriesAsEvents`) to a worker, we need data proving the stall is real and quantifying its size. Today there is **no timing instrumentation** on the hydration path: `subscription-handler.ts:239` awaits `loadSessionEvents` inside the WebSocket message handler, and while it runs (sync `readFileSync` of the full JSONL + per-line `JSON.parse` + tree-walk + `replayEntriesAsEvents`) every other session's WS frames queue behind it on the same event loop. On this machine session JSONLs reach 52 MB and 46 MB; parsing one can plausibly hold the loop >1 s, but we are guessing — `directory-service.ts` only instruments the *openspec poll* tick (`[openspec-poll] slow tick`), nothing on hydration.

This change adds **measurement only**. It is the deliberate prerequisite for `offload-session-events-load-to-worker`: ship instrumentation, observe real wall-times and event-loop lag during hydration under normal use, then decide whether (and how aggressively) to offload. Instrument-first / offload-after-data keeps the offload change small and evidence-driven instead of speculative.

## What Changes

- **MODIFY** `packages/server/src/directory-service.ts::loadSessionEvents()` — wrap the load in `performance.now()` start/stop. Record per-call: `sessionId`, `fileBytes` (stat size), `entryCount`, `eventCount`, `wallMs`. Emit a single structured log line on completion and a `[hydration] slow load: <wallMs>ms (session=<id> bytes=<n>)` warning when `wallMs` exceeds a threshold (reuse the 5000 ms convention, gated for tuning). No behavior change to the returned `LoadResult`.
- **NEW (server-process, not per-session)** an event-loop delay monitor via `perf_hooks.monitorEventLoopDelay()`. Started once at server boot, sampled into `/api/health`. Surfaces `eventLoopDelay: { meanMs, p99Ms, maxMs }` so we can correlate hydration spikes with actual loop lag rather than inferring it. `histogram.reset()` after each `/api/health` read so the window reflects recent activity.
- **MODIFY** `packages/server/src/routes/system-routes.ts` `/api/health` — add the `eventLoopDelay` block. Add a small `hydration` block: last-N hydration samples (ring buffer, N≈20) with `{ sessionId, wallMs, fileBytes, eventCount, at }` so an operator can pull recent timings without scraping logs.
- **NEW** `packages/server/src/hydration-metrics.ts` — tiny ring-buffer recorder (`record(sample)`, `snapshot()`) owned by the server process. No persistence. ≤ ~60 lines.
- **NEW** `packages/server/src/__tests__/hydration-metrics.test.ts` — ring buffer caps at N, `snapshot()` returns newest-first, overflow drops oldest.
- **DOCUMENTATION** — `docs/architecture.md`: note the event-loop-delay monitor + hydration ring buffer in the health-endpoint section. File-index row for `hydration-metrics.ts`.

## Non-Goals

- Not offloading any work to a worker — that is `offload-session-events-load-to-worker`, which depends on this.
- Not instrumenting `scanAllSessions` boot timing — separate concern (covered when that offload is proposed).
- Not adding a metrics backend, Prometheus exporter, or persisted time-series. In-memory ring buffer + `/api/health` only.
- Not changing `MAX_REPLAY_EVENTS`, the dedup `loadingSet`, or any replay semantics.

## Dependencies / Sequencing

- **Standalone.** No dependency on other active changes. **Blocks** `offload-session-events-load-to-worker` (that change reads these metrics to set its timeout + justify the offload).

## Migration / Compatibility / Rollback

- **Migration**: none. No persisted state, schema, or protocol change.
- **Compatibility**: `/api/health` gains two **additive** fields (`eventLoopDelay`, `hydration`). Existing clients ignore unknown fields. `loadSessionEvents` return shape unchanged.
- **Rollback**: revert the commit. The monitor is process-local with no external effects. `monitorEventLoopDelay()` has negligible overhead (libuv timer histogram), but if it ever shows up in profiles it can be gated behind a config flag in a follow-up.
- **Risk**: minimal. Worst case the ring buffer or histogram has a bug → wrong numbers in `/api/health`; it cannot corrupt session data or block the loop (recording is O(1), no fs, no serialization of large payloads).
