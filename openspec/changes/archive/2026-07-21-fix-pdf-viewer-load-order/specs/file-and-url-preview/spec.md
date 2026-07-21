## MODIFIED Requirements

### Requirement: PDF preview renders as a continuous-scroll viewer

`PdfPreview` SHALL render the document via the pdfjs component viewer (`PDFViewer` from `pdfjs-dist/web/pdf_viewer.mjs`) in continuous-scroll mode: all pages stacked vertically in a single scroll container, with page rendering virtualized (only near-viewport pages painted). The component SHALL enable the text layer so text is selectable and in-document find works. It SHALL NOT render a Prev/Next paging toolbar; navigation is native scroll. The public component contract (`Props { target, srcUrl? }`) is unchanged, so `DocxPreview`, `PptxPreview`, and `EmlPreview` reuse it unmodified via `srcUrl`.

Because `pdfjs-dist/web/pdf_viewer.mjs` reads `globalThis.pdfjsLib` at module-evaluation time (a side-effect global set only when the main `pdfjs-dist` module evaluates) and has no static import edge to it, `PdfPreview` SHALL fully load the main `pdfjs-dist` module BEFORE importing the viewer module. It SHALL NOT load the two concurrently (e.g. via `Promise.all`), since Vite splits them into separate chunks with no module-graph ordering guarantee and a viewer-first evaluation throws `Cannot destructure property 'AbortException' of 'globalThis.pdfjsLib' as it is undefined`.

#### Scenario: Multi-page PDF scrolls continuously

- **GIVEN** a `.pdf` with multiple pages is previewed
- **WHEN** the user scrolls the preview
- **THEN** pages flow continuously in one scroll container (no Prev/Next click required)
- **AND** no Prev/Next paging toolbar is present

#### Scenario: PDF text is selectable and findable

- **GIVEN** a text-bearing `.pdf` is previewed
- **WHEN** the user selects text or triggers browser find (ctrl-F)
- **THEN** the text layer allows selection and the find matches within the document

#### Scenario: Viewer honours dark theme

- **GIVEN** a dark dashboard theme is active
- **WHEN** a PDF preview mounts
- **THEN** the viewer gutter/background honours the dashboard `--bg-canvas` theme token rather than the pdfjs default light background

#### Scenario: Viewer loads after the pdfjs global is populated

- **GIVEN** a `.pdf` is previewed
- **WHEN** `PdfPreview` mounts the viewer
- **THEN** the main `pdfjs-dist` module SHALL be fully loaded (populating `globalThis.pdfjsLib`) before `pdfjs-dist/web/pdf_viewer.mjs` is imported
- **AND** the viewer mounts without a `globalThis.pdfjsLib` destructuring error
