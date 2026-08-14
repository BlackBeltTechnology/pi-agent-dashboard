# Tasks — serve-and-start-queued-invoice

## 1. Blob-by-invoice_id (endpoint 1)

- [ ] 1.1 Add `resolveInvoiceOriginalPath(cwd, invoiceId)` to `packages/invoicebot-plugin/src/server/blob.ts`: validate `invoiceId` (non-empty, no NUL, no path separators / `..`), scan `<cwd>/.pi/flows/invoicebot-state/drop` for an entry named `` `${invoiceId}_…` ``, realpath-confine to `<cwd>/.pi/flows/invoicebot-state`, require a regular file; return the same `BlobResolution` union (`invalid-input` / `traversal` / `not-found` / `{ ok, abs }`).
- [ ] 1.2 In `routes.ts` `GET /blob`, when `handle` is absent and `invoice_id` present, resolve via 1.1; reuse the existing content-type / content-disposition / range / nosniff response path unchanged. `handle` form stays byte-for-byte identical.
- [ ] 1.3 400 on missing both `cwd` and (`handle` or `invoice_id`); 403 on traversal/escape; 404 on absent drop file.

## 2. Start-one-invoice engine core (endpoint 2, automation side)

- [ ] 2.1 Add optional `invoiceId?: string` to `RunContext`; set it in `startRunFor` from `fireCtx?.invoiceId`.
- [ ] 2.2 Add `runInvoice(automation, invoiceId)` to the engine: scan `pending` for a tracked run with the same `invoiceId` → `{ ok:false, reason:"in_flight" }`; else build one `FireContext { vars:{ invoice_id }, invoiceId }` and `startRunFor` once → `{ ok:true, runId }`. No `await` between the check and `startRunFor`.
- [ ] 2.3 Expose `runInvoice` on the `Engine` interface + returned object.

## 3. Cross-plugin seam

- [ ] 3.1 `automation-plugin/src/server/index.ts`: `ctx.provide("automation:runInvoice", async (cwd, invoiceId) => …)` — scan folder scope for the workspace's `scope: per-invoice` automation and call `eng.runInvoice(found, invoiceId)`; `{ ok:false }` when no per-invoice automation / engine not ready.
- [ ] 3.2 `invoicebot-plugin/src/server/index.ts`: pass a `runInvoice` resolver to the routes that lazily `ctx.consume("automation:runInvoice")` per call.

## 4. run-invoice route (endpoint 2, invoicebot side)

- [ ] 4.1 `POST /api/plugins/invoicebot/run-invoice`: validate `cwd` (`badCwd`) + `invoice_id`; call the resolver. Absent service → `503`. `reason:"in_flight"` → `409 { ok:false, reason:"in_flight" }`. Started → `{ ok:true, runId }`. Other failure → `400`/`503` with error.

## 5. Tests (the only automated safety net)

- [ ] 5.1 blob-by-invoice_id: serves the drop original as `200` with correct content-type; `handle` form unchanged.
- [ ] 5.2 blob path-confinement: `invoice_id` containing `..` / a separator / absolute-ish token is rejected (not `200`); a symlink escaping the state dir is rejected; a consumed (missing) drop file is `404`.
- [ ] 5.3 run-invoice happy path: starts exactly one run bound to the invoice, returns `runId`; no fan-out over other queued invoices.
- [ ] 5.4 run-invoice one-in-flight refusal: a second call while the first run is tracked returns `409` / `{ ok:false, reason:"in_flight" }` and starts no second run.
- [ ] 5.5 run-invoice scoped env: the spawned run carries `IB_TOOLSET=scoped-invoice` + `IB_INVOICE_ID=<id>`.

## 6. Gate

- [ ] 6.1 Scoped/related tests green (`invoicebot-plugin` + `automation-plugin`).
- [ ] 6.2 `npm run build` + `tsc` clean.

## 7. Manual / QA (verified on the live smoke container later)

- [ ] 7.1 Manual: preview a real queued invoice's PDF via `?invoice_id=`; start it via `run-invoice`; observe a scoped session; second start refused.
