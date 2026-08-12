## ADDED Requirements

### Requirement: A stalled event-dispatched run is reaped on a quiet bound

A `running` run whose action dispatch declared a completion event, whose action
WAS delivered, and for which no session activity has been observed for longer
than a configurable quiet bound SHALL be reaped rather than left to the max-age
backstop.

Such a run has no other terminal signal available to it: it produces no
`agent_end`, and its spawned session is terminated only as part of finalizing
it — so a lost completion frame leaves it `running`, holding its concurrency
slot, until the max-age backstop. The quiet bound SHALL be configurable
(`stalledRunTimeoutMs`, default 120 s; `<= 0` disables) and SHALL be measured
from the last observed activity for that run's session, not from its start.

Reaping a stalled run SHALL finalize it `error`, free its concurrency slot, and
terminate its spawned session, so an automation whose completion frame was
dropped can never starve the next scheduled tick for longer than the bound.

This bound SHALL apply ONLY to delivered runs whose dispatch declared a
completion event. A delivered PROMPT run SHALL remain governed by the max-age
backstop alone, because a long-running prompt turn produces no intermediate
frames and silence there is not evidence of a stall.

#### Scenario: A delivered event run whose completion never arrives is reaped within the bound

- **GIVEN** a `running` run whose dispatch declared a completion event and whose
  action was delivered to its session
- **AND** no session activity has been observed for that run
- **WHEN** the quiet bound elapses and the sweep evaluates it
- **THEN** the run SHALL transition to `error`
- **AND** its concurrency slot SHALL be freed
- **AND** its spawned session SHALL be terminated
- **AND** the reap SHALL happen strictly before the max-age backstop would.

#### Scenario: The undelivered bound does not claim a delivered event run

- **GIVEN** a delivered event-dispatched run past the undelivered bound but
  within the quiet bound
- **WHEN** the sweep evaluates it
- **THEN** the run SHALL be left untouched.

#### Scenario: Observed activity keeps a live event run alive

- **GIVEN** a delivered event-dispatched run whose session keeps producing
  observed frames
- **WHEN** each frame is observed before the quiet bound elapses
- **THEN** the run SHALL remain `running` however long it takes
- **AND** it SHALL still finalize normally on its declared completion event.

#### Scenario: A delivered prompt run is never reaped by the quiet bound

- **GIVEN** a delivered run whose action is a prompt dispatch, silent well past
  the quiet bound
- **WHEN** the sweep evaluates it
- **THEN** the run SHALL be left untouched.

### Requirement: Observed run-session activity is recorded against its run

The engine SHALL expose a way to record that activity was observed for a tracked
run session, and SHALL use the most recent such observation as that run's
liveness timestamp. Recording activity for an unknown or already-finalized
session SHALL be a no-op.

Every forwarded event of a tracked run session SHALL be recorded as activity, so
liveness is derived from the same stream the run's completion travels on rather
than from a separate probe.

#### Scenario: Activity for an unknown session is ignored

- **WHEN** activity is recorded for a session that is not bound to any pending
  run
- **THEN** the call SHALL be a no-op and SHALL NOT throw.

#### Scenario: Delivery seeds the liveness timestamp

- **WHEN** a run's session registers and its action is delivered
- **THEN** that moment SHALL become the run's initial liveness timestamp, so the
  quiet bound is measured from delivery rather than from the spawn.

### Requirement: The stalled reap is a named finalize path

The stalled reap SHALL log a finalize line naming its path, distinct from the
completion-event, `agent_end`, undelivered-reap, and max-age paths, so a
systematic loss of completion frames is distinguishable in the server log from
an unrelated timeout.

#### Scenario: A stalled reap is attributable in the log

- **WHEN** a run is finalized by the quiet bound
- **THEN** the emitted log line SHALL identify the stalled-reap path and the run
  id.
