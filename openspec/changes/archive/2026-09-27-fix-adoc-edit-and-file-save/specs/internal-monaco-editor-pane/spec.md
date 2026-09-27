## MODIFIED Requirements

### Requirement: Pane SHALL be read-only in v1

The Monaco editor SHALL be configured with `readOnly: true`. The pane SHALL display no save button, no dirty indicator, and no "+" affordance for creating new files in v1.

The shared `fileKind` classifier SHALL return `editable: false` for every file EXCEPT the editable text kinds — the writable markdown subset (`.md`/`.mdx`), `.csv`, and AsciiDoc (`.adoc`/`.asciidoc`) — which return `editable: true`. Only the Preview/Edit tabs of those kinds (see "Markdown tabs SHALL offer a Preview/Edit toggle") expose a save path; all other viewers (Monaco text/code, media, pdf, html) remain read-only.

When the agent edits a file that the user has open, the pane SHALL NOT auto-refresh. A manual refresh button in the pane header SHALL re-fetch the active file's content from `/api/file`. (Auto-refresh on agent edits is deferred to v4.)

#### Scenario: Read-only editor rejects keystrokes
- **GIVEN** the pane has `foo.ts` open in a Monaco tab
- **WHEN** the user types into the editor area
- **THEN** the buffer content is unchanged
- **AND** no `POST /api/file/write` request is issued

#### Scenario: Manual refresh re-fetches active file
- **GIVEN** `foo.ts` is open in the pane
- **AND** the agent has just written new content to `foo.ts` via the Edit tool
- **WHEN** the user clicks the refresh button in the pane header
- **THEN** the pane issues `GET /api/file?cwd=<cwd>&path=foo.ts`
- **AND** the Monaco buffer updates to the new content
- **AND** the refresh is performed without closing or reopening the tab

### Requirement: Server SHALL extend `/api/file` and add `/api/file/raw`

`GET /api/file?cwd=<cwd>&path=<relPath>` SHALL return `{ type: "file", kind, mimeType, size, content? }` for file entries. `content` SHALL be present when the classified `viewer ∈ { "monaco", "markdown" }` OR when `editable === true` (so an editable non-markdown tab such as `.csv` or `.adoc` can load its text into Monaco). `content` SHALL be omitted for all other kinds, including `image`, `pdf`, `binary`, `docx`, `pptx`, `xlsx` spreadsheets, and `email`.

The response SHALL carry `mtime` as the full-precision `stat.mtimeMs` (no rounding), identical to the token `POST /api/file/write` compares, so an unchanged file never produces a false `409`.

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

#### Scenario: Editable AsciiDoc returns content

- **WHEN** `GET /api/file?cwd=/Users/u/proj&path=guide.adoc` succeeds
- **THEN** the response includes `content` (`editable === true`), `kind: "asciidoc"`

#### Scenario: mtime round-trips into a save without a false conflict

- **GIVEN** a file whose on-disk `mtimeMs` has a sub-millisecond fraction
- **WHEN** the client saves via `POST /api/file/write` with the `mtime` returned by `GET /api/file`, and the file has not changed on disk
- **THEN** the write succeeds with `200` (not `409`)

### Requirement: Markdown tabs SHALL offer a Preview/Edit toggle

An `editable` tab SHALL offer a per-tab **Preview / Edit** toggle. For `.md`/`.mdx`, Edit mode SHALL mount the controlled `MarkdownEditor`. For an editable non-markdown kind — `.csv` and AsciiDoc (`.adoc`/`.asciidoc`) — Preview SHALL render the kind's rich viewer (`SpreadsheetPreview` for `.csv`, `AsciiDocPreview` for AsciiDoc) and Edit SHALL mount a plain Monaco text buffer over the raw file text. The tab body below the toggle toolbar SHALL be the scroll container, since the editor pane supplies none. Saving SHALL `POST /api/file/write` with the buffer's loaded `mtime`; a `409` (changed on disk) SHALL surface the existing changed-on-disk banner and leave the file untouched. Non-editable kinds (`.markdown`, `.xlsx`, `.docx`, `.eml`, …) SHALL remain preview-only with no Edit affordance.

#### Scenario: Edit and save a markdown file

- **GIVEN** a `.md` file open in Preview mode
- **WHEN** the user switches to Edit, changes text, and clicks Save
- **THEN** the client POSTs `/api/file/write` with the loaded `mtime` and the dirty indicator clears on success

#### Scenario: CSV offers a spreadsheet Preview and a Monaco Edit

- **GIVEN** a `.csv` file open in the pane
- **WHEN** the tab renders
- **THEN** Preview shows the `SpreadsheetPreview` grid and an Edit toggle is available
- **WHEN** the user switches to Edit
- **THEN** a Monaco text buffer over the raw CSV is mounted, saved via `/api/file/write` with `mtime`

#### Scenario: AsciiDoc offers a rendered Preview and a Monaco Edit

- **GIVEN** an `.adoc` file open in the pane
- **WHEN** the tab renders
- **THEN** Preview shows the rendered AsciiDoc inside a scrollable body and an Edit toggle is available
- **WHEN** the user switches to Edit, changes text, and clicks Save
- **THEN** the raw source is saved via `/api/file/write` with `mtime`, and returning to Preview re-renders the saved file

#### Scenario: Non-editable kinds have no Edit affordance

- **WHEN** the user opens a `.xlsx`, `.docx`, or `.eml` file
- **THEN** only Preview is available (no Edit toggle)
