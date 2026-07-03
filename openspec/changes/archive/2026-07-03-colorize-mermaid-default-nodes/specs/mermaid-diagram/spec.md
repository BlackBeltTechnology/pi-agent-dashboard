## ADDED Requirements

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
