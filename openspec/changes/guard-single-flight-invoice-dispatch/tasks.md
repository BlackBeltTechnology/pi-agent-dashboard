# Tasks — guard-single-flight-invoice-dispatch

- [x] Add the shared `invoiceInFlight(invoiceId)` filter to `perInvoiceFanout()` before it creates per-invoice fire contexts.
- [x] Keep `runInvoice()` on the same predicate; do not add an endpoint-only mutex or second registry.
- [x] Document the release path: `finishAndRelease → removePending` frees the invoice after normal completion, session death, stop, spawn failure, or reaper finalization.
- [x] Unit test scheduler second-fire refusal while the invoice remains queued and its first run is live.
- [x] Unit test only the live invoice is filtered while a newly queued invoice still runs.
- [x] Unit test release after `onSessionDeath`, then scheduler redispatch of the same queued invoice.
- [x] Unit test cross-path sharing: scheduler blocks `runInvoice`; `runInvoice` blocks scheduler fan-out.
- [x] Run focused automation tests and `tsc --noEmit`.
- [ ] Run scoped automation-plugin test suite; record any clean-base-reproducing unrelated failure.
- [ ] Run `npm run build`.
- [ ] Manual/QA: observe a queued invoice with a live scoped process run is not redispatched on the next scheduler fire, then is eligible after that run dies.
