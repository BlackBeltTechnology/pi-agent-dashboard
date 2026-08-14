# automation-per-invoice-fanout Specification

## Purpose
TBD - created by archiving change wire-per-invoice-automation-drain. Update Purpose after archive.

## Requirements

### Requirement: Per-invoice fan-out on fire

When a fired automation's action declares `scope: per-invoice` in its payload,
the engine SHALL, instead of dispatching a single run, enumerate the invoices
currently queued for the automation's run workspace and fire the automation once
per queued invoice. Each per-invoice fire SHALL carry that invoice's id as a
per-fire variable (`invoice_id`) so the payload resolves per invoice, and SHALL
be bound to that invoice. An action that does not declare `scope: per-invoice`
SHALL fire exactly once, unchanged.

#### Scenario: One run per queued invoice

- **WHEN** a `scope: per-invoice` automation fires and the queued-invoice enumerator returns three ids
- **THEN** the engine SHALL start three runs, one bound to each queued invoice id
- **AND** a non-`per-invoice` automation firing SHALL still start exactly one run

#### Scenario: Empty queue fires nothing

- **WHEN** a `scope: per-invoice` automation fires and the enumerator returns no queued invoices
- **THEN** the engine SHALL start no run and spawn no session

#### Scenario: Missing enumerator skips the fan-out fire

- **WHEN** a `scope: per-invoice` automation fires and no queued-invoice enumerator is available
- **THEN** the engine SHALL start no run and SHALL NOT dispatch a single run carrying the unresolved `${invoice_id}` token

### Requirement: Per-invoice runs resolve the invoice id and scope env

For each per-invoice fire the engine SHALL resolve the `${invoice_id}` token
throughout the action payload to the bound invoice id — in both the flow
`inputs` delivered to the run and the action `env` map — and SHALL forward the
resolved `env` map to the spawned run session so the run is scoped to that one
invoice.

#### Scenario: Invoice id resolved in flow inputs

- **WHEN** a per-invoice run for invoice `inv-3` is dispatched and the action payload declares `inputs: { invoice_id: "${invoice_id}" }`
- **THEN** the dispatched flow SHALL receive `inputs.invoice_id` equal to `"inv-3"`

#### Scenario: Scope env forwarded to the run session

- **WHEN** a per-invoice run for invoice `inv-3` spawns and the action payload declares `env: { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: "${invoice_id}" }`
- **THEN** the spawn SHALL carry `env.IB_TOOLSET` = `"scoped-invoice"` and `env.IB_INVOICE_ID` = `"inv-3"`

### Requirement: Fan-out honours the automation concurrency policy

Per-invoice fires SHALL flow through the runner's concurrency policy for the
automation key, so a `concurrency: queue` automation drains its queued invoices
serially (one active run, the remainder queued and started as each completes)
rather than spawning all runs at once.

#### Scenario: queue concurrency serialises the fan-out

- **WHEN** a `scope: per-invoice`, `concurrency: queue` automation fans out over three queued invoices
- **THEN** exactly one run SHALL be active for the automation key and the remaining two SHALL be queued
- **AND** completing the active run SHALL start the next queued invoice's run

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

### Requirement: Start exactly one invoice by id

The fan-out engine SHALL expose a start-one-invoice entry point that, given a
`scope: per-invoice` automation and a single `invoice_id`, starts **exactly one**
run bound to that invoice through the same per-invoice run core used by the
scheduler fan-out and manual run-now — so the run resolves `${invoice_id}` in the
action payload and forwards the scoped `env` (`IB_TOOLSET`, `IB_INVOICE_ID`) to
the spawned session. It SHALL NOT enumerate the queue or fan out over other
invoices. Each started run SHALL record its bound invoice id.

#### Scenario: one run bound to the given invoice

- **WHEN** the start-one-invoice entry point is called for automation `A` and
  invoice `inv-7`
- **THEN** exactly one run SHALL be started, bound to `inv-7`, with the scoped
  `env` (`IB_TOOLSET=scoped-invoice`, `IB_INVOICE_ID=inv-7`)
- **AND** no run SHALL be started for any other invoice

### Requirement: Refuse a start when the invoice already has a run in flight

The start-one-invoice entry point SHALL refuse to start a run when a run bound to
the same invoice id is already in flight (tracked by the engine from spawn until
finalization), returning a distinct `in_flight` verdict and starting no second
run. This SHALL cover a run started by the scheduler fan-out as well as a prior
start-one-invoice call, so two runs never process the same record.

#### Scenario: in-flight invoice refused

- **WHEN** a run bound to `inv-7` is in flight and the start-one-invoice entry
  point is called again for `inv-7`
- **THEN** it SHALL return an `in_flight` verdict and start no second run

#### Scenario: refusal covers scheduler-started runs

- **WHEN** the scheduler fan-out has a run in flight for `inv-7` and
  start-one-invoice is called for `inv-7`
- **THEN** it SHALL return an `in_flight` verdict and start no second run

### Requirement: Single-invoice run offered as a cross-plugin service

The automation plugin SHALL publish the start-one-invoice capability on the
existing cross-plugin service board (`automation:runInvoice(cwd, invoiceId)`),
resolving the workspace's `scope: per-invoice` automation for the given `cwd` and
delegating to the engine's start-one-invoice entry point, so a consumer plugin
starts one scoped invoice run without a second dispatch path. When no
`scope: per-invoice` automation exists for the workspace, or the engine is not
ready, it SHALL return a not-started verdict.

#### Scenario: service starts one scoped run

- **WHEN** a consumer invokes `automation:runInvoice(cwd, "inv-7")` and the
  workspace has a `scope: per-invoice` automation
- **THEN** the service SHALL start exactly one run bound to `inv-7` and return its
  identity

#### Scenario: no per-invoice automation

- **WHEN** the workspace has no `scope: per-invoice` automation
- **THEN** the service SHALL return a not-started verdict and start no run
