## ADDED Requirements

### Requirement: Queued original delivery by invoice id

The blob route SHALL additionally accept an `invoice_id` query parameter that
identifies a queued invoice with no `blob_handle`, and SHALL serve the bytes of
that invoice's landed original document — the target of the queued row's
`original_ref` (fallback `source_ref`), which is the file the invoice arrived as,
resident in the workspace drop folder under
`<cwd>/.pi/flows/invoicebot-state/`. The existing `handle` form SHALL be
unchanged: when `handle` is present it governs and `invoice_id` is ignored; the
`invoice_id` form is consulted only when `handle` is absent. The response SHALL
reuse the same content-type, `Content-Disposition`, `Accept-Ranges`,
`X-Content-Type-Options`, and `Range` handling as the `handle` form.

#### Scenario: queued PDF served by invoice id

- **WHEN** a GET request supplies a valid `cwd` and an `invoice_id` whose landed
  original is an existing `.pdf` under the workspace engine state directory
- **THEN** the response SHALL be `200` with `Content-Type: application/pdf`,
  `Content-Disposition: inline`, `Accept-Ranges: bytes`, and the file bytes

#### Scenario: handle form unchanged

- **WHEN** a GET request supplies a valid `cwd` and a `handle` (with or without an
  `invoice_id` also present)
- **THEN** the response SHALL be resolved by the existing `handle` path,
  byte-for-byte identical to the prior behaviour

#### Scenario: range request on a queued original

- **WHEN** a satisfiable `Range` header accompanies an `invoice_id` request
- **THEN** the response SHALL be `206 Partial Content` with a `Content-Range`
  header and only the requested byte range

### Requirement: Invoice-id resolution is confined to the engine state directory

The `invoice_id` form SHALL treat `invoice_id` as untrusted input. The route
SHALL reject an `invoice_id` that is empty, contains a NUL byte, or contains a
path separator or `..` traversal, and SHALL resolve only a file whose real path
(following symlinks) stays inside `<cwd>/.pi/flows/invoicebot-state/`. It SHALL
serve only an existing regular file. A drop file that has been consumed by
processing (moved or removed) SHALL yield `404`.

#### Scenario: traversal or escaping invoice id rejected

- **WHEN** `invoice_id` contains `..`, a path separator, or otherwise resolves
  (following symlinks) to a path outside `<cwd>/.pi/flows/invoicebot-state/`
- **THEN** the response SHALL NOT be `200` and no bytes SHALL be served

#### Scenario: consumed drop file is gone

- **WHEN** `cwd` and `invoice_id` are valid and contained but no matching regular
  file exists in the workspace drop folder (the original was consumed by
  processing)
- **THEN** the response SHALL be `404`

#### Scenario: missing inputs

- **WHEN** neither `handle` nor `invoice_id` is supplied, or `cwd` is absent or is
  not a valid workspace directory
- **THEN** the response SHALL be `400`
