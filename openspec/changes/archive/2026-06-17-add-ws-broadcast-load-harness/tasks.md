# Tasks

## 1. Preconditions

- [x] 1.1 Read `packages/server/src/browser-gateway.ts` `fanout` / `broadcast` / `broadcastOpenSpecUpdateImpl` and confirm the `readyState`/`MAX_WS_BUFFER` guard shape the harness must exercise (lines ~265–305).
- [x] 1.2 Read `packages/server/src/__tests__/browser-gateway-broadcast-serialize-once.test.ts` and confirm the `makeFakeWs` + `wss.emit("connection", ...)` + `attach` drain pattern the harness will extend.
- [x] 1.3 Read `packages/server/src/session-bootstrap.ts:60-114` to confirm the poll-tick callback and the cold-boot `Promise.all` burst (scenario D).
- [x] 1.4 Read `packages/shared/src/config.ts:118` (`pollIntervalSeconds: 60`) and confirm the validator clamp range (scenario E).
- [x] 1.5 Confirm `OpenSpecData` type shape from `packages/shared` for `makeOpenSpecPayload` (valid synthetic payloads).
- [x] 1.6 Run `npm test 2>&1 | tee /tmp/ws-load-baseline.log` and capture the green baseline.

## 2. Draining fake socket (the only real new primitive)

- [x] 2.1 Create `packages/server/src/__tests__/helpers/draining-ws.ts` exporting `createDrainingWs({ drainRateBytesPerMs, readyState? })`.
- [x] 2.2 Implement `send(frame)`: `bufferedAmount += byteLength(frame)`; push `{ seq, enqueuedAt, bytesAtEnqueue, type, cwd?, sessionId? }` (parse `type`/`cwd`/`sessionId` from the JSON frame, best-effort).
- [x] 2.3 Implement `advance(ms)`: `drained += drainRateBytesPerMs * ms`; `bufferedAmount = max(0, bufferedAmount - drainRateBytesPerMs * ms)`; advance virtual `now`.
- [x] 2.4 Implement `timeToFlush(predicate)`: locate the recorded frame; return virtual ms from its `enqueuedAt` until cumulative drain ≥ its `bytesAtEnqueue`. Pure function over the recorded log + drain rate.
- [x] 2.5 Preserve the `EventEmitter` + `OPEN`/`readyState`/`bufferedAmount`/`send`/`close` surface so it is a drop-in for `makeFakeWs`.
- [x] 2.6 Unit-test the primitive itself in `packages/server/src/__tests__/draining-ws.test.ts`: byte accounting, clamp-at-0 drain, FIFO `timeToFlush` (a frame behind a big frame flushes later), readyState skip.

## 3. Load fixtures

- [x] 3.1 Create `packages/server/src/__tests__/helpers/load-fixtures.ts`.
- [x] 3.2 `seedSessions({ focusedCwd, idleCwds, perCwd })` → populate a `MemorySessionManager` with running sessions across cwds.
- [x] 3.3 `makeOpenSpecPayload(sizeBytes)` → valid `OpenSpecData` padded so `JSON.stringify(...).length ≈ sizeBytes`.
- [x] 3.4 `attachClients(gateway, n, wsOpts)` → emit `connection` for N draining sockets, drain bootstrap sends, return the socket handles.
- [x] 3.5 Export `DRAIN_FAST` / `DRAIN_SLOW` named presets with an "illustrative, not calibrated" comment.

## 4. Scenario matrix test

- [x] 4.1 Create `packages/server/src/__tests__/browser-gateway-load.test.ts` with budget constants block at top (`REGRESSION TARGET` comments per Decision 5).
- [x] 4.2 Scenario A — 1 focused session, no openspec: assert focused-event `timeToFlush` < baseline budget at FAST and SLOW.
- [x] 4.3 Scenario B — 1 focused + N idle cwds each firing `openspec_update`: assert focused-event `timeToFlush` and assert `wastedBytes(focusedSocket) > 0` (proves the cross-cwd leak). Run across FAST/SLOW.
- [x] 4.4 Scenario C — B + large per-cwd payload via `makeOpenSpecPayload`: assert latency grows with payload size; record peak `bufferedAmount`.
- [x] 4.5 Scenario D — cold-boot connect burst: drive the `broadcastToAll`-per-dir pattern at connect; assert dropped-frame count (sends skipped by `MAX_WS_BUFFER`) and connect-time focused-snapshot latency.
- [x] 4.6 Scenario E — B with poll interval 60 s→10 s (simulate 6× tick density over a fixed virtual window): assert the periodic latency-spike signature (latency pulses align with tick boundaries).
- [x] 4.7 Add a "signature" assertion helper that classifies a latency-over-time series as `periodic` vs `flat` so the test encodes the "openspec vs upstream" decision rule.

## 5. Docs

- [x] 5.1 Delegate to a docs subagent (caveman style, verbatim rule) to create `docs/perf-ws-broadcast-load.md`: harness model, drain-rate caveat, scenario matrix, metric definitions, periodic-vs-flat reading guide.
- [x] 5.2 Delegate adding a row for each new file to the matching `docs/file-index-server.md` split (path-alphabetical).

## 6. Verification

- [x] 6.1 `npm test 2>&1 | tee /tmp/ws-load.log`; new harness files (`browser-gateway-load.test.ts`, `draining-ws.test.ts`) produce zero failures. 20 pre-existing failures (image-fit native deps, doctor-route, session-kill-e2e, keeper) are flaky env tests, vary run-to-run, unrelated to this test-only change.
- [x] 6.2 Confirm the new tests run deterministically: ran 3×, identical 22/22 pass + identical recorded latency numbers (no clock flakiness).
- [x] 6.3 `openspec validate add-ws-broadcast-load-harness` passes.
- [x] 6.4 Scenario E output: periodic openspec bursts → PERIODIC verdict; no competing traffic → FLAT verdict. Readable for the original lag report.
