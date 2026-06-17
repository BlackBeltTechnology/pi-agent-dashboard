# WebSocket Broadcast Load Harness

## Purpose

Harness measures head-of-line blocking on single browser WebSocket.
Browser tab holds one WS multiplexed across all sessions.
`openspec_update` fans out to every socket keyed by cwd, never filtered by viewed cwd (`fanout()` in `packages/server/src/browser-gateway.ts`).
Focused tab receives every other cwd payload.
Harness turns suspected periodic lag into measurable, regression-gated fact.
Test-only. No production code changed.

## Harness model

`packages/server/src/__tests__/helpers/draining-ws.ts` — `createDrainingWs({ drainRateBytesPerMs, readyState? })`.
Timing-aware fake WebSocket.
`send(frame)` increments `bufferedAmount` by frame byte length, records `{ seq, enqueuedAt, bytesAtEnqueue, bytes, type, cwd?, sessionId? }`.
`advance(ms)` drains `bufferedAmount` by `drainRateBytesPerMs * ms`, clamped at 0, advances virtual clock.
`drainFully()` advances just enough to clear buffer.
`timeToFlush(predicate)` = `bytesAtEnqueue / drainRateBytesPerMs` for first matching record (pure FIFO drain).
Drop-in for static `makeFakeWs`.

Harness drives REAL gateway: `createBrowserGateway` + `wss.emit("connection", ws, {})` + real `broadcastToAll` / `broadcastOpenSpecUpdate` / `MAX_WS_BUFFER` guard.
Fake only the socket. No fan-out logic reimplemented.

## Drain-rate caveat

`DRAIN_FAST` = 50000 bytes/ms (~50 MB/s, illustrative LAN).
`DRAIN_SLOW` = 500 bytes/ms (~0.5 MB/s, illustrative mobile/tunnel).
ILLUSTRATIVE, NOT CALIBRATED.
Linear model ignores TCP slow-start, Nagle, OS buffers.
Proves RELATIVE effects only (B worse than A; C/D/E worsen B).
Absolute ms numbers not link-calibrated.

## Scenario matrix

| ID | Topology/workload | Probe |
|----|-------------------|-------|
| A | 1 focused session, no openspec | baseline focused-event flush latency |
| B | 1 focused + N idle cwds each firing `openspec_update` | core hypothesis: focused-event flush behind cross-cwd traffic + wastedBytes>0 |
| C | B + large per-cwd payload | payload-size amplifier: latency + peak buffer grow with size |
| D | cold-boot connect burst, `broadcastToAll` per known dir | connect storm: dropped frames via `MAX_WS_BUFFER` guard |
| E | B with poll interval 60 s → 10 s (6× tick density over fixed window) | poll-cadence signature: periodic latency spikes |

## Metric definitions

target-message latency: virtual ms from focused `event` enqueue to flush, measured while competing openspec traffic in buffer. `timeToFlush(isFocusedEvent)`.
wastedBytes: total `openspec_update` bytes delivered to socket for cwds it does not view. `bytesWhere(type==="openspec_update" && cwd !== focusedCwd)`.
dropped frames: count of sends skipped by `bufferedAmount > MAX_WS_BUFFER` (4 MB default). Computed = attempted broadcasts − delivered records.
peak bufferedAmount: `peakBufferedAmount()`, highest buffer depth observed.

## Periodic-vs-flat reading guide

`classifyLatencySignature(series)` classifies latency-over-virtual-time series.
`flat` = negligible variation (range/max < 0.1) → continuous upstream lag.
`periodic` = ≥2 evenly-spaced rising edges above mid-range threshold → poll-cadence (openspec) lag.
Scenario E periodic verdict: spike spacing aligns with tick interval (10 samples at 1 s step over 60 s window).
Original lag report: periodic verdict implicates openspec fan-out; flat verdict implicates upstream.

## Files

`packages/server/src/__tests__/helpers/draining-ws.ts` — draining socket primitive.
`packages/server/src/__tests__/draining-ws.test.ts` — primitive unit tests.
`packages/server/src/__tests__/helpers/load-fixtures.ts` — `seedSessions`, `makeOpenSpecPayload`, `attachClients`, `subscribeWs`, `DRAIN_FAST`/`DRAIN_SLOW`.
`packages/server/src/__tests__/browser-gateway-load.test.ts` — scenario matrix A–E.

## Follow-on

Fix out of scope.
Subscription-scoped `openspec_update` fan-out gated on this harness evidence.
REGRESSION TARGET in test: wastedBytes(focusedSocket) === 0 after scoped fan-out; scenario-B focused latency collapses to scenario-A budget.
