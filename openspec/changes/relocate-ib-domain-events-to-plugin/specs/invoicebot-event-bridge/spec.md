# invoicebot-event-bridge — delta

## MODIFIED Requirements

### Requirement: Invoicebot domain events reach the browser with stable names

InvoiceBot domain events (`ib:*`) emitted on the session event bus SHALL be
observed and forwarded by the **invoicebot plugin's bridge entry** — not by any
core bridge rename map. The bridge entry SHALL subscribe per declared channel
via the host event bus's `on()` (so emissions from a foreign extension facade,
e.g. the invoice engine extension, are observed), and SHALL forward each event
over the generic `dashboard:plugin-message` channel with
`pluginId: "invoicebot"`, `messageType: "ib_domain_event"`, and
`payload: { eventType, data }` where `data` is the bus payload verbatim.

Each declared channel's `eventType` SHALL be its **mechanical rename**: every
`:` and `-` in the channel name replaced by `_` (e.g.
`ib:invoice-state-changed` → `ib_invoice_state_changed`). The declared channel
list SHALL live in the invoicebot plugin and SHALL cover the full lifecycle
set:

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

Payloads SHALL be forwarded verbatim (no reshaping). An `ib:*` channel NOT in
the declared list SHALL NOT be forwarded (declared-set semantics; the former
raw-name passthrough is retired). The core `packages/extension` and
`packages/server` code SHALL contain no `ib:*`/`ib_*` channel knowledge.

#### Scenario: Invoice-state-changed reaches the plugin channel with a stable name

- **WHEN** `ib:invoice-state-changed` is emitted on the session bus with
  `{ invoice_id, state, hold_reason? }`
- **THEN** exactly one `dashboard:plugin-message` SHALL be emitted with
  `pluginId "invoicebot"` and `messageType "ib_domain_event"`
- **AND** its `payload.eventType` SHALL be `ib_invoice_state_changed`
- **AND** its `payload.data` SHALL be the bus payload verbatim

#### Scenario: Foreign-extension emissions are observed

- **WHEN** a DIFFERENT extension facade (the invoice engine extension) emits
  `ib:invoice-state-changed` on the shared bus
- **THEN** the plugin bridge entry SHALL still observe and forward it (the
  subscription uses `on()`, never an `emit` intercept)

#### Scenario: Lifecycle set is renamed mechanically

- **WHEN** any declared lifecycle `ib:*` channel is emitted
- **THEN** it SHALL be forwarded with `payload.eventType` equal to the channel
  name with every `:` and `-` replaced by `_`

#### Scenario: Undeclared channel is not forwarded

- **WHEN** `ib:unknown-future-event` (not in the declared list) is emitted on
  the bus
- **THEN** no `dashboard:plugin-message` SHALL be emitted for it

#### Scenario: Cost payload preserved verbatim

- **WHEN** `ib:invoice-cost-updated` is emitted with
  `{ invoice_id, currency, total, tokens, perStep, updatedAt, final }` where
  `perStep` entries carry
  `{ stepId, agent?, provider?, model?, tokensIn, tokensOut, cost }`, sub-cent
  numeric values, and an absent `model` on some step
- **THEN** it SHALL be forwarded as `ib_invoice_cost_updated` with every field
  and numeric value preserved verbatim — nothing rounded, dropped, defaulted,
  or reshaped

#### Scenario: Approval pair still renamed (regression)

- **WHEN** `ib:approval-requested` or `ib:approval-decided` is emitted
- **THEN** it SHALL be forwarded with `payload.eventType`
  `ib_approval_requested` / `ib_approval_decided` respectively, payload
  preserved

#### Scenario: Boot-window emissions are buffered, not dropped (startup race)

- **WHEN** a declared `ib:*` event is emitted after the plugin bridge entry
  activated but BEFORE the host's generic plugin-message listener is
  registered (announced via `dashboard:plugin-listener-ready`)
- **THEN** the event SHALL be buffered (bounded) and forwarded in order when
  the listener-ready announcement arrives
- **AND** a repeated announcement SHALL NOT cause duplicate forwarding
