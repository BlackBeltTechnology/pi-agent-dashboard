## ADDED Requirements

### Requirement: An undelivered run is reaped on a short bound

A `running` run whose action was never delivered to a session SHALL be reaped on
a bound far shorter than the max-age backstop. The bound SHALL be configurable
(`undeliveredRunTimeoutMs`, default 60 s; `<= 0` disables) and SHALL apply only
to runs that never reached delivery — a delivered run still executing its work
SHALL remain governed by the max-age backstop alone.

Reaping an undelivered run SHALL finalize it `error`, free its concurrency slot,
and terminate its spawned session, so an automation whose fire lost its
correlation can never starve the next scheduled tick for longer than the bound.

#### Scenario: A run that never received its action is reaped within the bound

- **GIVEN** a `running` run whose session never registered with its stamp, so the
  action was never delivered
- **WHEN** the undelivered bound elapses and the sweep evaluates it
- **THEN** the run SHALL transition to `error`
- **AND** its concurrency slot SHALL be freed
- **AND** the next fire of that automation SHALL start a new run.

#### Scenario: A delivered long-running run is not reaped early

- **GIVEN** a `running` run whose action WAS delivered and whose work is still in
  progress past the undelivered bound but within the max age
- **WHEN** the sweep evaluates it
- **THEN** the run SHALL be left untouched.

#### Scenario: Two consecutive runs both settle

- **GIVEN** an automation with `concurrency: skip` whose first run is delivered
  and finalizes on its completion signal
- **WHEN** the automation fires again
- **THEN** the second run SHALL start, be delivered, and finalize on its own
  completion signal
- **AND** neither run SHALL be finalized by a max-age or undelivered reap.

## MODIFIED Requirements

### Requirement: A stale running automation run is reaped

A `running` automation run whose age exceeds a configurable maximum SHALL be
reaped: transitioned to a terminal `error` status and its concurrency slot freed
via `completeRun`. Reaping a run that is still tracked live SHALL also terminate
its spawned session, so a reaped `--mode rpc` run session cannot outlive its run.
The reaper SHALL run independently of any forwarded event or
session signal, guaranteeing that a lost terminal event can never wedge an
automation's schedule permanently. Reaping SHALL be idempotent with every other
finalize path: a run already finalized SHALL NOT be reaped, and a terminal signal
arriving after a reap SHALL be a no-op.

#### Scenario: Overdue running run is reaped and its slot freed

- **GIVEN** an automation run in `running` past the configured maximum age
- **WHEN** the reaper sweep evaluates it
- **THEN** the run SHALL transition to `error`
- **AND** the automation's concurrency slot SHALL be freed so subsequent fires
  are no longer dropped
- **AND** the run's spawned session SHALL be terminated.

#### Scenario: Reaper does not touch a healthy in-progress run

- **GIVEN** an automation run in `running` within the configured maximum age
- **WHEN** the reaper sweep evaluates it
- **THEN** the run SHALL be left untouched.

#### Scenario: Terminal signal after reap is a no-op

- **GIVEN** a run already reaped to `error`
- **WHEN** a forwarded completion event or `agent_end` later arrives for that run
- **THEN** no re-finalization SHALL occur and no duplicate record SHALL be
  produced.
