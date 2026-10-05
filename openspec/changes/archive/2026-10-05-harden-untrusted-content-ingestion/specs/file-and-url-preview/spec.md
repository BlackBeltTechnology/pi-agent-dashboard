## MODIFIED Requirements

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
`{ success: false }` SHALL render the existing `FallbackPreview` download card, except an HTTP 413
size-cap refusal, which SHALL render `TooLargePreview` with the office size cap for that kind
(see `untrusted-content-ingestion`).

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
- **GIVEN** a server response `{ success: false }` with a status other than 413
- **WHEN** the renderer handles it
- **THEN** the existing `FallbackPreview` download card is shown

#### Scenario: Size-cap refusal shows the too-large notice
- **GIVEN** a server response with HTTP status 413
- **WHEN** `DocxPreview` or `SpreadsheetPreview` handles it
- **THEN** `TooLargePreview` is shown with that kind's office size cap and an open-raw affordance, and `FallbackPreview` is not shown

### Requirement: PPTX renders on demand via a rendering engine

The `.pptx` preview SHALL be rendered by a rendering engine (via `document-converter`, whose
image already bundles LibreOffice) rather than an in-process library, and SHALL be **user-
initiated** (an explicit "Render slides" affordance), NOT auto-rendered on mount — because
engine conversion incurs multi-second Docker latency. On activation the server SHALL convert
the deck to PDF via `renderPdf` (cached by path+mtime+size) and the client SHALL mount the
existing `PdfPreview` against the shared `GET /api/file/rendered-pdf` stream. The render SHALL
be bounded by a `stat.size` cap (oversize → HTTP 413 before conversion); on a 413 the client
SHALL render `TooLargePreview` with the pptx office size cap and its open-raw escape hatch
instead of `FallbackPreview`. Unlike docx, there is NO in-process fallback renderer for pptx: when the engine /
image is unavailable (or conversion fails), the server SHALL return `{ success:false }` and the
client SHALL degrade to the existing `FallbackPreview` download card with a clear reason.

#### Scenario: PPTX preview is user-initiated, not inline-auto
- **GIVEN** a `.pptx` file in the content area
- **WHEN** it first appears
- **THEN** it does not auto-convert; a "Render slides" affordance is offered, and no server
  render request is made until the user activates it

#### Scenario: PPTX render mounts PdfPreview against the streamed PDF
- **GIVEN** the `document-converter` engine is available
- **WHEN** the user activates the render
- **THEN** the server returns `{ mode: "pdf" }` and the client mounts `PdfPreview` against
  `/api/file/rendered-pdf`, which streams `application/pdf`

#### Scenario: Engine unavailable degrades clearly
- **GIVEN** the `document-converter` engine image is not available
- **WHEN** a `.pptx` render is requested
- **THEN** the server returns `{ success:false }` with no in-process render attempted, and the
  client shows the `FallbackPreview` download card with a reason, and no crash

#### Scenario: Oversize deck is size-gated before conversion
- **GIVEN** a `.pptx` file whose size exceeds the pptx size cap
- **WHEN** a render is requested
- **THEN** the server responds HTTP 413 before invoking the engine

#### Scenario: Oversize deck shows the too-large notice
- **GIVEN** a `.pptx` file whose size exceeds the pptx size cap
- **WHEN** the user activates "Render slides" and the server responds HTTP 413
- **THEN** the client shows `TooLargePreview` with the pptx cap and an open-raw affordance, not `FallbackPreview`
