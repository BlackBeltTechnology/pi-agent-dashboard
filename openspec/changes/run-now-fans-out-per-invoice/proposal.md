## Why

The `wire-per-invoice-automation-drain` change taught the scheduler fire path to
honour `scope: per-invoice` on an action: on each scheduled fire, the engine
enumerates the queued invoices and fires one scoped run per invoice (resolved
`${invoice_id}` + `env`). That fan-out lives in the engine's `dispatchFire`,
wired into the scheduler's `onFire`.

The manual **Run-now** path never routes through `dispatchFire`. The Run-now
board action (and the REST `run-now`) call `runNowViaEngine`, which invokes
`engine.startRunFor(found)` DIRECTLY — with no fire context. For a
`scope: per-invoice` automation (the intake drain) this starts ONE folder-level
run whose payload still carries the unresolved literal `${invoice_id}`: the flow
finds no invoice, nothing drains, and the invoice stays `queued`. A live faux
e2e that drives processing via Run-now therefore fails every flow spec with
"never reached … (last seen: queued)".

## What Changes

Make Run-now honour `scope: per-invoice` exactly like the scheduler fire:

- **Fan-out-aware run-now on the engine.** Add `engine.runNow(automation)` that,
  for a `scope: per-invoice` action, enumerates the queued invoices (via the same
  injected enumerator `dispatchFire` uses) and starts ONE run per queued invoice,
  each bound to its invoice id with the resolved `${invoice_id}` and scoped `env`
  (`IB_TOOLSET` / `IB_INVOICE_ID`). A non-per-invoice automation starts exactly
  one run, unchanged. An empty queue starts no run; a missing enumerator skips
  (mirrors `dispatchFire`). It returns the first started run's id so the route
  contract (`{ ok, runId? }`) holds.
- **Route run-now through it.** `runNowViaEngine` calls `engine.runNow(found)`
  instead of `engine.startRunFor(found)`.
- **Shared fan-out core.** Extract the per-invoice enumerate→context step so
  `dispatchFire` (scheduler) and `runNow` (manual) share ONE fan-out
  implementation — no duplicated invoice logic, no behavioural drift between the
  two entry points.

Existing scheduler fan-out behaviour and non-per-invoice single-fire dispatch are
unchanged.

## Impact

- Affected specs: `automation-per-invoice-fanout` (Run-now honours the fan-out).
- Affected code: `packages/automation-plugin/src/server/engine.ts` (extract the
  shared fan-out core; add `runNow`), `index.ts` (route run-now through
  `engine.runNow`).
- Behaviour: a manual Run-now on the intake drain now advances every queued
  invoice in its own scoped run instead of no-oping on an unresolved token.

## Discipline Skills

- `review-code` — non-trivial engine change that unifies two dispatch entry
  points; review before commit.
