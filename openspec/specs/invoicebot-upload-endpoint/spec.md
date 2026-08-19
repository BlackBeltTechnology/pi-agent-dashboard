# invoicebot-upload-endpoint Specification

## Purpose
TBD - created by archiving change add-upload-intake. Update Purpose after archive.
## Requirements
### Requirement: Multipart upload endpoint
The plugin SHALL expose `POST /api/plugins/invoicebot/upload` accepting
`Content-Type: multipart/form-data` with a `cwd` field and one or more file
parts. It SHALL stream each file part to an in-memory buffer and forward the raw
bytes to the engine's `ingest` port method keyed by `cwd`. The request is
authenticated by the dashboard's existing global auth hook, identically to the
other invoicebot routes.

#### Scenario: Valid PDF is forwarded and lands
- **WHEN** a client POSTs a multipart request with a valid `cwd` and one PDF file part
- **THEN** the plugin forwards the raw bytes to `engine.ingest(cwd, files)`
- **AND** responds `200` with `results[0].status === "landed"` and `landed === 1`

#### Scenario: Multiple files in one request
- **WHEN** a client POSTs several file parts in one request
- **THEN** the response `results[]` has one entry per uploaded file, each echoing its `filename`
- **AND** the aggregate `landed`/`skipped`/`rejected` counts sum to the number of files

### Requirement: Per-file outcome contract
The endpoint SHALL return the engine's ingest result verbatim: a `results[]`
array where each entry carries `filename`, `hash`, `status`
(`"landed" | "skipped" | "rejected"`), and an optional `reason`, plus aggregate
`landed`, `skipped`, and `rejected` counts. A well-formed request SHALL succeed
even when individual files are rejected; per-file status conveys individual
outcomes.

#### Scenario: Duplicate bytes are skipped
- **WHEN** the same file bytes are uploaded a second time
- **THEN** that file's `status` is `"skipped"` with `reason` `"duplicate"`

#### Scenario: Unsupported type is rejected without failing the request
- **WHEN** a request contains one supported file and one unsupported-type file
- **THEN** the response is `200`
- **AND** the supported file is `"landed"` and the unsupported file is `"rejected"` with a type reason

#### Scenario: Every file rejected still returns 200
- **WHEN** every file in a well-formed request is rejected by the engine
- **THEN** the response is `200` with all `results[]` entries `"rejected"` and `landed === 0`

### Requirement: Boundary size and count limits
The endpoint SHALL enforce a per-file size cap of 20 MB and a maximum of 20 file
parts per request at the multipart boundary, so an oversized or excessive upload
is bounded before the engine validates. A part that exceeds the per-file cap
SHALL be reported as a `"rejected"` outcome for that file with reason `"too large"`
while other files in the same request continue to be processed; its partial bytes
SHALL NOT be forwarded to the engine.

#### Scenario: Oversize file is rejected, others proceed
- **WHEN** a request contains one file over 20 MB and one file within the cap
- **THEN** the oversize file is `"rejected"` with reason `"too large"`
- **AND** the within-cap file is processed normally in the same response

### Requirement: Input validation
The endpoint SHALL reject malformed requests with `400`: a missing or blank `cwd`,
a `cwd` that is not an existing directory, or a request with no file parts. This
mirrors the `cwd` validation the other invoicebot routes apply.

#### Scenario: Missing cwd
- **WHEN** a request omits `cwd` or sends a blank `cwd`
- **THEN** the response is `400` with an error and the engine is not called

#### Scenario: No file parts
- **WHEN** a request has a valid `cwd` but contains no file parts
- **THEN** the response is `400` with an error and the engine is not called

### Requirement: No flow dispatch
The endpoint SHALL NOT dispatch a flow. Unlike the flow-triggering operations,
`ingest` returns no flow specification; the route returns the ingest result
directly.

#### Scenario: Upload does not spawn a session
- **WHEN** a successful upload lands one or more files
- **THEN** the response carries no `sessionId` and no flow is dispatched

### Requirement: Engine ingest port method
The `InvoiceEngine` port SHALL expose `ingest(cwd, files)` accepting an array of
`{ filename, bytes }` and returning `{ results, landed, skipped, rejected }`.
Both bindings SHALL implement it: the real binding as a pass-through to the engine
facade, and the fake binding as a deterministic simulation (magic-byte type check
+ content-hash dedup + size cap) so the offline verification gate passes with no
real engine present.

#### Scenario: Fake binding classifies by magic bytes and dedup
- **WHEN** the fake binding receives a PDF, a PNG, an unsupported file, and a repeat of the PDF
- **THEN** the PDF and PNG are `"landed"`, the unsupported file is `"rejected"`, and the repeated PDF is `"skipped"` with reason `"duplicate"`

