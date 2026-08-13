# invoicebot-event-bridge (delta) — scoped-session-liveness

## ADDED Requirements

### Requirement: Forwarded domain events are addressable by invoice and cover every state transition

A forwarded `ib_domain_event` frame SHALL be **addressable by invoice**: the
`invoice_id` present in the bus payload SHALL be preserved verbatim in
`payload.data`, so a consumer holding an invoice open can route the event to that
invoice without knowing which session produced it — exactly as the live
`ib_invoice_cost_updated` frame already is.

`ib_invoice_state_changed` SHALL be forwarded on the **same declared+forwarded
path** that `ib_invoice_cost_updated` uses, for **every** observed transition on
the subscribed session's bus (mid-flight transitions included, not only terminal
ones). The bridge SHALL NOT drop, coalesce away, or reshape a state transition
that carries an `invoice_id`. This makes a mounted invoice detail view reflect
state changes with no navigation and no reload, because the frame reaches the
browser addressed by its `invoice_id` on the road cost already proves.

#### Scenario: State-changed is invoice-addressable like cost

- **WHEN** `ib:invoice-state-changed` is emitted with `{ invoice_id, state,
  hold_reason? }`
- **THEN** the forwarded `ib_invoice_state_changed` frame's `payload.data` SHALL
  contain the same `invoice_id` verbatim
- **AND** a consumer holding that invoice open SHALL be able to route the event
  by `invoice_id` without knowing the producing session id

#### Scenario: Every mid-flight transition is forwarded, not only terminal

- **WHEN** an invoice moves through several intermediate states before a terminal
  one, each emitting `ib:invoice-state-changed`
- **THEN** each transition SHALL be forwarded as `ib_invoice_state_changed`
- **AND** no intermediate transition SHALL be dropped or collapsed

#### Scenario: State rides the same forward cost proves

- **WHEN** `ib:invoice-cost-updated` and `ib:invoice-state-changed` are both
  emitted on the same subscribed session's bus
- **THEN** both SHALL be forwarded over the same `ib_domain_event` road to the
  browser
- **AND** the state frame SHALL arrive whenever the cost frame would, for the
  same invoice
