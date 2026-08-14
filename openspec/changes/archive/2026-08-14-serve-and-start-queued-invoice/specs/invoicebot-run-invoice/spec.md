## ADDED Requirements

### Requirement: Start exactly one queued invoice over REST

The invoicebot-plugin SHALL expose `POST /api/plugins/invoicebot/run-invoice`
accepting `{ invoice_id }` (with the workspace `cwd`), which starts **one** scoped
run for **exactly that invoice** through the same per-invoice fan-out core the
scheduler and manual run-now already use, so the run carries
`IB_TOOLSET=scoped-invoice` and `IB_INVOICE_ID=<invoice_id>` and the invoice gets
its own scoped session. The endpoint SHALL NOT trigger global automation, fan out
other invoices, or fire a folder-level run. It SHALL return the started run
identity. It SHALL reuse the existing cross-plugin service seam
(`automation:runInvoice`) rather than introduce a second dispatch path.

#### Scenario: one scoped run started

- **WHEN** the client POSTs `/api/plugins/invoicebot/run-invoice` with a valid
  `cwd` and an `invoice_id` for a queued invoice
- **THEN** exactly one run SHALL be started, bound to that invoice id, carrying
  `IB_TOOLSET=scoped-invoice` and `IB_INVOICE_ID=<invoice_id>`
- **AND** the response SHALL carry the started run identity
- **AND** no run SHALL be started for any other queued invoice

#### Scenario: missing invoice id or cwd rejected

- **WHEN** the request omits `invoice_id`, or omits or supplies an invalid `cwd`
- **THEN** the response SHALL be `400` and no run SHALL be started

#### Scenario: dispatch seam unavailable

- **WHEN** the `automation:runInvoice` service is not available
- **THEN** the response SHALL be `503` and no run SHALL be started

### Requirement: One-in-flight refusal

When the target invoice already has a run in flight, `run-invoice` SHALL refuse
with a distinct, machine-readable result — HTTP `409` with `{ ok:false,
reason:"in_flight" }` — and SHALL NOT start a second run. Two flows SHALL never
process the same record.

#### Scenario: second start refused while first in flight

- **WHEN** `run-invoice` is called for an invoice that already has a run in flight
- **THEN** the response SHALL be `409` with `{ ok:false, reason:"in_flight" }`
- **AND** no second run SHALL be started

#### Scenario: refusal is distinguishable from other errors

- **WHEN** the refusal is returned
- **THEN** its `reason` SHALL be `"in_flight"`, distinct from a validation (`400`)
  or unavailable-seam (`503`) error, so the client can surface it honestly
