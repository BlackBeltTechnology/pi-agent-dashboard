## Why

The invoicebot plugin has no write-side door for invoice bytes. Documents can
only enter the pipeline through pollable connectors (which read a server-side
directory the engine process can already see) or be read back out through the
`GET /blob` route. A browser client holding a PDF/PNG in memory has no supported
way to hand those bytes to the engine — every other route forwards a JSON
`{ selector, ...args }` envelope, which binary file content does not fit.

## What Changes

- Add a **file-upload endpoint** `POST /api/plugins/invoicebot/upload` accepting
  `multipart/form-data` (a `cwd` field + one or more file parts). It streams each
  part to a `Buffer` and forwards the raw bytes to the engine, returning the
  per-file ingest outcome. It deliberately breaks the POST-JSON-envelope
  convention for binary I/O — the write-side twin of the existing `GET /blob`
  route, which breaks the GET convention for the same reason.
- Add a fifth method `ingest(cwd, files)` to the `InvoiceEngine` port. Binary
  does not fit the `{ selector, ...args }` envelope, so this is a first-class
  method rather than a selector. Both bindings implement it: `RealInvoiceEngine`
  as a thin pass-through to the engine facade; `FakeInvoiceEngine` as a
  deterministic simulation (magic-byte type check + content-hash dedup) so the
  faux gate and any engine-less CI/worktree stay green.
- Add `@fastify/multipart` as a dependency and enforce request-level size/count
  limits (20 MB per file, 20 files per request) so a large upload cannot exhaust
  memory before the engine validates.
- The route dispatches **no flow** — unlike the flow-triggering `review`/`rules`
  ops, ingest returns no `flow`; the engine drains the drop folder on its own.

## Capabilities

### New Capabilities
- `invoicebot-upload-endpoint`: the plugin exposes a multipart upload route that
  forwards raw invoice bytes to the engine's `ingest` port method keyed by `cwd`,
  returns a per-file ingest outcome, enforces size/count limits, and never
  dispatches a flow.

### Modified Capabilities
<!-- None: this is purely additive; no existing route or spec behavior changes. -->

## Impact

- **`packages/invoicebot-plugin/src/server/routes.ts`** — new `POST /upload` route
  (multipart → `Buffer[]` → `engine.ingest`).
- **`packages/invoicebot-plugin/src/server/engine/port.ts`** — `ingest(cwd, files)`
  added to the `InvoiceEngine` interface; new `IngestFile` / `IngestOutcome` types.
- **`packages/invoicebot-plugin/src/server/engine/real.ts`** — `ingest`
  pass-through; local `InvoiceFacade` interface extended.
- **`packages/invoicebot-plugin/src/server/engine/fake.ts`** — deterministic
  `ingest` fake (magic-byte type gate + hash dedup) — the ship-gate binding.
- **`packages/invoicebot-plugin/package.json`** — `@fastify/multipart` dependency.
- **Auth**: inherits the dashboard's existing global `onRequest` auth hook (it
  authenticates on transport metadata before body parsing — multipart is covered
  identically to the JSON routes, no special handling).

## Discipline Skills

- `security-hardening` — untrusted multipart upload: enforce per-file size and
  per-request count limits, never trust the client-supplied filename or any path,
  forward bytes only (the engine does magic-byte type validation + dedup).
- `observability-instrumentation` — new endpoint: log per-request landed /
  skipped / rejected counts, mirroring the `/blob` route's per-outcome+code logs.
