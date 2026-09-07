## ADDED Requirements

### Requirement: AsciiDoc preview styling

The AsciiDoc preview SHALL render the returned HTML inside a dedicated `.asciidoc-body` scope with stylesheet rules covering asciidoctor's embedded-output class vocabulary, using theme CSS custom properties only (no hardcoded colors), so all registered themes and both dark/light variants track automatically. The styling SHALL cover: section heading hierarchy with distinct sizes per level, the TOC panel when the document declares `:toc:`, tables including `frame`/`grid`/`stripes` attribute variants, admonition blocks (NOTE/TIP/WARNING/IMPORTANT/CAUTION) presented as accent-bordered cards, ordered/unordered/description lists with proper indentation, and listing/source blocks. The `prose prose-invert` classes (dead without `@tailwindcss/typography`) SHALL be removed from the components wrapping rendered AsciiDoc and docx HTML output.

#### Scenario: Headings render hierarchically
- **WHEN** an AsciiDoc document with nested section levels is previewed
- **THEN** each heading level renders at a visually distinct size, larger than body text

#### Scenario: TOC panel styled when declared
- **WHEN** the previewed document declares `:toc:` and the rendered HTML contains a `#toc` element
- **THEN** the TOC renders as a visually distinct panel with indented nesting and themed link colors

#### Scenario: Admonition renders as accent card
- **WHEN** the rendered HTML contains an `admonitionblock` (e.g. NOTE)
- **THEN** it renders as a block card with a type-colored accent border and surface background, not as a bare table

#### Scenario: Key/value table with frame=none
- **WHEN** a table with `frame=none` and `grid=none` attributes is previewed
- **THEN** cells keep padding and alignment without borders

#### Scenario: Striped data table
- **WHEN** a table with `stripes=even` is previewed
- **THEN** even rows render with an alternate surface background and the header row is visually distinct

#### Scenario: Colors come from theme variables
- **WHEN** the active theme changes
- **THEN** the AsciiDoc preview colors follow the new theme without stylesheet changes (all colors resolve through CSS custom properties)

#### Scenario: Docx html-mode shares the typography scope
- **WHEN** a docx file is previewed in html mode
- **THEN** its output renders inside the same `.asciidoc-body` scope and picks up the same typography rules
