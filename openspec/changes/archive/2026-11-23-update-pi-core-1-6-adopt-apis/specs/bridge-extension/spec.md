## ADDED Requirements

### Requirement: Bridge session shutdown leaves pi time for a clean exit

On a `shutdown` request (the server's `{ type: "shutdown" }` message, or `/quit` / `/exit`) the bridge SHALL call `cachedCtx.shutdown()` first and arm an `unref()`'d `process.exit(0)` fallback after `BRIDGE_SHUTDOWN_FALLBACK_MS` (5000 ms). pi's own clean exit or the server's SIGTERM normally ends the process first, so the bridge does not cut short pi's `dispose()`, which waits for credential writes at the pi 1.6.0 floor.

#### Scenario: Idle session exits through pi, not the fallback
- **GIVEN** the session is idle
- **WHEN** the bridge receives `{ type: "shutdown" }`
- **THEN** it SHALL call `cachedCtx.shutdown()` once
- **AND** SHALL NOT call `process.exit` within 4999 ms of the request

#### Scenario: Fallback still ends a session nothing else stopped
- **GIVEN** `cachedCtx.shutdown()` returned and the process is still running
- **WHEN** 5000 ms elapse after the request
- **THEN** the bridge SHALL call `process.exit(0)`

#### Scenario: Fallback is armed even when shutdown is missing or throws
- **GIVEN** `cachedCtx.shutdown` is absent, or throws
- **WHEN** the bridge handles a `shutdown` request
- **THEN** the error SHALL NOT escape the handler
- **AND** the bridge SHALL still call `process.exit(0)` 5000 ms after the request

#### Scenario: /quit takes the same path
- **WHEN** the user sends `/quit` or `/exit` through the dashboard
- **THEN** the bridge SHALL call `cachedCtx.shutdown()` and arm the same 5000 ms fallback

#### Scenario: Fallback timer does not hold the event loop
- **WHEN** the bridge arms the fallback timer
- **THEN** the timer SHALL be `unref()`'d
