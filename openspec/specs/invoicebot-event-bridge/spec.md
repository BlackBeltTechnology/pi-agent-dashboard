# invoicebot-event-bridge Specification

## Purpose
TBD - created by archiving change add-inline-consent-ui. Update Purpose after archive.
## Requirements
### Requirement: Invoicebot domain events reach the browser with stable names

InvoiceBot domain events (`ib:*`) emitted on the session event bus SHALL be
forwarded to the browser by the event bridge with their payload preserved.
The consumed domain events SHALL carry a stable, renamed protocol type via a
rename map (mirroring the flow-event rename), so a client can subscribe to a
fixed name. At minimum `ib:approval-requested` and `ib:approval-decided` SHALL be
renamed and forwarded.

#### Scenario: Approval-requested reaches the browser with a stable name

- **WHEN** `ib:approval-requested` is emitted on a subscribed session's bus
- **THEN** a protocol event SHALL be forwarded to the browser
- **AND** its type SHALL be the stable renamed type `ib_approval_requested`
- **AND** its payload (invoice, approver set, active approver, reference,
  summary) SHALL be preserved

#### Scenario: Approval-decided reaches the browser with a stable name

- **WHEN** `ib:approval-decided` is emitted on a subscribed session's bus
- **THEN** a protocol event of type `ib_approval_decided` SHALL be forwarded with
  its payload preserved

#### Scenario: No subscriber is a no-op

- **WHEN** an `ib:*` event is emitted and no browser is subscribed
- **THEN** forwarding SHALL be a no-op and SHALL NOT error

### Requirement: Flow events preserve the flow discriminator

Forwarded flow lifecycle events SHALL preserve the `flowName` discriminator so a
consumer can distinguish one flow's run from another.

#### Scenario: flow_started carries flowName

- **WHEN** a `flow_started` protocol event is forwarded to the browser
- **THEN** it SHALL carry `data.flowName` identifying which flow started

