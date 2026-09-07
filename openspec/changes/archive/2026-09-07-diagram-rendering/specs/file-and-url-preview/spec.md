## MODIFIED Requirements

### Requirement: Renderer dispatch is purely shape-based

A pure function `dispatchPreview(target: ViewTarget): RendererKind` SHALL select the
renderer using only the target's shape (extension for files; host + URL extension for
URLs). It SHALL NOT perform server round-trips, MIME sniffing, or file reads to make the
decision. `RendererKind` SHALL be one of
`"markdown" | "asciidoc" | "html" | "pdf" | "video" | "audio" | "image" | "youtube" | "docx" | "pptx" | "spreadsheet" | "email" | "diagram" | "fallback"`.
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

#### Scenario: PlantUML extensions
- **WHEN** the file extension is `.puml` or `.plantuml` (compared case-insensitively)
- **THEN** the result is `"diagram"`

#### Scenario: Unknown file extension
- **WHEN** the file extension is unrecognized (e.g. `.dat`)
- **THEN** the result is `"fallback"`

## ADDED Requirements

### Requirement: Diagram source blocks in AsciiDoc preview hydrate

The AsciiDoc preview SHALL upgrade diagram source blocks in the rendered HTML to rendered diagrams, keying on the language attributes that survive the secure embedded convert (`[source,mermaid]` / `[source,plantuml]` blocks) plus content sniffing for listing blocks that start with `@startuml`. Mermaid blocks SHALL render client-side; PlantUML blocks SHALL render via the diagram render proxy. A block that fails or declines to render SHALL remain visible as its original code listing. Bare style-only blocks (`[mermaid]` without `source`) carry no surviving type information and SHALL remain code listings.

#### Scenario: source,mermaid block hydrates client-side
- **WHEN** a previewed `.adoc` contains a `[source,mermaid]` block with valid mermaid syntax
- **THEN** it renders as a mermaid diagram in place of the code listing, with no server render request

#### Scenario: source,plantuml block hydrates via proxy
- **WHEN** a previewed `.adoc` contains a `[source,plantuml]` block and the proxy resolves an endpoint
- **THEN** it renders as an SVG diagram in place of the code listing

#### Scenario: @startuml sniffing
- **WHEN** a plain listing block's content starts with `@startuml`
- **THEN** it is treated as a PlantUML block and hydrated via the proxy

#### Scenario: Declined rendering leaves the listing
- **WHEN** the proxy declines (no endpoint permitted) or fails
- **THEN** the original code listing remains visible, optionally with an unobtrusive notice

#### Scenario: Bare style block stays a listing
- **WHEN** a previewed `.adoc` contains a bare `[mermaid]` style block (not `[source,mermaid]`)
- **THEN** it remains a code listing (no type information survives the secure convert)
