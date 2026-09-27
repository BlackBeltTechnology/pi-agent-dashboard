## MODIFIED Requirements

### Requirement: Server SHALL extend `/api/file` and add `/api/file/raw`

`GET /api/file?cwd=<cwd>&path=<relPath>` SHALL return `{ type: "file", kind, mimeType, size, mtime, content? }` for file entries. `content` SHALL be present when the classified `viewer ∈ { "monaco", "markdown" }` OR when `editable === true` (so an editable non-markdown tab such as `.csv` can load its text into Monaco). `content` SHALL be omitted for all other kinds, including `image`, `pdf`, `binary`, `docx`, `pptx`, `xlsx` spreadsheets, `asciidoc`, and `email`.

`mtime` SHALL be the file's modification time in milliseconds at full filesystem precision (not rounded or truncated). It is the optimistic-concurrency token for `POST /api/file/write`. Echoing it back unchanged for an unmodified file SHALL pass the write-side conflict check.

`GET /api/file/raw?cwd=<cwd>&path=<relPath>` SHALL stream raw file bytes with the resolved `Content-Type` header. Both endpoints SHALL apply the existing security gates: `cwd` matched against a known session path; resolved path SHALL start with `cwd + path.sep` (path-traversal prevention).

The file-kind discrimination SHALL invoke the shared `fileKind` module with the first 1024 bytes of the file as the `sniff` argument; the server SHALL NOT read the full file just to classify.

#### Scenario: Editable CSV returns content

- **WHEN** `GET /api/file?cwd=/Users/u/proj&path=data.csv` succeeds
- **THEN** the response includes `content` (`editable === true`), `kind: "spreadsheet"`

#### Scenario: Binary spreadsheet omits content

- **WHEN** `GET /api/file?cwd=/Users/u/proj&path=book.xlsx` succeeds
- **THEN** the response does NOT include `content` (`editable === false`)

#### Scenario: Office/email omit content

- **WHEN** `GET /api/file?cwd=/Users/u/proj&path=report.docx` (or `mail.eml`) succeeds
- **THEN** the response does NOT include `content`
- **AND** the client renders it via the rich viewer, not Monaco raw text

#### Scenario: Fractional mtime round-trips through save

- **GIVEN** an editable `.md` file whose on-disk mtime has a sub-millisecond fraction (e.g. `1700000000000.5`)
- **WHEN** the client loads it via `GET /api/file` and POSTs `/api/file/write` with the returned `mtime` and new content, with no intervening disk change
- **THEN** the server responds `200` and the file holds the new content

#### Scenario: Genuine external change still conflicts

- **GIVEN** a file loaded via `GET /api/file` at token T
- **WHEN** the file is modified on disk and the client POSTs `/api/file/write` with T
- **THEN** the server responds `409` and the file is left untouched
