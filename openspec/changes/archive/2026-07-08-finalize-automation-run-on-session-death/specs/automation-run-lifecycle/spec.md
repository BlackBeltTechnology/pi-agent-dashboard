## ADDED Requirements

### Requirement: Headless automation runs finalize on session death

A tracked `kind="automation"` run SHALL be finalized when its spawned session
ends without first delivering a terminal event (`agent_end` or its declared
completion event). Session death includes the gateway observing a connection
close and/or a heartbeat timeout for that run's session. Because a headless
automation session is one-shot and never reconnects, the engine SHALL NOT hold
such a session in the reconnect-grace path; it SHALL route the close signal to
the same finalize seam used by the terminal-event paths (`onSessionEnded` →
finalize + `completeRun`), so the run leaves `running` and its concurrency slot
is freed. Finalization SHALL capture the run's last-known buffered result if one
exists; otherwise it SHALL record the run as `error` with a reason indicating the
session ended before completion. Finalization SHALL be idempotent: a later
forwarded completion event or `agent_end` for that session SHALL be a no-op.

This trigger is additive. Prompt-dispatch runs and runs that emit `agent_end` or
their declared completion event SHALL continue to finalize on those signals
exactly as before.

#### Scenario: Code-only run whose session dies before its completion event

- **GIVEN** a `running` event-dispatched automation run whose flow is code-only
- **WHEN** the run's session closes its connection / times out its heartbeat
  before the forwarded completion event arrives, with no reconnect
- **THEN** the engine SHALL finalize the run exactly once
- **AND** SHALL record `error` with a "session ended before completion" reason
  when no result was buffered
- **AND** SHALL free the automation's concurrency slot so the next scheduled fire
  can start.

#### Scenario: Forwarded completion arriving after session-death finalize is a no-op

- **GIVEN** a run already finalized via the session-death path
- **WHEN** its declared completion event or an `agent_end` is later observed for
  that session
- **THEN** no second finalization SHALL occur and no duplicate run record SHALL
  be produced.

#### Scenario: A live human session is not finalized by this path

- **WHEN** a non-`kind="automation"` session closes its connection within the
  reconnect-grace window
- **THEN** the reconnect-grace behavior SHALL be unchanged and no automation run
  finalization SHALL be triggered.

### Requirement: A stale running automation run is reaped

A `running` automation run whose age exceeds a configurable maximum SHALL be
reaped: transitioned to a terminal `error` status and its concurrency slot freed
via `completeRun`. The reaper SHALL run independently of any forwarded event or
session signal, guaranteeing that a lost terminal event can never wedge an
automation's schedule permanently. Reaping SHALL be idempotent with every other
finalize path: a run already finalized SHALL NOT be reaped, and a terminal signal
arriving after a reap SHALL be a no-op.

#### Scenario: Overdue running run is reaped and its slot freed

- **GIVEN** an automation run in `running` past the configured maximum age
- **WHEN** the reaper sweep evaluates it
- **THEN** the run SHALL transition to `error`
- **AND** the automation's concurrency slot SHALL be freed so subsequent fires
  are no longer dropped.

#### Scenario: Reaper does not touch a healthy in-progress run

- **GIVEN** an automation run in `running` within the configured maximum age
- **WHEN** the reaper sweep evaluates it
- **THEN** the run SHALL be left untouched.

#### Scenario: Terminal signal after reap is a no-op

- **GIVEN** a run already reaped to `error`
- **WHEN** a forwarded completion event or `agent_end` later arrives for that run
- **THEN** no re-finalization SHALL occur and no duplicate record SHALL be
  produced.
