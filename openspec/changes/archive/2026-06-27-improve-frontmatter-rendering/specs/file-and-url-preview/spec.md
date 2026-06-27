## ADDED Requirements

### Requirement: Markdown preview enables frontmatter properties

When a file dispatches to the `"markdown"` renderer (a `.md`/`.mdx` file in `FilePreviewOverlay` or any inline markdown preview surface), the renderer SHALL pass `frontmatter="properties"` to `MarkdownContent` so a leading YAML frontmatter block renders as a collapsed Properties panel above the body instead of being hidden or mangled.

#### Scenario: Markdown file with frontmatter opened in overlay

- **WHEN** the user opens a `.md` file whose content begins with a YAML frontmatter block in `FilePreviewOverlay`
- **THEN** the overlay SHALL render a collapsed Properties panel above the markdown body
- **AND** the frontmatter SHALL NOT render as a heading or a thematic break

#### Scenario: Markdown file without frontmatter

- **WHEN** the user opens a `.md` file with no leading frontmatter block
- **THEN** no Properties panel SHALL render and the body SHALL render normally
