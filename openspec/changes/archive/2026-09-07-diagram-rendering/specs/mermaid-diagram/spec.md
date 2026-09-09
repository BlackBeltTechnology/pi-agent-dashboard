## ADDED Requirements

### Requirement: Mermaid hydration in AsciiDoc previews

The mermaid rendering component SHALL be mountable against mermaid source extracted from rendered AsciiDoc preview HTML, in addition to markdown fenced code blocks, preserving its existing behavior: theme-aware rendering, SVG caching, zoomable viewport, and raw-source-with-error display on invalid syntax.

#### Scenario: Adoc-sourced mermaid renders identically
- **WHEN** the same mermaid source is rendered from a markdown fence and from an AsciiDoc source block
- **THEN** both produce the same sanitized SVG behavior (theme-aware, cached, zoomable)

#### Scenario: Invalid adoc-sourced mermaid degrades
- **WHEN** an AsciiDoc mermaid block contains invalid syntax
- **THEN** the raw code text is displayed with an error message, matching markdown behavior
