## ADDED Requirements

### Requirement: Timing-aware draining socket model
The harness SHALL provide a fake WebSocket that models send-queue depth in bytes and drains it under a caller-owned virtual clock. `send(frame)` MUST increase `bufferedAmount` by the byte length of the frame; `advance(ms)` MUST decrease `bufferedAmount` by `drainRateBytesPerMs * ms` clamped at 0. The fake MUST preserve the `readyState`, `OPEN`, `bufferedAmount`, `send`, and `close` surface so it is a drop-in for the existing `makeFakeWs`.

#### Scenario: Bytes accumulate on send
- **WHEN** two frames of 1000 and 2000 bytes are sent with no intervening `advance`
- **THEN** `bufferedAmount` SHALL equal 3000

#### Scenario: Drain clamps at zero
- **WHEN** `bufferedAmount` is 500 and `advance(ms)` would drain 2000 bytes
- **THEN** `bufferedAmount` SHALL equal 0, never negative

#### Scenario: FIFO time-to-flush
- **WHEN** a large frame is enqueued ahead of a small focused-session frame on the same socket
- **THEN** `timeToFlush` for the small frame SHALL be greater than it would be if enqueued alone
- **BECAUSE** the wire drains FIFO; the small frame waits behind the large one (head-of-line blocking)

#### Scenario: Closed socket is skipped by the real gateway
- **WHEN** the draining socket's `readyState` is not `OPEN` and the real gateway broadcasts
- **THEN** `send` SHALL NOT be invoked on that socket

### Requirement: Harness drives the real gateway, not a reimplementation
The scenario tests SHALL construct the production `createBrowserGateway` and route draining sockets through the real `wss.emit("connection", ...)` path, and SHALL exercise the real `broadcastToAll` / `broadcastOpenSpecUpdate` / backpressure-guard code. The harness MUST NOT reimplement fan-out logic.

#### Scenario: Backpressure guard observed through real code
- **WHEN** a draining socket's `bufferedAmount` exceeds `MAX_WS_BUFFER` and the real gateway fans out an `openspec_update`
- **THEN** that socket's `send` SHALL be skipped and the harness SHALL count it as a dropped frame

#### Scenario: Serialize-once preserved
- **WHEN** the real gateway broadcasts to multiple draining sockets
- **THEN** every socket SHALL receive a byte-identical frame

### Requirement: Cross-cwd leak measurement
The harness SHALL measure the bytes of `openspec_update` frames delivered to a socket for cwds that socket is not subscribed to or viewing, and expose this as a per-socket `wastedBytes` metric.

#### Scenario: Focused socket receives non-focused cwd payloads
- **WHEN** a socket is focused on cwd A and the gateway broadcasts `openspec_update` for cwds B and C
- **THEN** `wastedBytes(socket)` SHALL be greater than 0
- **BECAUSE** `openspec_update` fan-out is cwd-keyed and not filtered by per-socket subscription

### Requirement: Latency-signature classification
The harness SHALL classify a focused-message latency-over-virtual-time series as `periodic` or `flat`, encoding the decision rule that distinguishes poll-cadence-driven lag (openspec) from continuous upstream lag.

#### Scenario: Periodic poll cadence produces periodic spikes
- **WHEN** `openspec_update` bursts fire at a fixed virtual interval and focused-message latency is sampled across the window
- **THEN** the classifier SHALL report `periodic` with spike boundaries aligned to the burst interval

#### Scenario: No competing broadcast produces a flat signature
- **WHEN** only the focused session emits live events and no openspec traffic competes
- **THEN** the classifier SHALL report `flat`

### Requirement: Deterministic execution
The harness SHALL run within `npm test` using only the virtual clock, with no wall-clock sleeps or real timers, and SHALL produce identical recorded latency numbers across repeated runs.

#### Scenario: Repeated runs are identical
- **WHEN** the scenario suite is run three times
- **THEN** each run SHALL pass and SHALL report identical `timeToFlush` and `wastedBytes` values
