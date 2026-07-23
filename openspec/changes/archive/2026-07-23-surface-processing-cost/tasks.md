## 1. Bridge rename map

- [x] 1.1 Add `"ib:invoice-cost-updated": "ib_invoice_cost_updated"` to
  `IB_EVENT_MAP` in `packages/extension/src/flow-event-wiring.ts` (alphabetical
  placement next to `ib:invoice-state-changed`).

## 2. Bridge tests

- [x] 2.1 Update the bridge-map completeness assertion in
  `packages/extension/src/__tests__/surface-invoice-domain-events-bridge.test.ts`
  to include the new channel in the expected lifecycle key set.
- [x] 2.2 Assert `IB_EVENT_MAP["ib:invoice-cost-updated"]` equals
  `"ib_invoice_cost_updated"`.
- [x] 2.3 Forward a representative producer payload and assert deep equality for
  `invoice_id`, `currency:"USD"`, sub-cent `total`, `tokens`, the complete
  `perStep` array (`stepId`, optional `agent`/`provider`/`model`, token counts,
  sub-cent `cost`), `updatedAt`, and both `final:false` / `final:true`.
- [x] 2.4 Assert a `perStep` entry with an absent `model` stays absent
  (`undefined`) and is not dropped, defaulted, rounded, or reshaped.

## 3. App-level rebroadcast tests

- [x] 3.1 Extend
  `packages/server/src/__tests__/event-wiring-ib-app-level.test.ts` with
  `ib_invoice_cost_updated`: a browser not subscribed to the originating session
  receives `ib_domain_event` with the originating `sessionId` and a deeply-equal
  producer payload.
- [x] 3.2 Assert the cost event remains on the per-session stream for subscribed
  browsers while app-level delivery is additive.
- [x] 3.3 Assert sub-cent values and the `final` discriminator survive the
  app-level rebroadcast unchanged.

## 4. Validate

- [ ] 4.1 `npm test` (zero-network faux) green.
- [x] 4.2 `npm run build` green.
- [x] 4.3 `openspec validate surface-processing-cost --strict` passes.
