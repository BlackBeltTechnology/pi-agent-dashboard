## REMOVED Requirements

### Requirement: Manual run-now honours per-invoice fan-out

**Reason**: Superseded by "Manual run-now always issues a settling run" — the
empty-queue behaviour changes from "no run" to "one idle settling run", so the
requirement is retired and re-added rather than mutated in place.

## ADDED Requirements

### Requirement: Manual run-now always issues a settling run

The manual run-now trigger SHALL honour a `scope: per-invoice` action by
enumerating the invoices currently queued for the automation's run workspace and
starting one run per queued invoice, each bound to its invoice id with
`${invoice_id}` resolved throughout the payload and the resolved `env` map
forwarded to the spawn. Because run-now is an explicit operator action, it SHALL
always issue a settling run id: when the queue is EMPTY it SHALL start ONE idle
run (no invoice bound) that settles, and two consecutive empty run-nows SHALL
each return a DISTINCT run id. A run-now on a non-`per-invoice` automation SHALL
start exactly one run, unchanged. When per-invoice fan-out is genuinely
unavailable (no queued-invoice enumerator wired) run-now SHALL start no run and
report failure. Run-now SHALL return the started run's id (the first, when it
fans out) so its result contract (`{ ok, runId? }`) holds. The SCHEDULER fire
path is unchanged and still starts no run on an empty queue.

#### Scenario: Run-now fans out one run per queued invoice

- **WHEN** run-now is invoked for a `scope: per-invoice` automation and the queued-invoice enumerator returns three ids
- **THEN** the engine SHALL start three runs, one bound to each queued invoice id, each spawn carrying `env.IB_INVOICE_ID` equal to its id and `env.IB_TOOLSET` = `"scoped-invoice"`
- **AND** run-now SHALL return the first started run's id

#### Scenario: Run-now on an empty queue starts one idle settling run

- **WHEN** run-now is invoked for a `scope: per-invoice` automation and the enumerator returns no queued invoices
- **THEN** the engine SHALL start exactly one idle run (no invoice bound) and return its run id
- **AND** two consecutive empty run-nows SHALL each return a distinct run id

#### Scenario: Run-now with no enumerator wired starts no run

- **WHEN** run-now is invoked for a `scope: per-invoice` automation and no queued-invoice enumerator is available
- **THEN** the engine SHALL start no run and SHALL NOT start a single run carrying the unresolved `${invoice_id}` token
- **AND** run-now SHALL report failure

#### Scenario: Run-now on a non-per-invoice automation starts one run

- **WHEN** run-now is invoked for an automation whose action does not declare `scope: per-invoice`
- **THEN** the engine SHALL start exactly one run and return its id, unchanged

#### Scenario: Scheduler fire on an empty queue still starts no run

- **WHEN** a `scope: per-invoice` automation fires from the scheduler and the enumerator returns no queued invoices
- **THEN** the engine SHALL start no run
