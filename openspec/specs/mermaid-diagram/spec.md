## Purpose

MermaidBlock renders fenced mermaid code blocks to sanitized, zoomable,
theme-aware SVG diagrams in the dashboard chat/markdown surfaces, with caching
and default-node colorization.
## Requirements
### Requirement: Mermaid diagram rendering
The MermaidBlock component SHALL accept a `code` string prop containing Mermaid diagram syntax, lazy-load the mermaid library via dynamic import, render the diagram to SVG using `mermaid.render()`, sanitize the SVG output using DOMPurify to remove script tags, event handlers, and other XSS vectors, and display the sanitized SVG inside a zoomable viewport container that spans the full content area width.

#### Scenario: Valid Mermaid diagram
- **WHEN** a mermaid code block contains valid Mermaid syntax (e.g., `graph TD; A-->B`)
- **THEN** the component SHALL render a sanitized SVG diagram inside a zoomable viewport container

#### Scenario: Loading state
- **WHEN** the mermaid library is being loaded via dynamic import
- **THEN** the component SHALL display a loading placeholder

#### Scenario: Invalid Mermaid syntax
- **WHEN** a mermaid code block contains invalid syntax
- **THEN** the component SHALL display the raw code text with an error message

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

### Requirement: Theme-aware diagrams
The MermaidBlock component SHALL read the current dashboard theme via `useThemeContext()` and configure mermaid with the corresponding theme (`'dark'` for dark themes, `'default'` for light themes).

#### Scenario: Dark theme active
- **WHEN** the dashboard is using a dark theme
- **THEN** mermaid diagrams SHALL render with mermaid's `dark` theme

#### Scenario: Light theme active
- **WHEN** the dashboard is using a light theme
- **THEN** mermaid diagrams SHALL render with mermaid's `default` theme

#### Scenario: Theme changes while diagram is displayed
- **WHEN** the user switches the dashboard theme
- **THEN** mermaid diagrams SHALL re-render with the updated theme

### Requirement: Mermaid SVG cache prevents re-render blink
MermaidBlock SHALL cache rendered SVG strings at module scope keyed by diagram code and theme. On mount, if a cached SVG exists for the current code+theme, it SHALL initialize with the cached value instead of showing a loading state.

#### Scenario: Remount with cached SVG
- **WHEN** a MermaidBlock unmounts and remounts with the same code and theme
- **THEN** it SHALL display the cached SVG immediately without a loading flash

#### Scenario: Theme change invalidates cache entry
- **WHEN** the theme changes from dark to light (or vice versa)
- **THEN** MermaidBlock SHALL re-render the diagram with the new theme and cache the result separately

### Requirement: MarkdownContent skips re-render on unchanged content
MarkdownContent SHALL be wrapped in React.memo so that it skips re-rendering when its `content` prop has not changed.

#### Scenario: Parent re-renders with same content
- **WHEN** ChatView re-renders due to a new WebSocket event but a completed message's content is unchanged
- **THEN** MarkdownContent for that message SHALL NOT re-render

### Requirement: MermaidBlock skips re-render on unchanged code
MermaidBlock SHALL be wrapped in React.memo so that it skips re-rendering when its `code` prop has not changed.

#### Scenario: MarkdownContent re-renders with same mermaid code
- **WHEN** MarkdownContent re-renders (e.g. during streaming) but the mermaid code block is unchanged
- **THEN** MermaidBlock SHALL NOT re-render

### Requirement: Default node auto-colorization
The MermaidBlock component SHALL post-process the rendered SVG, after
sanitisation and before DOM injection, to give each default (un-authored) node a
soft tint drawn from the active theme's accent palette, while leaving nodes with
an author-specified color untouched. The tint SHALL fill the node with the accent
at low opacity (~8%), draw the node border in the full accent, and keep the
node's label in the theme's normal text color. A node is considered
author-specified when its shape element's inline `style` attribute contains a
`fill:` declaration (as emitted by mermaid for `style X fill:…`, `classDef`, and
class-diagram `style`). Colors SHALL be keyed by a deterministic hash of the
node's `id` so a given node keeps its hue across unrelated diagram edits.
Colorization SHALL cover flowchart and class diagrams.

#### Scenario: Default node gets a soft accent tint
- **WHEN** a flowchart or class-diagram node has no author-specified fill (its
  shape inline `style` contains no `fill:`)
- **THEN** the node's shape SHALL be filled with a low-opacity (~8%) wash of an
  accent color from the active theme's palette selected by the hash of the node's
  id, with the node border drawn in the full accent

#### Scenario: Author-colored node is preserved
- **WHEN** a node has an author-specified color via `style X fill:…`, `classDef`,
  or class-diagram `style` (its shape inline `style` contains `fill:`)
- **THEN** the colorization pass SHALL leave that node's fill and stroke unchanged

#### Scenario: Color is stable across diagram edits
- **WHEN** the same diagram is re-rendered after adding or removing an unrelated
  node
- **THEN** each retained node SHALL keep the same accent color it had before,
  because color is keyed by node id hash rather than position

#### Scenario: Label stays legible on the tinted fill
- **WHEN** a default node is filled with the soft accent wash
- **THEN** the node's label SHALL keep the theme's normal text color, which
  remains readable on the low-opacity wash

#### Scenario: Palette follows dark/light theme
- **WHEN** the dashboard theme is dark versus light
- **THEN** the colorization pass SHALL resolve the accent palette from the active
  theme's live CSS accent variables, so diagrams use that theme's dark or light
  accent set

#### Scenario: Unsupported diagram type is unaffected
- **WHEN** a diagram type other than flowchart or class diagram is rendered (e.g.
  sequence, state, ER)
- **THEN** the colorization pass SHALL make no changes and the diagram SHALL
  render with mermaid's theme colors

