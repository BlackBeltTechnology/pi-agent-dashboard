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

