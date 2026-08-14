# Design — single-flight per-invoice dispatch

## Home: `automation-plugin` `perInvoiceFanout()`

The scheduler `dispatchFire()` and folder/manual `runNow()` already share
`perInvoiceFanout()`. It receives queued ids from the existing
`invoicebot:queuedInvoices` service and makes the one-per-invoice `FireContext`
list. Filtering there is the only shared scheduler-side choke point; a mutex in
`invoicebot-plugin/session-link.ts` would be wrong because `dispatchFlow()` is an
interactive flow path and does not own scheduler-spawned automation runs.

The direct REST `runInvoice()` path intentionally bypasses queue enumeration, but
it reads the **same** `invoiceInFlight()` predicate — one mechanism, one live-run
registry (`pending`), no duplicate state.

## Guard semantics

- A run has `RunContext.invoiceId` from its `FireContext` and becomes live when
  `startRunFor()` synchronously `enqueuePending`s it.
- `perInvoiceFanout()` drops any enumerated id for which
  `invoiceInFlight(id)` is true. Thus the next scheduler fire cannot start a
  second run for an invoice which is still queued but already processing.
- `runInvoice()` returns `reason:"in_flight"` from that same predicate.
- `runner.fire()` and its `startRun` callback are synchronous after fan-out's
  enumeration await, so a fire's contexts reach `pending` before a later fire
  evaluates the filter.

## Release / no stranded claims

There is no new persistent claim. `pending` is process-lifetime live-run state and
is removed solely through `finishAndRelease → removePending`. Existing callers
cover normal `onSessionEnded`, `onSessionDeath`, explicit stop, spawn failure,
undelivered/stalled reapers, and max-age reaping. A dead run therefore releases
its id and a following scheduler fire can dispatch the invoice again.

## Boundary

This is dispatch-side deduplication only. The engine repository owns store-level
same-record serialization and different-record concurrency; this change neither
adds a database lock nor changes store behavior.
