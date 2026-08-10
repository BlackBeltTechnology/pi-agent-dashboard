# file-and-url-preview — delta

> Engine decision resolved to **A′** (pptx → PDF → existing `PdfPreview`, fidelity-first; see
> `design.md`). The MODIFIED requirement below carries the full current requirement (union +
> every sibling scenario) with `"pptx"` folded in, per openspec whole-requirement replacement.

## MODIFIED Requirements

### Requirement: Renderer dispatch is purely shape-based

A pure function `dispatchPreview(target: ViewTarget): RendererKind` SHALL select the
renderer using only the target's shape (extension for files; host + URL extension for
URLs). It SHALL NOT perform server round-trips, MIME sniffing, or file reads to make the
decision. `RendererKind` SHALL be one of
`"markdown" | "asciidoc" | "html" | "pdf" | "video" | "audio" | "image" | "youtube" | "docx" | "pptx" | "spreadsheet" | "email" | "fallback"`.
The `.pptx` file extension (compared case-insensitively) SHALL map to `"pptx"`.

#### Scenario: Markdown extension
- **WHEN** `dispatchPreview({ kind: "file", cwd, path: "x.md" })` is called
- **THEN** the result is `"markdown"`

#### Scenario: PDF extension
- **WHEN** the file extension is `.pdf`
- **THEN** the result is `"pdf"`

#### Scenario: Video extensions
- **WHEN** the file extension is one of `.mp4`, `.webm`, `.mov`
- **THEN** the result is `"video"`

#### Scenario: Audio extensions
- **WHEN** the file extension is one of `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`
- **THEN** the result is `"audio"`

#### Scenario: Image extensions
- **WHEN** the file extension is one of `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`
- **THEN** the result is `"image"`

#### Scenario: HTML extension
- **WHEN** the file extension is `.html` or `.htm`
- **THEN** the result is `"html"`

#### Scenario: DOCX extension
- **WHEN** the file extension is `.docx` (compared case-insensitively)
- **THEN** the result is `"docx"`

#### Scenario: PPTX extension
- **WHEN** the file extension is `.pptx` (compared case-insensitively)
- **THEN** the result is `"pptx"`

#### Scenario: Spreadsheet extensions
- **WHEN** the file extension is `.xlsx` or `.csv` (compared case-insensitively)
- **THEN** the result is `"spreadsheet"`

#### Scenario: EML extension
- **WHEN** the file extension is `.eml`
- **THEN** the result is `"email"`

#### Scenario: Unknown file extension
- **WHEN** the file extension is unrecognized (e.g. `.dat`)
- **THEN** the result is `"fallback"`

## ADDED Requirements

### Requirement: PPTX renders on demand via a rendering engine

The `.pptx` preview SHALL be rendered by a rendering engine (via `document-converter`, whose
image already bundles LibreOffice) rather than an in-process library, and SHALL be **user-
initiated** (an explicit "Render slides" affordance), NOT auto-rendered on mount — because
engine conversion incurs multi-second Docker latency. On activation the server SHALL convert
the deck to PDF via `renderPdf` (cached by path+mtime+size) and the client SHALL mount the
existing `PdfPreview` against the shared `GET /api/file/rendered-pdf` stream. The render SHALL
be bounded by a `stat.size` cap (oversize → HTTP 413 before conversion) with a download-original
escape hatch. Unlike docx, there is NO in-process fallback renderer for pptx: when the engine /
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
