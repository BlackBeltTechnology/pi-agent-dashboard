## ADDED Requirements

### Requirement: Frontmatter rendering

The `MarkdownContent` component SHALL accept an optional `frontmatter` prop of type `"hide" | "properties"` defaulting to `"hide"`. The component SHALL include `remark-frontmatter` in its remark plugin chain so that a single YAML frontmatter block at the very start of `content` (delimited by a leading `---` line and a closing `---` line) is parsed as a discrete node and removed from the rendered markdown body, regardless of the `frontmatter` prop value. A `---` sequence that is not the leading frontmatter block (e.g. mid-document) SHALL continue to render as a thematic break.

When `frontmatter` is `"hide"` (or there is no leading frontmatter block), the component SHALL render nothing in place of the frontmatter. When `frontmatter` is `"properties"` and a leading frontmatter block is present, the component SHALL render a `FrontmatterProperties` panel above the markdown body.

The `FrontmatterProperties` panel SHALL parse the frontmatter YAML with a YAML parser and render one row per top-level key, collapsed by default with a header showing the field count, expandable on click. Each row SHALL render its value according to the parsed value's type: numbers in monospace, dates with a relative-time suffix, arrays as chips, booleans as a check/cross indicator, URL strings as clickable links, objects as an indented sub-grid, and empty/null values as a muted placeholder. The key `status` (case-insensitive) SHALL render as a colored status badge. If the YAML fails to parse, the panel SHALL render a warning banner and the raw frontmatter lines instead of crashing, and a malformed frontmatter block SHALL never prevent the markdown body from rendering.

#### Scenario: Leading frontmatter does not mangle the body

- **WHEN** `content` begins with `---\ntitle: X\n---\n\n# Heading` and `frontmatter` is `"hide"`
- **THEN** the rendered output SHALL contain the `# Heading` as an `<h1>` and SHALL NOT render the YAML lines as a heading or a thematic break

#### Scenario: Default prop hides frontmatter

- **WHEN** `MarkdownContent` is rendered with leading frontmatter and no `frontmatter` prop
- **THEN** no frontmatter panel SHALL appear and the frontmatter block SHALL not appear in the body

#### Scenario: Properties mode renders a collapsed panel

- **WHEN** `MarkdownContent` is rendered with leading frontmatter and `frontmatter="properties"`
- **THEN** a Properties panel SHALL render above the body, collapsed by default, showing the number of fields
- **AND** clicking the panel header SHALL expand it to show one row per top-level key

#### Scenario: Typed value rendering

- **WHEN** the frontmatter contains a number, an array, a boolean, and an ISO date value and the panel is expanded
- **THEN** the number SHALL render in monospace, the array SHALL render as chips, the boolean SHALL render as a check/cross indicator, and the date SHALL render with a relative-time suffix

#### Scenario: status key promoted to badge

- **WHEN** the frontmatter contains `status: draft` and the panel is expanded
- **THEN** the `status` row SHALL render its value as a colored status badge

#### Scenario: Nested object renders as sub-grid

- **WHEN** the frontmatter contains a nested mapping (e.g. `metadata:` with child keys) and the panel is expanded
- **THEN** the nested mapping SHALL render as an indented key/value sub-grid

#### Scenario: Malformed YAML degrades gracefully

- **WHEN** the leading frontmatter block is not valid YAML and `frontmatter="properties"`
- **THEN** the panel SHALL render a warning banner with the raw frontmatter lines
- **AND** the markdown body SHALL still render normally

#### Scenario: No frontmatter present

- **WHEN** `content` has no leading `---` frontmatter block and `frontmatter="properties"`
- **THEN** no Properties panel SHALL render and the body SHALL render normally
