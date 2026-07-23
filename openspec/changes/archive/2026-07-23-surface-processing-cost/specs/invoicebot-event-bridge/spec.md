## MODIFIED Requirements

### Requirement: Invoicebot domain events reach the browser with stable names

InvoiceBot domain events (`ib:*`) emitted on the session event bus SHALL be
forwarded to the browser by the event bridge with their payload preserved. Each
consumed lifecycle domain event SHALL carry a stable, renamed protocol type via
a rename map (mirroring the flow-event rename), so a client can subscribe to a
fixed name rather than the raw bus channel. The rename map SHALL cover the full
lifecycle set:

| Bus channel | Renamed protocol type |
|---|---|
| `ib:invoice-state-changed` | `ib_invoice_state_changed` |
| `ib:invoice-cost-updated` | `ib_invoice_cost_updated` |
| `ib:approval-requested` | `ib_approval_requested` |
| `ib:approval-decided` | `ib_approval_decided` |
| `ib:connector-registered` | `ib_connector_registered` |
| `ib:connector-health` | `ib_connector_health` |
| `ib:connector-needs-auth` | `ib_connector_needs_auth` |
| `ib:intake-paused` | `ib_intake_paused` |
| `ib:intake-resumed` | `ib_intake_resumed` |
| `ib:intake-poll-complete` | `ib_intake_poll_complete` |
| `ib:automation-toggled` | `ib_automation_toggled` |
| `ib:automation-cadence-set` | `ib_automation_cadence_set` |
| `ib:source-item-detected` | `ib_source_item_detected` |
| `ib:source-item-dispatched` | `ib_source_item_dispatched` |
| `ib:source-item-skipped` | `ib_source_item_skipped` |
| `ib:source-error` | `ib_source_error` |

Payloads SHALL be forwarded verbatim (no reshaping). An `ib:*` channel not in
the map SHALL still pass through under its raw name (unchanged behaviour).

#### Scenario: Invoice-state-changed reaches the browser with a stable name

- **WHEN** `ib:invoice-state-changed` is emitted on a subscribed session's bus
  with `{ invoice_id, state, hold_reason? }`
- **THEN** a protocol event SHALL be forwarded to the browser
- **AND** its type SHALL be the stable renamed type `ib_invoice_state_changed`
- **AND** its payload SHALL be preserved verbatim

#### Scenario: Invoice-cost-updated reaches the browser with its full payload

- **WHEN** `ib:invoice-cost-updated` is emitted on a subscribed session's bus
  with `{ invoice_id, currency, total, tokens, perStep, updatedAt, final }`
- **AND** `perStep` contains
  `{ stepId, agent?, provider?, model?, tokensIn, tokensOut, cost }`
- **THEN** a protocol event SHALL be forwarded to the browser
- **AND** its type SHALL be the stable renamed type `ib_invoice_cost_updated`
- **AND** every payload field SHALL be preserved verbatim

#### Scenario: Sub-cent precision and final discriminator are preserved

- **WHEN** `ib:invoice-cost-updated` carries `currency:"USD"`, a sub-cent
  `total` and `perStep[].cost`, and `final:false` or `final:true`
- **THEN** the bridge SHALL forward those numeric values without rounding
- **AND** it SHALL preserve the `final` value unchanged

#### Scenario: Cost event step with no model is preserved, not dropped

- **WHEN** `ib:invoice-cost-updated` is emitted with a `perStep` entry whose
  `model` field is absent
- **THEN** the event SHALL still be forwarded as `ib_invoice_cost_updated`
- **AND** that step SHALL be forwarded verbatim with its `model` value absent
  (`undefined`), never dropped, defaulted, or reshaped

#### Scenario: Lifecycle set is renamed

- **WHEN** any lifecycle `ib:*` event in the rename map is emitted on a
  subscribed session's bus
- **THEN** it SHALL be forwarded under its mapped `ib_*` protocol type with its
  payload preserved

#### Scenario: Approval pair still renamed (regression)

- **WHEN** `ib:approval-requested` or `ib:approval-decided` is emitted
- **THEN** it SHALL still be forwarded as `ib_approval_requested` /
  `ib_approval_decided` respectively with its payload preserved

#### Scenario: No subscriber is a no-op

- **WHEN** an `ib:*` event is emitted and no browser is subscribed
- **THEN** forwarding SHALL be a no-op and SHALL NOT error

#### Scenario: Events only forwarded after session ready

- **WHEN** an `ib:*` event fires before the session is ready
- **THEN** the bridge SHALL NOT forward the event
