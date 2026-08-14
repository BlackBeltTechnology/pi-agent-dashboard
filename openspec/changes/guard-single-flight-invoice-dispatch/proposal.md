## Why

A queued invoice remains `queued` until a processing run claims its drop file.
The scheduler's per-invoice fan-out therefore re-enumerates it on the next fire.
Today `perInvoiceFanout()` maps every queued id to a `FireContext` without asking
whether that id already has a live processing run; the automation concurrency
policy limits automation rate, not per-invoice ownership. Two fires about a
minute apart started two runs for `d896bc0a90942348`; their concurrent writers
collided.

`POST /api/plugins/invoicebot/run-invoice` must also refuse an in-flight invoice
honestly. A route-only mutex would not fix the scheduler path that caused the
duplicate. The scoped-chat bootstrap's `inFlightByKey` is unrelated: it only
deduplicates persistent chat-session creation, not `invoicebot:process` runs.

## What Changes

- Make the automation engine's existing `pending` run registry the single
  per-invoice live-run authority. Its `invoiceInFlight(invoiceId)` predicate is
  already used by the one-invoice route path; use the same predicate inside
  `perInvoiceFanout()` before it creates `FireContext`s.
- This one filter covers both fan-out consumers: scheduler `dispatchFire()` and
  folder/manual `runNow()`. The direct `runInvoice()` entry keeps its existing
  check against the same predicate, not a second state store or mutex.
- Preserve release after death: the registry is removed through
  `finishAndRelease → removePending` on normal completion, session death, stop,
  spawn error, and reaper backstops. Once a dead run finalizes, its invoice is
  dispatchable again. No persistent claim is introduced.

## Capabilities

### Modified Capabilities

- `automation-per-invoice-fanout`: filter queued ids that already have a live,
  bound processing run before either scheduler or folder/manual fan-out dispatches
  them; release the guard when the tracked run finalizes.
- `invoicebot-run-invoice`: its `in_flight` response is backed by the same shared
  engine registry as scheduler fan-out, rather than an endpoint-only guard.

## Impact

- `packages/automation-plugin/src/server/engine.ts` only.
- Focused unit tests prove scheduler refusal, cross-path refusal, and
  redispatch after session death/completion.
- No engine-repo store concurrency change: same-record serialization belongs to
  the engine store; different-invoice concurrency remains untouched here.

## Discipline Skills

- `doubt-driven-review` — check that the guard lives at the shared fan-out core,
  not only at the REST endpoint, and that every terminal path releases it.
- `review-code` — concurrency-sensitive behavioral change with release-after-death
  safety property.
