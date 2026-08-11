# invoicebot-app-level-events — delta

## MODIFIED Requirements

### Requirement: App-level domain-event channel

The **invoicebot plugin server entry** SHALL rebroadcast InvoiceBot lifecycle
domain events to every connected browser as
`{ type: "ib_domain_event", sessionId, event: { eventType, data } }` — the
wire frame is unchanged from the prior core implementation, so existing
browser consumers need zero changes. The rebroadcast SHALL be driven by the
generic plugin channel: the plugin registers
`registerPiHandler("ib_domain_event", …)` and pushes via the plugin server
context's browser broadcast, independent of any per-session subscription. The
frame SHALL carry the originating `sessionId` and the event payload verbatim.
The core server (`packages/server`) SHALL contain no `ib_*`-specific
rebroadcast logic.

Per-session `event_forward` delivery of `ib_*` events is retired: the
app-level frame is the sole browser-facing delivery of InvoiceBot domain
events.

#### Scenario: Domain event reaches an unsubscribed browser

- **WHEN** the plugin server handler receives an `ib_domain_event` plugin
  message for some session
- **AND** a browser is connected but NOT subscribed to that session
- **THEN** the browser SHALL receive
  `{ type: "ib_domain_event", sessionId, event: { eventType, data } }`

#### Scenario: Frame carries the originating sessionId

- **WHEN** an app-level domain-event frame is broadcast
- **THEN** it SHALL carry the `sessionId` of the session that produced the
  event
- **AND** it SHALL carry the event's renamed type and payload verbatim

#### Scenario: Wire contract is unchanged

- **WHEN** a browser client written against the previous
  `ib_domain_event` frame shape receives an event after this change
- **THEN** the frame SHALL be byte-compatible:
  `{ type: "ib_domain_event", sessionId, event: { eventType, data } }`

#### Scenario: Per-session stream preserved

- **WHEN** the prior core implementation's per-session `event_forward` path is
  replaced by plugin-owned domain-event delivery
- **THEN** the app-level `ib_domain_event` frame SHALL remain the sole
  browser-facing delivery path for InvoiceBot domain events
- **AND** no consumer-visible behavior SHALL depend on the retired per-session
  duplicate, which had no in-repo browser consumer

### Requirement: App-level broadcast is headless-safe and non-blocking

The app-level broadcast SHALL be a no-op when no browser is connected and
SHALL NOT throw. A malformed plugin message — missing `sessionId`, missing
`payload.eventType`, or a `null`/`undefined` `payload.data` — SHALL be skipped
by the plugin server handler without crashing, and subsequent well-formed
events SHALL still be broadcast.

#### Scenario: No browser connected

- **WHEN** an `ib_domain_event` plugin message arrives and no browser is
  connected
- **THEN** the broadcast SHALL be a no-op and SHALL NOT error

#### Scenario: Malformed event does not crash the handler

- **WHEN** an `ib_domain_event` plugin message arrives with a missing or
  `null` payload `data`
- **THEN** the handler SHALL skip it without throwing
- **AND** a subsequent well-formed event SHALL still be broadcast

#### Scenario: Malformed event does not crash the gateway

- **WHEN** a forwarded domain event is malformed or missing its payload
- **THEN** the plugin-owned app-level rebroadcast SHALL skip it without throwing
- **AND** subsequent well-formed domain events SHALL still be broadcast

## REMOVED Requirements

### Requirement: Processing-cost updates use the app-level domain-event channel

**Reason**: Folded into the modified "App-level domain-event channel"
requirement — cost events are one of the declared lifecycle events and follow
the identical path; payload-verbatim preservation is specified at the bridge
(`invoicebot-event-bridge`, cost-payload scenario) and the frame shape here.
No behavioural change: `ib_invoice_cost_updated` still reaches every connected
browser through `ib_domain_event` with the full producer payload verbatim.

#### Scenario: Cost update reaches a browser without a session subscription

- **WHEN** `ib_invoice_cost_updated` is forwarded for a session
- **AND** a browser is connected but not subscribed to that session
- **THEN** the browser SHALL receive the event through `ib_domain_event`
- **AND** the frame SHALL identify the originating `sessionId`

#### Scenario: Full live-accrual payload reaches the app-level consumer

- **WHEN** a live cost event carries `currency:"USD"`, sub-cent `total` and
  `perStep[].cost` values, optional `provider`/`model` fields, and `final:false`
- **THEN** the app-level frame SHALL preserve every field and numeric value
  verbatim

#### Scenario: Terminal freeze discriminator reaches the app-level consumer

- **WHEN** a terminal cost event carries `final:true`
- **THEN** the app-level frame SHALL preserve `final:true` unchanged

#### Scenario: Per-session delivery remains additive

- **WHEN** `ib_invoice_cost_updated` is delivered after the plugin-owned migration
- **THEN** every connected browser SHALL receive the unchanged app-level frame
- **AND** no consumer-visible behavior SHALL depend on the retired per-session duplicate, which had no in-repo browser consumer
