## ADDED Requirements

### Requirement: Manual run-now honours per-invoice fan-out

The manual run-now trigger SHALL honour a `scope: per-invoice` action the same
way the scheduler fire does: instead of starting a single run, it SHALL enumerate
the invoices currently queued for the automation's run workspace and start one
run per queued invoice, each bound to its invoice id with `${invoice_id}`
resolved throughout the payload and the resolved `env` map forwarded to the
spawn. A run-now on a non-`per-invoice` automation SHALL start exactly one run,
unchanged. Run-now SHALL return the first started run's id so its result contract
(`{ ok, runId? }`) holds.

#### Scenario: Run-now fans out one run per queued invoice

- **WHEN** run-now is invoked for a `scope: per-invoice` automation and the queued-invoice enumerator returns three ids
- **THEN** the engine SHALL start three runs, one bound to each queued invoice id, each spawn carrying `env.IB_INVOICE_ID` equal to its id and `env.IB_TOOLSET` = `"scoped-invoice"`
- **AND** run-now SHALL return the first started run's id

#### Scenario: Run-now on an empty queue starts no run

- **WHEN** run-now is invoked for a `scope: per-invoice` automation and the enumerator returns no queued invoices
- **THEN** the engine SHALL start no run and SHALL report success with no run id

#### Scenario: Run-now with no enumerator wired starts no run

- **WHEN** run-now is invoked for a `scope: per-invoice` automation and no queued-invoice enumerator is available
- **THEN** the engine SHALL start no run and SHALL NOT start a single run carrying the unresolved `${invoice_id}` token
- **AND** run-now SHALL report failure

#### Scenario: Run-now on a non-per-invoice automation starts one run

- **WHEN** run-now is invoked for an automation whose action does not declare `scope: per-invoice`
- **THEN** the engine SHALL start exactly one run and return its id, unchanged
