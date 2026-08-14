## ADDED Requirements

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
