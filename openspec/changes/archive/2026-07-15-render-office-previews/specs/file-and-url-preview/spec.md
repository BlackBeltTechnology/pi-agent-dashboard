# file-and-url-preview — delta

## MODIFIED Requirements

### Requirement: Renderer dispatch is purely shape-based

A pure function `dispatchPreview(target: ViewTarget): RendererKind` SHALL select the
renderer using only the target's shape (extension for files; host + URL extension for
URLs). It SHALL NOT perform server round-trips, MIME sniffing, or file reads to make the
decision. `RendererKind` SHALL be one of
`"markdown" | "asciidoc" | "html" | "pdf" | "video" | "audio" | "image" | "youtube" | "docx" | "spreadsheet" | "fallback"`.

#### Scenario: Markdown extension
- **WHEN** `dispatchPreview({ kind: "file", cwd, path: "x.md" })` is called
- **THEN** the result is `"markdown"`

#### Scenario: PDF extension
- **WHEN** the file extension is `.pdf`
- **THEN** the result is `"pdf"`

#### Scenario: HTML extension
- **WHEN** the file extension is `.html` or `.htm`
- **THEN** the result is `"html"`

#### Scenario: DOCX extension
- **WHEN** the file extension is `.docx` (compared case-insensitively)
- **THEN** the result is `"docx"`

#### Scenario: Spreadsheet extensions
- **WHEN** the file extension is `.xlsx` or `.csv` (compared case-insensitively)
- **THEN** the result is `"spreadsheet"`

#### Scenario: Unknown file extension
- **WHEN** the file extension is unrecognized (e.g. `.dat`)
- **THEN** the result is `"fallback"`

## ADDED Requirements

### Requirement: DOCX rendered two ways, engine-gated

The server render endpoint `GET /api/file/render?cwd=&path=` SHALL, for a `.docx` file, return a
discriminated result `{ success: true, data: { mode, … } }` where `mode` is `"pdf"` or `"html"`:

- When the `document-converter` engine is available, the endpoint SHOULD render the docx to PDF
  via the existing `renderPdf` facade, cache it (keyed by path + mtime + size), and return
  `{ mode: "pdf" }`; the PDF bytes SHALL be streamed by a companion
  `GET /api/file/rendered-pdf?cwd=&path=` endpoint, not inlined in this response.
- Otherwise — or when any engine call fails (`DOCKER_UNAVAILABLE`, non-zero exit, timeout) — the
  endpoint SHALL fall back to `{ mode: "html", html, truncated, imageCount, note }`, where `html`
  is produced by `mammoth` and DOMPurify-sanitized server-side. The `mammoth` parse SHALL apply
  a `transformDocument` hyperlink-guard that sets `href` to an empty string on any hyperlink node
  whose href and anchor are both null, so documents that would otherwise crash `mammoth` render
  successfully, and SHALL apply the bounded-preview policy (strip images past a count/byte cap).

The endpoint SHALL reject any extension it does not support (compared case-insensitively) with
HTTP 400, SHALL enforce anti-traversal by calling the same shared gate helper as
`/api/file/raw`, and SHALL reject a file whose size exceeds a configured cap (HTTP 413) before
reading it into memory. The raw `.docx` bytes SHALL NOT be returned to the client. A missing or
unavailable engine SHALL never fail the request.

#### Scenario: Engine available renders to PDF
- **GIVEN** the `document-converter` engine is available
- **WHEN** a valid `.docx` is requested
- **THEN** the response is `{ mode: "pdf" }` and `GET /api/file/rendered-pdf` streams the PDF bytes

#### Scenario: Engine unavailable falls back to sanitized HTML
- **GIVEN** the engine is unavailable (or its call fails)
- **WHEN** a valid `.docx` with headings and a table is requested
- **THEN** the response is `{ mode: "html" }` whose `html` contains the heading and table markup
  with no `<script>` or event-handler attributes

#### Scenario: Hyperlink-guard prevents the null-href crash (html mode)
- **GIVEN** the engine is unavailable and a `.docx` contains a hyperlink with neither a URL
  target nor an internal anchor
- **WHEN** it is rendered
- **THEN** the response is `success: true`, `mode: "html"` with rendered HTML (no server error)

#### Scenario: Image-heavy docx is bounded (html mode)
- **GIVEN** the engine is unavailable and a `.docx` whose image count or HTML size exceeds the cap
- **WHEN** it is rendered
- **THEN** `data.truncated` is `true`, images are replaced with placeholders, and `data.html`
  stays below the byte cap

#### Scenario: Corrupt docx degrades, does not crash
- **WHEN** a corrupt or non-zip `.docx` is requested
- **THEN** the response is `{ success: false, error }` and the worker does not crash

#### Scenario: Oversize docx rejected before read
- **WHEN** a `.docx` larger than the size cap is requested
- **THEN** the response is HTTP 413 and the full file is not read into memory

### Requirement: Spreadsheet parse endpoint

The server SHALL expose `GET /api/file/sheet?cwd=&path=&limit=` that parses a `.xlsx` or `.csv`
file with SheetJS and returns
`{ success: true, data: { sheets: [{ name, header, rows, totalRows, totalCols, truncated }], activeSheet, encoding } }`.
Each sheet's `rows` SHALL be bounded to the first N rows (default 500, overridable up to a
maximum by `limit`) and to a configured column cap, with `truncated` set when the sheet exceeds
either cap and `totalRows`/`totalCols` reporting the true dimensions. For `.csv`, the endpoint
SHALL detect the file encoding and decode to UTF-8 before parsing, reporting the decoded charset
in `data.encoding`. The endpoint SHALL reject any extension other than `.xlsx`/`.csv` (compared
case-insensitively) with HTTP 400, SHALL enforce anti-traversal by calling the same shared gate
helper as `/api/file/raw`, and SHALL reject a file whose size exceeds a configured cap
(HTTP 413) before reading it into memory.

#### Scenario: Multi-sheet workbook parsed with tabs
- **WHEN** a `.xlsx` with multiple sheets is requested
- **THEN** `data.sheets` has one entry per sheet and `data.activeSheet` names the first

#### Scenario: Large sheet is bounded
- **GIVEN** a sheet with more rows than the cap
- **WHEN** it is requested
- **THEN** its `rows` length equals the cap, `truncated` is `true`, and `totalRows` reports the
  true row count

#### Scenario: Non-UTF-8 csv decoded
- **GIVEN** a `.csv` encoded as windows-1250 (e.g. Hungarian, with ő/ű double-acute vowels)
- **WHEN** it is requested
- **THEN** the accented characters decode correctly and `data.encoding` reports a
  Central-European (Latin-2 family) charset such as `"ISO-8859-2"` or `"windows-1250"`
  (statistical detection may label either; both decode the shared Hungarian letters identically)

#### Scenario: Password-protected or corrupt spreadsheet degrades
- **WHEN** a password-protected or corrupt spreadsheet is requested
- **THEN** the response is `{ success: false, error }` and the worker does not crash

#### Scenario: Oversize spreadsheet rejected before read
- **WHEN** a `.xlsx`/`.csv` larger than the size cap is requested
- **THEN** the response is HTTP 413 and the full file is not read into memory

### Requirement: DOCX and spreadsheet renderers mount in shared shells

`PreviewBody` SHALL render the `"docx"` kind with a `DocxPreview` component and the
`"spreadsheet"` kind with a `SpreadsheetPreview` component, so both the inline `PreviewCard` and
the `/view` overlay use the same renderer. `DocxPreview` SHALL fetch `/api/file/render`, show
loading and error states, and branch on `data.mode`: for `"pdf"` it SHALL mount the existing
`PdfPreview` against `/api/file/rendered-pdf`; for `"html"` it SHALL render the sanitized HTML
via `dangerouslySetInnerHTML` and show a truncation banner when `data.truncated`.
`SpreadsheetPreview` SHALL fetch `/api/file/sheet`,
render a frozen-header grid with sheet tabs for multi-sheet workbooks, and show a truncation
banner reporting bounded vs. total rows (and decoded charset for `.csv`). Any server
`{ success: false }` SHALL render the existing `FallbackPreview` download card.

#### Scenario: docx inline and overlay share the renderer
- **WHEN** a `.docx` is viewed inline and then expanded to the `/view` overlay
- **THEN** both render via `DocxPreview`

#### Scenario: docx pdf mode mounts PdfPreview
- **GIVEN** a `/api/file/render` response with `mode: "pdf"`
- **WHEN** `DocxPreview` renders
- **THEN** it mounts `PdfPreview` pointed at `/api/file/rendered-pdf`

#### Scenario: Truncation banner shown when bounded
- **GIVEN** a spreadsheet response with `truncated: true`
- **WHEN** `SpreadsheetPreview` renders
- **THEN** a banner shows the bounded row count, the total row count, and a download affordance

#### Scenario: Server failure falls back to download
- **GIVEN** a server response `{ success: false }`
- **WHEN** the renderer handles it
- **THEN** the existing `FallbackPreview` download card is shown
