## MODIFIED Requirements

### Requirement: Binary-safe file serving endpoint

The server SHALL expose `GET /api/file/raw?cwd=&path=` that streams the file contents with `Content-Type` derived from the file extension via a shared `extToContentType` mapping. The endpoint SHALL enforce the same anti-traversal gate as `/api/file`: `cwd` must be admitted by the shared cwd admission guard (`core-cwd-admission`: a known folder — session cwd, pinned directory or workspace folder — or a subdirectory / linked worktree whose main checkout is a known folder), and `path.resolve(cwd, relPath)` must remain inside `cwd`. The endpoint SHALL support HTTP `Range` requests so `<video>` seek bars work.

#### Scenario: Unknown cwd rejected

- **GIVEN** `cwd` is not admitted (not a known folder, nor a subdirectory or linked worktree whose main checkout is a known folder)
- **WHEN** the client requests `/api/file/raw?cwd=/unknown&path=foo.pdf`
- **THEN** the server responds with HTTP 403 and `{ success: false, error: "unknown session path", code: "cwd_unknown" }`

#### Scenario: Path traversal rejected

- **GIVEN** `cwd` is a known session cwd
- **WHEN** the client requests `/api/file/raw?cwd=/home/u/proj&path=../../../etc/passwd`
- **THEN** the server responds with HTTP 403 and `{ success: false, error: "path outside working directory" }`

#### Scenario: PDF served with correct Content-Type

- **GIVEN** `foo.pdf` exists inside a known cwd
- **WHEN** the client requests `/api/file/raw?cwd=…&path=foo.pdf`
- **THEN** the response Content-Type is `application/pdf` and the body is the raw file bytes

#### Scenario: Range request returns 206

- **GIVEN** `video.mp4` exists inside a known cwd
- **WHEN** the client requests with `Range: bytes=1024-2047`
- **THEN** the response status is 206 (Partial Content) with the requested byte range and a `Content-Range` header

#### Scenario: Missing file returns 404

- **GIVEN** the resolved path does not exist on disk
- **WHEN** the client requests `/api/file/raw`
- **THEN** the response status is 404

#### Scenario: Pinned folder without a session is served
- **GIVEN** `cwd` is a pinned directory with no live session
- **WHEN** the client requests `/api/file/raw?cwd=<pinned>&path=report.pdf`
- **THEN** the server SHALL stream the file with HTTP 200

### Requirement: EML parse endpoint

The server SHALL expose `GET /api/file/eml?cwd=&path=` that parses the file as a MIME
`message/rfc822` document with `mailparser`, sanitizes the HTML body with DOMPurify
(server-side), and returns `{ success: true, data: { headers, html, text, attachments } }`
where `attachments` is an array of `{ index, filename, mimeType, size, contentId, isInline }`
(metadata only — no attachment bytes). Parsing SHALL occur server-side; the raw `.eml` bytes
and inlined attachment base64 SHALL NOT be returned to the client. The endpoint SHALL reject
any extension other than `.eml` (compared case-insensitively) with HTTP 400. It SHALL reject a
file whose size exceeds a configured cap (default 25 MB) with HTTP 413 **before** reading it
into memory. It SHALL enforce anti-traversal by **calling the same shared gate helper as
`/api/file/raw`** (not a re-implementation). The parse result MAY be memoized in a short-lived
cache keyed by path + mtime + size so the attachment endpoint does not re-parse per request.

#### Scenario: EML parsed to headers, sanitized body, attachment metadata
- **GIVEN** `mail.eml` exists in a known cwd and contains a `multipart/mixed` message with an
  HTML body and one PDF attachment
- **WHEN** the client requests `/api/file/eml?cwd=…&path=mail.eml`
- **THEN** the response is `{ success: true, data: { headers, html, text, attachments } }`
- **AND** `attachments` has one entry with `mimeType: "application/pdf"` and its `filename`,
  `size`, and `index`
- **AND** `data` does NOT contain the attachment's base64 bytes

#### Scenario: Body HTML is sanitized
- **GIVEN** an `.eml` whose HTML body contains a `<script>` tag and an `onclick` attribute
- **WHEN** parsed through this endpoint
- **THEN** the returned `html` contains neither the `<script>` element nor the `onclick`
  attribute

#### Scenario: Non-EML rejected
- **WHEN** the path's extension is `.pdf`
- **THEN** the response status is 400 and `{ success: false, error: "renderer not supported for extension" }`

#### Scenario: EML extension matched case-insensitively
- **WHEN** the path is `Mail.EML`
- **THEN** the endpoint accepts it (extension compared lowercased) and parses normally

#### Scenario: Oversized EML rejected before read
- **GIVEN** an `.eml` file larger than the configured size cap (default 25 MB)
- **WHEN** the client requests `/api/file/eml`
- **THEN** the response status is 413 and the server does NOT read the full file into memory

#### Scenario: Unknown cwd rejected
- **GIVEN** `cwd` is not admitted (not a known folder, nor a subdirectory or linked worktree whose main checkout is a known folder)
- **WHEN** the client requests `/api/file/eml?cwd=/unknown&path=mail.eml`
- **THEN** the server responds with HTTP 403

#### Scenario: Malformed MIME fails gracefully
- **GIVEN** a `.eml` file whose MIME structure is corrupt/truncated
- **WHEN** parsed through this endpoint
- **THEN** the server responds with an HTTP **400** error and `{ success: false, error: … }`
  and does NOT crash the process (malformed parse uses 400, consistent with the file-routes
  error convention of 400/403/404/413/500 — not 422)
