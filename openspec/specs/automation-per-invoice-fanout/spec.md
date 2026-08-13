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

