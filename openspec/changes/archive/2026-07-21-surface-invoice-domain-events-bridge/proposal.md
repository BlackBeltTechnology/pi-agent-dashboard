## Why

The event bridge listens to every `ib:*` InvoiceBot domain event on the pi
session event bus, but only two of them — `ib:approval-requested` and
`ib:approval-decided` — are given a stable, renamed protocol type before being
forwarded. Every other lifecycle domain event (invoice state, connector,
intake, automation, source) reaches the dashboard only under its raw colon-form
bus channel, which is not a name a client can rely on subscribing to. The rename
coverage is incomplete: a client that wants to react to invoice-state
transitions or connector/intake/source activity has no fixed protocol name.

The engine already emits the full lifecycle set headless-safe (no subscriber =
no-op; emission never fails the underlying write), and `flow:*` events already
demonstrate the stable-rename-and-forward pattern. This change extends the same
treatment to the whole `ib:*` lifecycle set.

## What Changes

- **Extend the domain-event rename map** so every lifecycle `ib:*` event is
  forwarded with a stable, renamed protocol type (colon → underscore form,
  e.g. `ib:invoice-state-changed` → `ib_invoice_state_changed`), payload
  preserved verbatim.
- **Preserve the two events renamed today** (`ib_approval_requested`,
  `ib_approval_decided`) unchanged — additive only.
- **Honour existing gating**: events fire only after the session is ready, and a
  missing/absent event never throws.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `invoicebot-event-bridge`: the stable-rename coverage SHALL span the full
  lifecycle `ib:*` set (invoice-state, approval, connector, intake, automation,
  source), not just the approval pair, with each event's payload preserved.

## Impact

- **Bridge code**: `packages/extension/src/flow-event-wiring.ts` — extend
  `IB_EVENT_MAP` with the lifecycle entries. No new forwarding mechanism; the
  existing EventBus catch-all + rename path carries them.
- **Tests**: `packages/extension/src/__tests__/` — assert each new lifecycle
  `ib:*` event forwards under its renamed protocol type with payload preserved,
  and that the two pre-existing renames still pass (regression).
- **Docs**: update the nearest `AGENTS.md` row for `flow-event-wiring.ts`.
- **Additive**: existing `flow:*` forwarding and the approval renames are
  untouched.

## Discipline Skills

- `doubt-driven-review` — the colon→underscore rename table is a client-facing
  contract; review the full mapping before it stands so no name drifts or is
  omitted.
