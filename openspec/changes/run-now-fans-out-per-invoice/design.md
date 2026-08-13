## Context

Two entry points can fire an automation:

- **Scheduler fire** → `scheduler.onFire` → `dispatchFire(automation, ctx)`.
  `dispatchFire` already implements per-invoice fan-out: it enumerates queued
  invoices and calls `runner.fire(automation, fireCtx)` once per invoice, so the
  automation's `concurrency` policy serialises the runs.
- **Manual Run-now** → `runNowViaEngine` → `engine.startRunFor(found)`. This
  bypasses `dispatchFire` entirely and always force-starts exactly one run
  (Run-now is a manual override — it deliberately ignores the concurrency policy
  that gates scheduled fires).

The bug: Run-now's direct `startRunFor` never resolves `${invoice_id}` or scopes
`env`, so a per-invoice automation no-ops.

## Decisions

### Decision 1 — Extract a shared per-invoice fan-out core

Factor the "is this per-invoice? enumerate the queue; build one fire context per
invoice" step out of `dispatchFire` into a single helper that both entry points
call. The helper returns a discriminated result:

- `{ skip: true, reason }` — no enumerator wired, or enumeration threw. Both
  callers treat this as "do nothing" (scheduler logs + drops the fire; run-now
  returns an error so the button surfaces why nothing started).
- `{ skip: false, contexts }` — the per-invoice `FireContext[]` (one per queued
  invoice; empty array when the queue is empty).

`dispatchFire` keeps calling `runner.fire` per context (concurrency-gated).
`runNow` calls `startRunFor` per context (force-start, matching today's Run-now
semantics). One enumerate/resolve implementation, two dispatch styles.

### Decision 2 — Run-now force-starts one run per invoice

`engine.runNow(automation)`:

- Non-per-invoice → `startRunFor(automation)` once (identical to today). Returns
  `{ ok: true, runId }` or `{ ok: false, error }`.
- Per-invoice → run the shared fan-out. `skip` → `{ ok: false, error }`. Empty
  queue → `{ ok: true }` (nothing queued is success, not an error — no runId).
  Otherwise `startRunFor(automation, fireCtx)` per queued invoice and return the
  FIRST started run's id as `runId`.

Run-now force-starts each invoice's run directly via `startRunFor` (not through
`runner.fire`), preserving Run-now's existing "ignore the concurrency gate"
behaviour. The scheduler path is unchanged: it still fans out through
`runner.fire`, so `concurrency: queue` still serialises SCHEDULED drains.

### Decision 3 — Minimal route change

`runNowViaEngine` swaps `engine.startRunFor(found)` for `await
engine.runNow(found)` and returns its result verbatim; the `{ ok, runId?, error?
}` shape is unchanged, so the REST contract and the board action are untouched.

## Non-goals

- No change to the scheduler fan-out, the enumerator wiring, or the interpolation
  core (all delivered by `wire-per-invoice-automation-drain`).
- No change to Run-now's concurrency semantics for non-per-invoice automations.
