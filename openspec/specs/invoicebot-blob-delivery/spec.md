# invoicebot-blob-delivery Specification

## Purpose
HTTP byte delivery of a retained invoice original document, scoped to a workspace's blob store under `<cwd>/.pi/flows/invoicebot-state/blobs/`, path-traversal-guarded and range-capable, so the browser's native viewer can render it (PDF, PNG, JPEG).

## Requirements

### Requirement: Blob byte delivery route
The invoicebot-plugin SHALL expose `GET /api/plugins/invoicebot/blob` that streams
the bytes of a retained original document identified by a `handle`, scoped to a
workspace `cwd`, so a browser can render it natively.

#### Scenario: PDF served inline
- **WHEN** a GET request supplies a valid `cwd` and a `handle` resolving to an
  existing `.pdf` under `<cwd>/.pi/flows/invoicebot-state/blobs/`
- **THEN** the response is `200` with `Content-Type: application/pdf`,
  `Content-Disposition: inline`, `Accept-Ranges: bytes`, and the file bytes

#### Scenario: image served inline
- **WHEN** the resolved handle ends in `.png`, `.jpg`, or `.jpeg`
- **THEN** the `Content-Type` is `image/png` or `image/jpeg` accordingly, served inline

#### Scenario: unknown type falls back to octet-stream
- **WHEN** the resolved handle has an extension outside the previewable set
- **THEN** the `Content-Type` is `application/octet-stream` (the client offers a download)

### Requirement: Range request support
The route SHALL honor HTTP `Range` requests so a browser PDF viewer can page-in
large documents lazily.

#### Scenario: partial content
- **WHEN** a request includes a satisfiable `Range` header
- **THEN** the response is `206 Partial Content` with a `Content-Range` header and
  only the requested byte range

#### Scenario: full content
- **WHEN** no `Range` header is present
- **THEN** the response is `200` with `Content-Length` and the full body

### Requirement: Path-traversal containment
The route SHALL resolve the target real path and serve it only if it stays inside
the request workspace's `blobs/` directory.

#### Scenario: traversal handle rejected
- **WHEN** `handle` contains `..` segments, is an absolute path, or resolves
  (following symlinks) outside `<cwd>/.pi/flows/invoicebot-state/blobs/`
- **THEN** the response is `403` and no bytes are served

#### Scenario: missing or invalid inputs
- **WHEN** `cwd` or `handle` is absent, or `cwd` is not a valid workspace directory
- **THEN** the response is `400`

#### Scenario: file absent
- **WHEN** inputs are valid and contained but the file does not exist
- **THEN** the response is `404`

### Requirement: No MIME re-interpretation
The route SHALL set `X-Content-Type-Options: nosniff` so the browser does not
re-interpret served bytes as HTML or script.

#### Scenario: nosniff header present
- **WHEN** any successful blob response is returned
- **THEN** it carries `X-Content-Type-Options: nosniff`

### Requirement: Header-safe Content-Disposition filename encoding

The blob route SHALL construct its `Content-Disposition` header so that no byte
outside printable US-ASCII ever reaches a header value. For a filename containing
non-ASCII characters the header SHALL carry BOTH a sanitised ASCII `filename`
parameter AND an RFC 5987 `filename*=UTF-8''<percent-encoded>` parameter. The
filename SHALL be treated as untrusted input: control characters, CR/LF, quotes,
backslashes and path separators SHALL NOT appear literally in the header value.
The response's status code, `Content-Type`, `Accept-Ranges`, `Content-Range`,
`Content-Length`, `X-Content-Type-Options` and body bytes SHALL be unchanged by
this encoding.

#### Scenario: accented filename is served, not rejected

- **WHEN** a valid handle resolves to a file whose name contains non-ASCII
  characters (for example `Szoftverfejlesztő` or `É`)

- **THEN** the response SHALL be `200` with `Content-Type: application/pdf`
- **AND** the `Content-Disposition` header SHALL contain an ASCII-only `filename`
  parameter AND a `filename*=UTF-8''` parameter encoding the original name
- **AND** the response SHALL NOT fail with an invalid-header error

#### Scenario: ASCII filename keeps its plain form

- **WHEN** the resolved filename is already header-safe printable US-ASCII
- **THEN** the `Content-Disposition` header SHALL be exactly
  `inline; filename="<name>"`, byte-identical to the previous behaviour
- **AND** no `filename*` parameter SHALL be added

#### Scenario: header injection attempt is neutralised

- **WHEN** the resolved filename contains a quote, backslash, CR/LF or other
  control character
- **THEN** those characters SHALL NOT appear literally in the header value
- **AND** the response SHALL still be a well-formed successful blob response

#### Scenario: encoding does not disturb range delivery

- **WHEN** a satisfiable `Range` request targets a file with a non-ASCII filename
- **THEN** the response SHALL be `206` with the correct `Content-Range` and the
  requested bytes, carrying the same encoded `Content-Disposition`

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
