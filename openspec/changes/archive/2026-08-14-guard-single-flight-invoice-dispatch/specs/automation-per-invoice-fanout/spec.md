## ADDED Requirements

### Requirement: Per-invoice dispatch is single-flight across fan-out paths

Before creating a per-invoice fire context, the automation engine SHALL exclude
a queued invoice id that already has a live run bound to that id. The scheduler
fan-out (`dispatchFire`) and folder/manual run-now (`runNow`) SHALL use this same
filter through their shared `perInvoiceFanout` core. The direct one-invoice
entry point SHALL use the same live-run predicate, so no path starts a second
processing run for the same invoice while the first remains live.

#### Scenario: scheduler does not re-dispatch a queued live invoice

- **WHEN** a scheduler fan-out starts a run for queued invoice `inv-1`
- **AND** `inv-1` remains queued while that run is live
- **AND** the scheduler fires again
- **THEN** the second fan-out SHALL not start another run for `inv-1`

#### Scenario: a new invoice is not blocked

- **WHEN** `inv-1` has a live run and a new queued `inv-2` is enumerated
- **THEN** the fan-out SHALL skip `inv-1` and SHALL still start one run for
  `inv-2`

#### Scenario: REST and scheduler share the guard

- **WHEN** a scheduler-started run for `inv-1` is live
- **THEN** a one-invoice start for `inv-1` SHALL return `in_flight`
- **AND** when a one-invoice run for `inv-1` is live, scheduler fan-out SHALL
  not start another run for it

### Requirement: A dead run releases its invoice dispatch claim

The live-run registry SHALL remove a bound invoice when its run finalizes through
normal completion, session death, stop, spawn failure, or a reaper backstop. No
persistent claim SHALL be created. After removal the invoice SHALL become
eligible for a subsequent fan-out dispatch.

#### Scenario: session death releases the invoice

- **WHEN** a live run bound to queued `inv-1` dies before completion
- **AND** the engine processes that session death
- **THEN** a subsequent scheduler fan-out SHALL be able to start a new run for
  `inv-1`
