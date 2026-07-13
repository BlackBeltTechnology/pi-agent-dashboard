# Tasks

## 1. Reproduce (systematic-debugging)
- [x] 1.1 Reducer/handler test: deliver `[start(40), (end withheld), 42, 43]` → assert
  the tool card stays `running` (documents the stuck-card baseline; the server still
  holds seq 41's `tool_execution_end`).
- [x] 1.2 Server test: `fanout` with `ws.bufferedAmount > MAX_WS_BUFFER` silently skips a
  frame and increments nothing today (documents the observability blind spot).

## 2. Stale running-tool reconcile (client; primary fix) — ADD
- [x] 2.1 Client timer: any `toolStatus:"running"` row older than `STALE_TOOL_MS` with no
  terminal event → one-shot `GET /api/sessions/:sessionId/tool-result/:toolCallId`.
- [x] 2.2 On HTTP 200 (result present) → synthesize the terminal update (flip
  complete/error, attach result) via the existing `tool_execution_end` reducer path
  (idempotent, keyed by `toolCallId`).
- [x] 2.3 On 404 / in-flight → keep the row running, re-arm the timer; never synthesize a
  completion.
- [x] 2.4 Pick `STALE_TOOL_MS` conservatively (20–30 s) so it cannot race a slow tool.
- [x] 2.5 Tests: dropped-terminal reconciles (card flips); slow tool not falsely completed;
  evicted result (404) leaves row running (known limitation).

## 3. Drop-site instrumentation (server + bridge, observability-instrumentation) — ADD
- [x] 3.1 Server `fanout()`/`sendTo()`: on `bufferedAmount > MAX_WS_BUFFER`, increment a
  per-session dropped-frame counter + rate-limited warn `{ hop:"server→browser",
  sessionId, seq, bufferedAmount }` before `continue`/`return`.
- [x] 3.2 Bridge `ConnectionManager.bufferMessage()`: on `buffer.shift()`, increment a
  dropped-frame counter + rate-limited warn `{ hop:"bridge→server", droppedType }`.
- [x] 3.3 Expose both counters on the diagnostics/health payload.
- [x] 3.4 Tests: server drop counted+logged (rate-limited), bridge eviction counted+logged,
  counters surfaced in health.

## 4. Validate
- [x] 4.1 `npm test` green (new + existing reducer/gateway suites).
- [x] 4.2 `openspec validate fix-stuck-tool-card-on-dropped-event --strict`.
- [x] 4.3 `npm run quality:changed` clean (tsc --noEmit clean; full suite green;
  zero new Biome warnings on changed lines. `biome --changed` finds 0 files while
  work is uncommitted on `develop` — harness artifact, re-runs against develop on a
  feature branch at ship time).

## 5. E2E scenario (tests/e2e/)
- [x] 5.1 Playwright: throttle/withhold a live `tool_execution_end` (server keeps it),
  assert the stuck card self-heals via the REST reconcile without a page refresh.
  DONE: `tests/e2e/reconcile-heal.spec.ts` — RECOVERABLE counterpart to
  `superseded-heal.spec.ts`. Reuses the `stuck-tool-superseded` fixture; `routeWebSocket`
  drops the `tool_execution_end` frame (server→browser) but leaves the reconcile route
  UNSTUBBED, so `GET .../tool-result/*` hits the real server (store still holds it) → 200.
  Asserts the burst flips `data-running` true→false (~25s STALE_TOOL_MS), body renders the
  real `supersede-probe` echo output, and `tool-superseded-badge` count 0 (real result
  wins; the supersede fallback never fires).

## 6. Deferred follow-up (do NOT implement here — evidence-gated)
- [ ] 6.1 Only if §3 telemetry shows the `STALE_TOOL_MS` reconcile latency is a real
  problem: open a separate change for a contiguous client cursor + gap-triggered resync
  (lower heal latency for the server→browser drop). It MODIFIES `incremental-event-sync`
  "Client-side sequence tracking" and needs bounded resync retry because `event_replay`
  rides the same back-pressure path. Scope, risk, and rationale are recorded in this
  change's design.md "Deferred".
