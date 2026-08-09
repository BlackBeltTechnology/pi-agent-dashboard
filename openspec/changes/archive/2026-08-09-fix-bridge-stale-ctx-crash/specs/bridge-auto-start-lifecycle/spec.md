## ADDED Requirements

### Requirement: A late auto-start continuation never crashes the pi process

The dashboard auto-start flow (`autoStartServer`) is asynchronous and MAY settle
after the extension context that started it has been invalidated by a session
replacement or reload (`newSession`, `fork`, `switchSession`, `reload`, or
session dispose).

Every `ctx.ui` access reachable from that flow — the progress/failure `notify`
callback, the launch-spinner mount, the spinner teardown, and the terminal
`.then()` / `.catch()` safety net — SHALL tolerate an invalidated context. When
the context is stale the access SHALL become a no-op. It SHALL NOT throw, and it
SHALL NOT surface as an unhandled rejection.

The guard is scoped to UI presentation only. It SHALL NOT swallow errors from
auto-start's own logic (discovery, launching, port reconciliation), which must
continue to propagate to their existing handlers.

#### Scenario: Spinner teardown after session replacement

- **GIVEN** a bridge session whose dashboard auto-start is still in flight
- **AND** the extension context has been invalidated by a session replacement
- **WHEN** the auto-start promise settles and the spinner teardown runs
- **THEN** the teardown SHALL complete without throwing
- **AND** no unhandled rejection SHALL escape
- **AND** the pi process SHALL stay alive

#### Scenario: Auto-start failure notice after session replacement

- **GIVEN** an auto-start attempt that fails with a readiness timeout
- **AND** the extension context has been invalidated before the failure lands
- **WHEN** the failure is reported through the `notify` callback
- **THEN** the notification SHALL be dropped silently
- **AND** the pi process SHALL stay alive

#### Scenario: Spinner mount after session replacement

- **GIVEN** an extension context invalidated before the launch begins
- **WHEN** the auto-start flow mounts its launch spinner
- **THEN** the mount SHALL be skipped without throwing

#### Scenario: A live context is unaffected

- **GIVEN** a bridge session whose extension context is still active
- **WHEN** the auto-start flow mounts the spinner, notifies, and tears the
  spinner down
- **THEN** each call SHALL reach `ctx.ui` exactly as before this change
- **AND** the spinner interval SHALL be cleared

#### Scenario: Auto-start logic errors still propagate

- **GIVEN** an auto-start flow whose own logic throws a non-invalidation error
- **WHEN** that error is raised
- **THEN** it SHALL reach the existing `.catch()` handler
- **AND** SHALL NOT be silently discarded by the UI guard

### Requirement: A prompt round-trip survives the auto-start path

A session that accepts a prompt SHALL deliver the model's answer and remain
alive afterwards, regardless of whether a dashboard auto-start attempt is in
flight or has already failed.

This requirement is scoped to the SESSION, not to the browser client. Whether
the client's optimistic prompt settles and re-enables the composer is governed
by the `optimistic-prompt` capability and is deliberately NOT asserted here.

#### Scenario: Round-trip completes with an auto-start failure in flight

- **GIVEN** a session whose dashboard auto-start attempt has already failed
- **WHEN** the session is sent a prompt whose scripted answer is known
- **THEN** the session SHALL return the answer
- **AND** the session SHALL return to `idle`
- **AND** the session SHALL NOT terminate
