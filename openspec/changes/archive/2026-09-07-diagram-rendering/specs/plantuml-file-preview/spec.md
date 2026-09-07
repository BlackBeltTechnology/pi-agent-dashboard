## Purpose

Preview `.puml`/`.plantuml` files as rendered diagrams: proxy-rendered SVG mounted in the shared zoom-pan viewport, with the source text as the universal fallback when rendering is declined or fails.

## ADDED Requirements

### Requirement: PlantUML file preview renders via the proxy

Opening a `.puml` or `.plantuml` file (extension compared case-insensitively) in a preview surface SHALL fetch rendered SVG from the diagram render proxy and mount it in the shared zoom-pan viewport. While rendering, a loading state SHALL be shown.

#### Scenario: PlantUML file renders as diagram
- **WHEN** a `.puml` file is opened for preview and the proxy returns SVG
- **THEN** the diagram displays inside a zoomable, pannable viewport

#### Scenario: Case-insensitive extension
- **WHEN** a `.PUML` file is opened
- **THEN** it is treated identically to `.puml`

### Requirement: Source-view fallback

When the proxy declines rendering (no endpoint permitted) or fails, the preview SHALL fall back to showing the diagram source text, visibly, with a notice explaining why rendering did not happen — never a broken image or empty pane.

#### Scenario: Rendering unavailable shows source
- **WHEN** the proxy responds "rendering unavailable"
- **THEN** the file's source text is displayed with a notice that diagram rendering is not configured

#### Scenario: Upstream failure shows source
- **WHEN** the proxy reports an upstream failure
- **THEN** the source text is displayed with a transient error notice
