## ADDED Requirements

### Requirement: Processing-cost updates use the app-level domain-event channel

A forwarded `ib_invoice_cost_updated` event SHALL be broadcast to every
connected browser through the existing `ib_domain_event` app-level channel,
independent of per-session subscription. The app-level frame SHALL carry the
originating `sessionId`, the renamed event type, and the complete producer
payload verbatim. The existing per-session stream SHALL remain additive and
unchanged.

The producer payload is
`{ invoice_id, currency, total, tokens, perStep, updatedAt, final }`, where each
`perStep` entry carries
`{ stepId, agent?, provider?, model?, tokensIn, tokensOut, cost }`. Forwarding
SHALL preserve USD currency, sub-cent numeric precision, optional provider/model
fields, the complete replacement `perStep` array, and the `final` accrual/freeze
discriminator without interpretation or reshaping.

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

- **WHEN** `ib_invoice_cost_updated` is forwarded for a session with subscribers
- **THEN** subscribed browsers SHALL still receive it on the per-session stream
- **AND** every connected browser SHALL also receive the app-level frame
