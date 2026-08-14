## Why

A **queued** invoice (landed in the drop folder, not yet processed) has, by design, never had its bytes interpreted: intake writes its arrival row in state `queued` with only the true-at-arrival facts (`content_hash`, `original_ref`, `source_ref`, `filename`, `arrived_at`) and **no `blob_handle`** — a blob is created only later, inside the processing intake node. Two operator surfaces are therefore impossible today:

1. **Preview the queued original.** `GET /api/plugins/invoicebot/blob` only accepts a `handle` that resolves under `<cwd>/.pi/flows/invoicebot-state/blobs/`. A queued invoice has no handle, so its source document cannot be shown.
2. **Start exactly one queued invoice ("Futtatás most").** There is no scoped, single-invoice run entry point. The interactive reprocess path emits a bare `flow:run` with no `IB_TOOLSET` / `IB_INVOICE_ID`, so it starts the invoice with **no scoped session**; the manual run-now and the scheduler fan out over **every** queued invoice at once.

Both gaps are closable with **no engine change** — the queued row already persists everything required, and the per-invoice fan-out core already exists in `automation-plugin`.

## What Changes

- **`GET /api/plugins/invoicebot/blob` gains an `invoice_id` form** (additive; the existing `handle` form is byte-for-byte unchanged). Given `invoice_id`, the route resolves the invoice's landed original — the exact target of the queued row's `original_ref` (fallback `source_ref`), which by construction is `<state>/drop/<invoice_id>_<basename>` (the invoice id **is** the content hash; the engine's own `droppedExists` locates a drop file by the same `<hash>_` prefix). The resolved path MUST be **confined to the engine state directory** (`<cwd>/.pi/flows/invoicebot-state/`): traversal / absolute / symlink escapes are rejected, only an existing **regular file** is served, and a consumed drop file yields `404`. The existing content-type / content-disposition / range handling is reused unchanged.
- **New endpoint `POST /api/plugins/invoicebot/run-invoice` `{ invoice_id }`** starts **one** scoped run for **exactly that invoice** through the **same per-invoice fan-out** the scheduler (`dispatchFire`) and manual run-now already share — so the run carries `IB_TOOLSET=scoped-invoice` + `IB_INVOICE_ID=<id>` and the invoice gets its own scoped session. It MUST NOT trigger global automation, fan out other invoices, or fire a folder-level run. It returns the started run identity.
- **One-in-flight invariant.** When the target invoice already has a run in flight, `run-invoice` SHALL refuse with a distinct machine-readable result (`409` / `{ ok:false, reason:"in_flight" }`) rather than silently starting a second run — two flows must never process the same record.
- **Reuse the existing cross-plugin seam, no second dispatch path.** `automation-plugin` already **consumes** `invoicebot:queuedInvoices`; this change adds the reverse: `automation-plugin` **provides** `automation:runInvoice(cwd, invoiceId)` (a thin wrapper that scans the per-invoice intake automation for the workspace, enforces the one-in-flight check on the engine's tracked runs, and starts exactly one run via the existing `startRunFor` core). The invoicebot route **consumes** that service lazily (load-order safe).

## Capabilities

### New Capabilities

- `invoicebot-run-invoice`: A dashboard REST endpoint `POST /api/plugins/invoicebot/run-invoice` that starts exactly one scoped run for a single queued invoice through the existing per-invoice fan-out core, refusing when that invoice already has a run in flight.

### Modified Capabilities

- `invoicebot-blob-delivery`: the blob route additionally resolves a queued invoice's landed original by `invoice_id`, confined to the engine state directory, with the `handle` form unchanged.
- `automation-per-invoice-fanout`: the fan-out engine additionally exposes a start-one-invoice-by-id capability (tracking each run's bound invoice id) and a cross-plugin service that refuses when that invoice already has a run in flight.

## Impact

- **Dashboard code**:
  - `packages/invoicebot-plugin/src/server/blob.ts` — add an `invoice_id`→drop-file resolver confined to the state dir; `routes.ts` — the `/blob` handler accepts `invoice_id`; new `/run-invoice` route.
  - `packages/invoicebot-plugin/src/server/index.ts` — pass a lazily-consumed `automation:runInvoice` resolver to the routes.
  - `packages/automation-plugin/src/server/engine.ts` — track `invoiceId` per run; add `runInvoice(automation, invoiceId)` (one-in-flight refusal + one `startRunFor`); `index.ts` — `provide("automation:runInvoice", …)`.
- **No engine change.** `@blackbelt-technology/invoicebot` is untouched: the queued row already persists `original_ref`/`source_ref`, and the drop-file naming convention is the engine's own.
- **Security surface.** `invoice_id` becomes a client-supplied value feeding a filesystem read; it is validated (safe charset, no separators/traversal) and the resolved real path is re-checked for containment before any byte is served.
- **Behavioral note.** REST stays request/response. The started run's identity is returned so the client can bind; live conversation continues to ride the WS plane.

## Discipline Skills

- `security-hardening` — the `invoice_id` blob form turns untrusted input into a filesystem read; the path-confinement guard (charset validation + lexical + realpath containment + regular-file check) is the crux and must be adversarially reviewed.
- `doubt-driven-review` — the one-in-flight invariant is a concurrency-correctness guarantee ("two flows must never process the same record"); stress-test the check-then-start atomicity before it stands.
- `review-code` — non-trivial cross-plugin change touching two plugins and a security-sensitive route; run the inline review before commit.
