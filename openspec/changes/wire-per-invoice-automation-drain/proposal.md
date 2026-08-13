## Why

An automation action can request a per-invoice fan-out: run its flow once for
every invoice currently queued for processing, each run bound to that one
invoice. The intake drain automation asks for exactly this — its
`flows.run` action carries `scope: per-invoice`, `inputs.invoice_id:
"${invoice_id}"`, and `env: { IB_TOOLSET: scoped-invoice, IB_INVOICE_ID:
"${invoice_id}" }`.

The automation engine never honours that request. On each fire it dispatches a
single run for the automation, forwarding the payload verbatim:

- The central interpolator resolves only `${{trigger}}`; the `${invoice_id}`
  token is never a real value, so it reaches the flow as the literal string
  `"${invoice_id}"`.
- The engine dispatches one run per fire — it never enumerates the queued
  invoices, so a queue of N invoices still yields one folder-wide run.
- The action payload's `env` map is dropped; the spawned run session gets no
  `IB_TOOLSET` / `IB_INVOICE_ID`, so it is never scoped to an invoice.

The result: a scheduled drain fires, spawns one unscoped run whose flow input is
an unresolved token that matches no invoice, and nothing advances. Queued
invoices stay queued forever.

## What Changes

Teach the automation engine to honour `scope: per-invoice` on an action:

- **Named-variable interpolation.** Extend the central interpolator to also
  resolve single-brace `${name}` tokens against a per-fire variable map,
  alongside the existing `${{trigger}}` resolution. Per-invoice fan-out supplies
  `{ invoice_id: <id> }` so `${invoice_id}` resolves everywhere in the payload
  (both `inputs` and `env`).
- **Per-invoice fan-out on fire.** When a fired automation's action declares
  `scope: per-invoice`, the engine enumerates the queued invoices for the run's
  workspace (via an injected enumerator), and fires the automation once per
  queued invoice, each fire carrying that invoice's id. An empty queue fires
  nothing. When no enumerator is available the fan-out fire is skipped (never a
  single literal-token run). Fan-out fires flow through the runner's normal
  concurrency policy, so `concurrency: queue` drains the invoices serially.
- **Scoped run env.** Each per-invoice run forwards its resolved action `env`
  map to the spawned run session, scoping it to that one invoice.

Existing `folder`/`global` automations and single-fire dispatch are unchanged:
an action with no `scope: per-invoice` fires exactly once as before.

## Impact

- Affected specs: `automation-template-interpolation` (named-variable
  resolution), `automation-per-invoice-fanout` (new capability).
- Affected code: `packages/automation-plugin/src/server/interpolate.ts`,
  `engine.ts` (fire fan-out + env passthrough), `index.ts` (wire the queued
  enumerator via the cross-plugin service seam);
  `packages/invoicebot-plugin/src/server/index.ts` (publish the queued-invoice
  enumerator).
- Behaviour: a scheduled per-invoice drain now advances every queued invoice in
  its own scoped run instead of no-oping.

## Discipline Skills

- `observability-instrumentation` — the fan-out adds a new dispatch path
  (enumerate → fire-per-invoice); log fan-out count and skip reasons so an
  operator can see why a fire produced N runs (or none).
- `review-code` — non-trivial change across two plugins and the interpolation
  core; review before commit.
