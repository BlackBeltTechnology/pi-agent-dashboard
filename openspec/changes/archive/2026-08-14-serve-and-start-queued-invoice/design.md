# Design — serve-and-start-queued-invoice

## Context

Two operator surfaces for a **queued** invoice (landed, not yet processed):
preview its source document, and start exactly one scoped run for it. The engine
already persists everything required; the work is entirely in the two dashboard
plugins.

## Decision 1 — resolve the queued original from the drop folder, no engine change

A queued row carries `original_ref = source_ref = <dropFolder>/<hash>_<basename>`
(`recordArrival` in the engine). The invoice **id is the content hash** (the row's
primary key is the hash), and the default drop folder is `<state>/drop`. The
engine's own `droppedExists(hash)` locates a landed file by scanning the drop
folder for an entry whose name starts with `` `${hash}_` ``.

The dashboard cannot read `original_ref` through any supported seam: no `ib_query`
view projects it, and the engine facade (`@blackbelt-technology/invoicebot/engine`)
exposes only `query/review/setup/rules/ingest/ensureIntakeAutomation`. But it does
not need to — the drop-file location is deterministic. The blob route already
reaches into the state dir directly (`resolveBlobPath` + `createReadStream`), so
resolving `<state>/drop/<invoice_id>_*` is consistent with the established pattern
and needs **zero engine change**.

- **Why not write a blob at arrival?** `recordArrival`'s doctrine is explicit:
  *"Only the facts true at arrival. No canonical, no blob handle … not one byte of
  the content has been interpreted yet."* Writing a blob at arrival would
  contradict that AND duplicate every arrival's bytes (drop + blobs).
- **Why not add an `ib_query` view / engine method?** The engine is a separate,
  standalone artifact; this change is dashboard-only, and the data is already
  reachable via the drop-folder convention the engine itself relies on.

### Containment (the security crux)

`invoice_id` is untrusted. Resolution:
1. Validate `invoice_id` is a safe token — non-empty, no NUL, and no path
   separators / `..` / drive letters (a content-hash id is `[A-Za-z0-9_-]`).
2. `dropDir = resolve(cwd, ".pi/flows/invoicebot-state/drop")`;
   `stateRoot = resolve(cwd, ".pi/flows/invoicebot-state")`.
3. Find the drop entry whose name === `` `${invoice_id}_…` `` (prefix match on the
   literal `` `${invoice_id}_` `` guard). No match → `not-found`.
4. `realpathSync` the candidate and `stateRoot`; the real candidate MUST stay
   inside `realpath(stateRoot)` (defeats symlink escape). Must be a regular file.
5. Serve with the **existing** content-type / content-disposition / range logic.

The `handle` form is untouched: when `handle` is present it takes the existing
path; `invoice_id` is only consulted when `handle` is absent.

## Decision 2 — start one invoice through the existing fan-out core

`automation-plugin`'s engine already has the shared per-invoice core: `startRunFor(
automation, fireCtx)` resolves the action `env` (`resolveScopedEnv`) so a spawn
carries `IB_TOOLSET=scoped-invoice` + `IB_INVOICE_ID=<id>`, and both `dispatchFire`
(scheduler) and `runNow` (manual) drive it. `run-invoice` reuses **exactly** this
core for a single invoice — no new dispatch path.

### The cross-plugin seam

The seam is the existing `ctx.provide` / `ctx.consume` service board. Today
`invoicebot` provides `invoicebot:queuedInvoices`; automation consumes it lazily.
This change adds the reverse direction:

- `automation-plugin` **provides** `automation:runInvoice(cwd, invoiceId)`:
  scans the folder scope for the workspace's `scope: per-invoice` intake
  automation, then calls `engine.runInvoice(found, invoiceId)`.
- `invoicebot-plugin`'s `/run-invoice` route **consumes** `automation:runInvoice`
  lazily at request time (mirrors how automation consumes `queuedInvoices`), so
  plugin load order is irrelevant. Absent service → `503`.

### `engine.runInvoice(automation, invoiceId)`

1. **One-in-flight check** — scan the engine's `pending` run map for any tracked
   run whose bound `invoiceId` equals the target. Present → `{ ok:false,
   reason:"in_flight" }`. (`pending` holds a run from spawn until finalize, so it
   is the in-flight set; scheduler fan-out runs also carry `invoiceId`, so a
   scheduled drain of the same invoice is caught too.)
2. **Start one run** — build a single `FireContext` `{ vars:{ invoice_id }, invoiceId }`
   and call `startRunFor(automation, fireCtx)`. Returns `{ ok:true, runId }`.

**Atomicity:** the check and `startRunFor`'s synchronous `enqueuePending` run with
no `await` between them, so two `run-invoice` calls in the same tick cannot both
pass the check — the first enqueues before the second checks.

Per-run `invoiceId` is threaded by adding an optional `invoiceId` field to
`RunContext`, set in `startRunFor` from `fireCtx?.invoiceId` (the fan-out already
puts the id on the `FireContext`).

## Non-goals

- No change to the `handle` blob form, the scheduler fan-out, or `runNow`.
- No honoring of a custom drop folder located **outside** the state dir — the
  containment guard forbids serving outside `<state>/`, and the default is
  `<state>/drop`. An external drop folder degrades honestly to `404`.
- No cross-process in-flight tracking beyond the automation engine's own run set
  (the interactive reprocess path is a different subsystem the contract routes
  run-now away from).
