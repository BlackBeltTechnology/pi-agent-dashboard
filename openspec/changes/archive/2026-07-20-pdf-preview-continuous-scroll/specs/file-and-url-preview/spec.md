# file-and-url-preview — delta

## MODIFIED Requirements

### Requirement: PDF preview ships as a lazy chunk

The `PdfPreview` component SHALL be imported via dynamic `import()` (`React.lazy`) so that the `pdfjs-dist` dependency does NOT appear in the main client bundle. The build output SHALL place pdfjs in a separate chunk loaded only when a PDF preview mounts. This includes the pdfjs component viewer (`pdfjs-dist/web/pdf_viewer.mjs`) and its stylesheet (`pdfjs-dist/web/pdf_viewer.css`): both SHALL ride the lazy `PdfPreview` chunk and SHALL NOT appear in the main JS or main CSS bundle.

#### Scenario: Main bundle excludes pdfjs

- **WHEN** `npm run build` runs
- **THEN** the main entry chunk (`assets/index-*.js`) does NOT contain `pdfjs-dist`
- **AND** a separate chunk containing `pdfjs-dist` exists

#### Scenario: Main CSS bundle excludes the pdfjs viewer stylesheet

- **WHEN** `npm run build` runs
- **THEN** the main CSS chunk (`assets/index-*.css`) does NOT contain the `pdf_viewer.css` viewer rules (e.g. the `.pdfViewer` / `.textLayer` selectors)
- **AND** those rules appear only in a lazily-loaded asset

## ADDED Requirements

### Requirement: PDF preview renders as a continuous-scroll viewer

`PdfPreview` SHALL render the document via the pdfjs component viewer (`PDFViewer` from `pdfjs-dist/web/pdf_viewer.mjs`) in continuous-scroll mode: all pages stacked vertically in a single scroll container, with page rendering virtualized (only near-viewport pages painted). The component SHALL enable the text layer so text is selectable and in-document find works. It SHALL NOT render a Prev/Next paging toolbar; navigation is native scroll. The public component contract (`Props { target, srcUrl? }`) is unchanged, so `DocxPreview`, `PptxPreview`, and `EmlPreview` reuse it unmodified via `srcUrl`.

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
