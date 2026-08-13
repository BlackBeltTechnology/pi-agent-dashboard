# Tasks — scoped-session-liveness (dashboard half)

All work stays under `packages/invoicebot-plugin/`. No `packages/extension`,
`packages/server`, or `packages/shared` change.

## 1. Adopt the producer-run scoped session (invoicebot-session-profile)

- [ ] 1.1 In `src/server/session-link.ts`, confirm `recordedUsableSession` /
  `resolveRecordedSessionIds` surface the producer's per-invoice **bound** scoped
  run (`IB_INVOICE_ID` set; `automationRun.name` `invoicebot-scoped:<invoice_id>`
  or per-invoice `invoicebot:process`) as a canonical candidate.
- [ ] 1.2 Ensure the canonical-adoption gate ADOPTS that bound scoped session and
  returns its live/auto-resumable id, with **no dashboard-initiated spawn** when
  it exists.
- [ ] 1.3 Confirm the global-never-adopted guard still rejects shared
  `invoicebot-intake` / `invoicebot-pull` / `ask` sessions as canonical.
- [ ] 1.4 Confirm `POST /api/plugins/invoicebot/scoped-session` spawn remains a
  fallback only (invoice with no bound scoped session), never a liveness path.

## 2. Keep domain events invoice-addressable and complete (invoicebot-event-bridge)

- [ ] 2.1 In `src/bridge/index.ts` / `src/server/index.ts`, confirm
  `payload.data.invoice_id` is preserved verbatim on `ib_invoice_state_changed`
  (as it is on `ib_invoice_cost_updated`).
- [ ] 2.2 Confirm `ib_invoice_state_changed` is forwarded for every observed
  transition (no drop/coalesce), on the same `ib_domain_event` road as cost.

## Tests (faux, zero-network)

- [ ] T.1 session-link: a bound `invoicebot-scoped:<invoice_id>` recorded run is
  adopted as canonical and returned WITHOUT a spawn (assert spawn not called).
- [ ] T.2 session-link: an invoice with only a shared `invoicebot-intake`
  recorded run yields NO canonical adoption of that intake session.
- [ ] T.3 session-link: an invoice with no bound scoped session triggers NO
  proactive spawn outside the explicit `POST /scoped-session` call.
- [ ] T.4 event-bridge: `ib:invoice-state-changed` forwards
  `ib_invoice_state_changed` with `payload.data.invoice_id` preserved verbatim.
- [ ] T.5 event-bridge: a sequence of mid-flight `ib:invoice-state-changed`
  emissions each forward one frame (none dropped/collapsed).

## Validate

- [ ] V.1 `cd packages/invoicebot-plugin && npm test` (or the repo faux suite)
  green for the new/adjusted specs.
- [ ] V.2 `openspec validate scoped-session-liveness --strict` passes.
- [ ] V.3 Manual (deferred, tested at gate): open an invoice before processing,
  hold it open — greeting/progress/data go live with no navigation while the
  producer runs the invoice's scoped session.
