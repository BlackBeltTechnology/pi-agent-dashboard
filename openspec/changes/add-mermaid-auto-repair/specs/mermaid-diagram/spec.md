## MODIFIED Requirements

### Requirement: Mermaid diagram rendering
The MermaidBlock component SHALL accept a `code` string prop containing Mermaid diagram syntax, lazy-load the mermaid library via dynamic import, render the diagram to SVG using `mermaid.render()`, sanitize the SVG output using DOMPurify to remove script tags, event handlers, and other XSS vectors, and display the sanitized SVG inside a zoomable viewport container that spans the full content area width. When rendering the original source fails, the component SHALL attempt rule-based repair (see `mermaid-rule-repair`) before falling back to the error display.

#### Scenario: Valid Mermaid diagram
- **WHEN** a mermaid code block contains valid Mermaid syntax (e.g., `graph TD; A-->B`)
- **THEN** the component SHALL render a sanitized SVG diagram inside a zoomable viewport container

#### Scenario: Loading state
- **WHEN** the mermaid library is being loaded via dynamic import
- **THEN** the component SHALL display a loading placeholder

#### Scenario: Invalid Mermaid syntax
- **WHEN** a mermaid code block contains invalid syntax
- **AND** rule-based repair applies no rule, or the repaired source also fails to render
- **THEN** the component SHALL display the raw code text with the error message from the original render attempt

#### Scenario: Repairable Mermaid syntax
- **WHEN** a mermaid code block contains invalid syntax that rule-based repair fixes
- **THEN** the component SHALL render the repaired diagram with an auto-fixed indication

#### Scenario: Multiple diagrams on same page
- **WHEN** multiple mermaid code blocks appear in the same markdown content
- **THEN** each diagram SHALL render independently with unique IDs, independent zoom state, and no conflicts

#### Scenario: Component unmounts during render
- **WHEN** the component unmounts while mermaid.render() is in progress
- **THEN** the stale render result SHALL be discarded without errors

#### Scenario: SVG contains malicious content
- **WHEN** mermaid.render() produces SVG containing `<script>` tags, `onload` attributes, or other XSS vectors
- **THEN** DOMPurify SHALL strip all executable content before DOM injection
- **AND** valid SVG elements (paths, text, groups) SHALL be preserved

### Requirement: Mermaid SVG cache prevents re-render blink
MermaidBlock SHALL cache the render outcome at module scope keyed by the original diagram code and theme. The cached outcome SHALL be one of: rendered SVG; repaired SVG with its repaired source, applied rules and the original render error; or a render error. When mermaid is re-initialized for a different theme, every cached outcome is invalidated and the next mount re-renders (and, if needed, re-repairs); the no-re-render guarantee applies within one theme initialization. On mount, if a cached outcome exists for the current code+theme, it SHALL initialize with it instead of showing a loading state or re-running render or repair.

#### Scenario: Remount with cached SVG
- **WHEN** a MermaidBlock unmounts and remounts with the same code and theme
- **THEN** it SHALL display the cached SVG immediately without a loading flash

#### Scenario: Remount with cached repaired outcome
- **WHEN** a MermaidBlock whose diagram was repaired unmounts and remounts with the same code and theme
- **THEN** it SHALL display the repaired diagram and its auto-fixed indication immediately without re-running render or repair

#### Scenario: Remount with cached error
- **WHEN** a MermaidBlock whose diagram failed to render (and could not be repaired) unmounts and remounts with the same code and theme
- **THEN** it SHALL display the cached error immediately without a loading flash and without re-running render or repair

#### Scenario: Theme change invalidates cache entry
- **WHEN** the theme changes from dark to light (or vice versa)
- **THEN** MermaidBlock SHALL re-render the diagram with the new theme and cache the result separately

### Requirement: Mermaid hydration in AsciiDoc previews

The mermaid rendering component SHALL be mountable against mermaid source extracted from rendered AsciiDoc preview HTML, in addition to markdown fenced code blocks, preserving its existing behavior: theme-aware rendering, SVG caching, zoomable viewport, rule-based repair of failing diagrams, and raw-source-with-error display when repair does not produce a renderable diagram.

#### Scenario: Adoc-sourced mermaid renders identically
- **WHEN** the same mermaid source is rendered from a markdown fence and from an AsciiDoc source block
- **THEN** both produce the same sanitized SVG behavior (theme-aware, cached, zoomable)

#### Scenario: Invalid adoc-sourced mermaid degrades
- **WHEN** an AsciiDoc mermaid block contains invalid syntax that rule-based repair cannot fix
- **THEN** the raw code text is displayed with an error message, matching markdown behavior

#### Scenario: Repairable adoc-sourced mermaid is repaired
- **WHEN** an AsciiDoc mermaid block contains invalid syntax that rule-based repair fixes
- **THEN** the repaired diagram is displayed with an auto-fixed indication, matching markdown behavior
