## ADDED Requirements

### Requirement: Invoicebot domain events are forwarded to the browser

The plugin SHALL forward invoicebot domain events (`ib:*`) emitted on the session
bus to the browser as protocol events, mirroring the existing flow-event
forwarding. At minimum `ib:approval-requested` and `ib:approval-decided` SHALL be
forwarded, with each event's payload preserved verbatim.

#### Scenario: Approval-requested reaches the browser

- **WHEN** `ib:approval-requested` is emitted on a subscribed session's bus
- **THEN** a corresponding protocol event SHALL be delivered to the browser
- **AND** its payload (invoice, approver set, active approver, reference,
  summary) SHALL be preserved verbatim

#### Scenario: Approval-decided reaches the browser

- **WHEN** `ib:approval-decided` is emitted on a subscribed session's bus
- **THEN** a corresponding protocol event SHALL be delivered to the browser with
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
