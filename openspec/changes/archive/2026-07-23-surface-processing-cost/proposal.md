## Why

InvoiceBot emits an `ib:invoice-cost-updated` domain event on the session event
bus carrying the full live processing-cost aggregate:
`{ invoice_id, currency, total, tokens, perStep, updatedAt, final }`.
Each `perStep` entry carries
`{ stepId, agent?, provider?, model?, tokensIn, tokensOut, cost }`. Live accrual
uses `final:false`; successful and genuinely-held terminals emit one freeze with
`final:true`; idle runs emit no cost event. Costs use USD and may be sub-cent.
Every other `ib:*` lifecycle event is already given a stable renamed protocol
type by the event bridge and rebroadcast app-level, but the cost event is not in
the rename map — so it passes through under its raw bus channel and never reaches
the app-level `ib_domain_event` fan-out that a many-invoice view relies on.

## What Changes

- Add one row to the bridge's `ib:*` rename map:
  `ib:invoice-cost-updated` → `ib_invoice_cost_updated`.
- With the mapped `ib_` name, the existing app-level rebroadcast (prefix
  `ib_`) fans the event out to every connected browser with its `data` payload
  **forwarded verbatim**. This preserves `currency:"USD"`, sub-cent numeric
  precision, `tokens`, the complete replacement `perStep` array, `provider`,
  `model`, `updatedAt`, and the `final` accrual/freeze discriminator.
- A step whose `model` is absent remains absent (`undefined`), never dropped,
  defaulted, or reshaped.
- The existing per-session event stream remains additive: subscribed browsers
  still receive the same event while every browser also receives it through
  `ib_domain_event`.

No REST endpoint, no shared-type schema change, no new socket. The payload is
opaque to the bridge and server and is forwarded unchanged, exactly like the
other lifecycle events.

## Capabilities

### Modified Capabilities
- `invoicebot-event-bridge`: the `ib:*` rename map gains
  `ib:invoice-cost-updated` → `ib_invoice_cost_updated`; the complete producer
  payload is forwarded verbatim, including optional provider/model fields,
  sub-cent values, and `final`.
- `invoicebot-app-level-events`: the renamed cost event reaches every connected
  browser through `ib_domain_event`, independent of per-session subscription,
  while the per-session stream remains unchanged.

## Impact

- **Affected code:** `packages/extension/src/flow-event-wiring.ts` (one
  `IB_EVENT_MAP` entry), bridge-map tests in
  `packages/extension/src/__tests__/surface-invoice-domain-events-bridge.test.ts`,
  and app-level rebroadcast coverage in
  `packages/server/src/__tests__/event-wiring-ib-app-level.test.ts`.
- **No behaviour change** for any existing event; additive only.

## Discipline Skills

None — additive one-line map entry with a matching test assertion; no auth,
performance, or persistence surface.
