## MODIFIED Requirements

### Requirement: Server SHALL extend `/api/file` and add `/api/file/raw`

`GET /api/file?cwd=<cwd>&path=<relPath>` SHALL return `{ type: "file", kind, mimeType, size, mtime, content? }` for file entries. `content` SHALL be present when the classified `viewer ∈ { "monaco", "markdown" }` OR when `editable === true` (so an editable non-markdown tab such as `.csv` or `.adoc` can load its text into Monaco). `content` SHALL be omitted for all other kinds, including `image`, `pdf`, `binary`, `docx`, `pptx`, `xlsx` spreadsheets, and `email`.

`mtime` SHALL be the file's modification time in milliseconds at full filesystem precision (not rounded or truncated). It is the optimistic-concurrency token for `POST /api/file/write`. Echoing it back unchanged for an unmodified file SHALL pass the write-side conflict check.

`GET /api/file/raw?cwd=<cwd>&path=<relPath>` SHALL stream raw file bytes with the resolved `Content-Type` header. Both endpoints SHALL apply the existing security gates: `cwd` admitted by the shared cwd admission guard (`core-cwd-admission`: a known folder — session cwd, pinned directory or workspace folder — or a subdirectory / linked worktree whose main checkout is a known folder); the resolved path SHALL lie inside the containment anchors of `file-read-containment` (path-traversal prevention).

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

#### Scenario: Editable AsciiDoc returns content

- **WHEN** `GET /api/file?cwd=/Users/u/proj&path=guide.adoc` succeeds
- **THEN** the response includes `content` (`editable === true`), `kind: "asciidoc"`

#### Scenario: Fractional mtime round-trips through save

- **GIVEN** an editable `.md` file whose on-disk mtime has a sub-millisecond fraction (e.g. `1700000000000.5`)
- **WHEN** the client loads it via `GET /api/file` and POSTs `/api/file/write` with the returned `mtime` and new content, with no intervening disk change
- **THEN** the server responds `200` and the file holds the new content

#### Scenario: Genuine external change still conflicts

- **GIVEN** a file loaded via `GET /api/file` at token T
- **WHEN** the file is modified on disk and the client POSTs `/api/file/write` with T
- **THEN** the server responds `409` and the file is left untouched

### Requirement: Server SHALL expose a content digest for a file without its content

`GET /api/file/digest?cwd=<cwd>&path=<path>` SHALL return `{ size, mtime, sha1 }` for a
regular file, where `sha1` is the lowercase hex SHA-1 of the file bytes and `mtime` is
the full-precision `stat.mtimeMs`, without returning the content. It SHALL apply the
same cwd admission, path decoding, containment anchors and layers as `GET /api/file`,
in the same order, SHALL admit the same files (including an in-`cwd` symlink to a
regular file, and the grant-verified open for grant-admitted paths), and SHALL refuse with the same status, error,
and remedy fields for every path `GET /api/file` refuses; a path refused by containment
SHALL be refused before existence is revealed. The dashboard client SHALL request
digests opted out of the access-grant prompt, so a prompt-eligible containment miss is
refused immediately (never suspended, never prompting). A directory or other
non-regular file SHALL return `404` without blocking, as SHALL a missing file. For a
file larger than the fixed 256 MiB digest ceiling it SHALL return `{ size, mtime }`
with no `sha1`. The server SHALL always hash; it SHALL NOT report a file unchanged from
caller-supplied metadata. The response SHALL NOT be cacheable.

`POST /api/file/write` SHALL accept request bodies large enough for content up to the
digest ceiling and SHALL refuse content above the ceiling with `413`. It SHALL additionally return `size` and `sha1` of the bytes it
wrote (the UTF-8 encoding of the submitted content) in its success payload, alongside
the existing `mtime`, unless the content exceeds the digest ceiling (then no `sha1`).
A digest of the file immediately after an uncontested write SHALL equal the write's
`sha1`.

#### Scenario: Digest of a contained file
- **GIVEN** `foo.ts` exists under `cwd`
- **WHEN** the client requests `GET /api/file/digest?cwd=<cwd>&path=foo.ts`
- **THEN** the response is `success: true` with `size`, full-precision `mtime` and the file's `sha1`
- **AND** the response contains no file content
- **AND** the response is marked non-cacheable

#### Scenario: Digest refuses exactly what /api/file refuses
- **GIVEN** a path that `GET /api/file` refuses (unknown session, outside containment, or refused grant)
- **WHEN** the client requests its digest
- **THEN** the digest endpoint refuses with the same status, error and remedy fields as `GET /api/file`

#### Scenario: Digest admits what /api/file admits
- **GIVEN** a file that `GET /api/file` serves without a grant (under `cwd`, through an in-`cwd` symlink to a regular file, or under the read site's `~/.pi` anchor)
- **WHEN** the client requests its digest
- **THEN** the response carries its `sha1`

#### Scenario: Missing file outside containment is refused, not 404
- **GIVEN** a non-existent path outside the working directory
- **WHEN** the client requests its digest
- **THEN** the response is the containment refusal, not `404`

#### Scenario: Non-regular file returns 404
- **GIVEN** a directory or a FIFO at the requested path under `cwd`
- **WHEN** the client requests its digest
- **THEN** the response is `404` and the request does not block

#### Scenario: File above the digest ceiling has no hash
- **GIVEN** a file larger than 256 MiB
- **WHEN** the client requests its digest
- **THEN** the response carries `size` and `mtime` and no `sha1`

#### Scenario: Large markdown save is accepted
- **GIVEN** a 20 MiB `notes.md` open for editing
- **WHEN** the user saves it
- **THEN** `POST /api/file/write` succeeds (no request-body-size refusal)

#### Scenario: Write returns the content hash
- **WHEN** `POST /api/file/write` succeeds
- **THEN** the response data contains `mtime`, `size` and the `sha1` of the written bytes
- **AND** an immediate digest of the file returns the same `sha1`
