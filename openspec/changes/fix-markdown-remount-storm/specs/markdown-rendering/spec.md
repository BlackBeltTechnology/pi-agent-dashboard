## ADDED Requirements

### Requirement: Rendered markdown SHALL NOT remount on an unrelated re-render
The `MarkdownContent` component SHALL preserve the DOM nodes of its rendered
output across renders in which its markdown source has not changed. Component
overrides passed to the markdown renderer SHALL hold a stable identity across
renders, because the renderer consumes them as React element types and a changed
type forces React to unmount and remount the subtree.

#### Scenario: Parent re-renders with unchanged content
- **WHEN** a component containing `MarkdownContent` re-renders and the `content` prop is unchanged
- **THEN** the rendered markdown DOM nodes SHALL be the same node instances as before the re-render

#### Scenario: Application-wide re-render from a WebSocket event
- **WHEN** a WebSocket event causes the application root to re-render while a markdown document is displayed
- **THEN** no markdown DOM node SHALL be removed or replaced

#### Scenario: Interactive state inside rendered markdown survives
- **WHEN** an interactive block inside rendered markdown holds local state and the parent re-renders
- **THEN** that state SHALL be preserved

#### Scenario: Streaming content still updates
- **WHEN** the `content` prop grows during streaming
- **THEN** the newly arrived markdown SHALL render, and previously rendered blocks SHALL NOT be remounted

#### Scenario: Prose overrides are stable when file linking is active
- **WHEN** a tool context carrying a file-link renderer is supplied, activating the paragraph and list-item overrides, and the parent re-renders
- **THEN** paragraph and list-item DOM nodes SHALL be the same node instances as before the re-render

#### Scenario: Inline code spans are stable
- **WHEN** rendered markdown contains inline code spans inside prose and the parent re-renders
- **THEN** those inline code DOM nodes SHALL be the same node instances as before the re-render

#### Scenario: File-link gating is preserved
- **WHEN** no file-link renderer is supplied in the context
- **THEN** the paragraph and list-item overrides SHALL NOT be applied, and prose SHALL render without linkification

#### Scenario: Tables are stable
- **WHEN** rendered markdown contains a GFM table and the parent re-renders
- **THEN** the table DOM nodes SHALL be the same node instances as before the re-render

### Requirement: Component overrides SHALL hold a stable identity
Every component override supplied to the markdown renderer SHALL hold a stable
identity across renders, whether or not it captures per-render values. The
renderer resolves an overridden tag to the supplied component and uses it as the
React element type, so identity — not captured scope — is what determines whether
React preserves or remounts the subtree. An override that captures nothing is
still a fresh type when defined inline.

#### Scenario: Override that captures nothing
- **WHEN** an override closes over no per-render value and the parent re-renders
- **THEN** its rendered DOM nodes SHALL still be preserved

#### Scenario: Override that requires per-render values
- **WHEN** an override needs per-render values to render correctly
- **THEN** it SHALL receive them without its own identity changing, and its rendered DOM nodes SHALL be preserved

#### Scenario: Conditionally supplied overrides
- **WHEN** a group of overrides is supplied only under a condition and that condition is unchanged between renders
- **THEN** the supplied map SHALL present the same override identities as the previous render
