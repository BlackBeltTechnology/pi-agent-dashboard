# internal-monaco-editor-pane — delta

## MODIFIED Requirements

### Requirement: Pane SHALL dispatch viewers via a kind-based registry

The pane SHALL dispatch the active tab to a viewer via a kind-based registry. The registry SHALL cover: `monaco` (text/code), `markdown`, `image`, `pdf`, `html`, `video`, `audio`, `mermaid`, `docx`, `pptx`, `spreadsheet`, `asciidoc`, `email`, and `binary-warn`. Where a shared `preview/*` renderer exists for a kind, the registry entry SHALL delegate to it rather than a pane-local duplicate:

- `pdf` → `PdfPreview`; `html` → `HtmlPreview` (sandboxed, scripts disabled);
  `image` → `ImagePreview`; `video` → `VideoPreview`; `audio` → `AudioPreview`;
  `mermaid` → `MermaidBlock`.
- `docx` → `DocxPreview`; `pptx` → `PptxPreview`; `spreadsheet` →
  `SpreadsheetPreview`; `asciidoc` → `AsciiDocPreview`; `email` → `EmlPreview`.
  Each reuses the existing shared renderer with its established sandbox /
  remote-content posture; no new preview logic and no new bytes path.

`fileKind` SHALL classify `.html`/`.htm` → html, `.mmd`/`.mermaid` → mermaid, `.mp3`/`.wav`/`.ogg`/`.m4a`/`.flac` → audio, `.webm`/`.mov` → video, `.docx` → docx, `.pptx` → pptx, `.xlsx`/`.xls`/`.csv` → spreadsheet, `.adoc`/`.asciidoc` → asciidoc, and `.eml` → email. The `line` scroll target SHALL be passed only to the `monaco` viewer.

#### Scenario: Office and email kinds dispatch to shared renderers

- **WHEN** the user opens `.docx`, `.pptx`, `.xlsx`, `.adoc`, or `.eml` tabs
- **THEN** they render `DocxPreview`, `PptxPreview`, `SpreadsheetPreview`, `AsciiDocPreview`, and `EmlPreview` respectively
- **AND** none renders as raw text in Monaco

#### Scenario: PDF renders via pdfjs, not a native plugin

- **GIVEN** the pane runs inside the Electron shell (no PDF plugin)
- **WHEN** the user opens a `.pdf` tab
- **THEN** the tab renders `PdfPreview` as a continuous-scroll pdfjs viewer (text-selectable, find-capable), not a Prev/Next paged canvas
