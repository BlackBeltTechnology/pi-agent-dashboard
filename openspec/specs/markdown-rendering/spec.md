## Purpose

Define how the `MarkdownContent` component renders markdown across all dashboard surfaces: supported elements, plugin chain, image/asset resolution, lightbox behavior, and frontmatter handling.
## Requirements
### Requirement: Markdown text rendering
The MarkdownContent component SHALL accept a `content` string prop, pre-process it with `wrapAsciiTables` to ensure ASCII/box-drawing tables render in monospace, then render the result as formatted HTML using react-markdown with the `remark-gfm` plugin enabled and the `remark-math` plugin enabled. The rehype plugin chain SHALL be ordered `[rehypeRaw, rehypeKatex, stripReactRefAttributes]`. Supported elements SHALL include: paragraphs, headings, bold, italic, strikethrough, lists (ordered and unordered), links, inline code, fenced code blocks, GFM tables, task lists, autolinks, blockquotes, Mermaid diagrams, LaTeX math expressions (inline `$…$` and display `$$…$$`), and image references. Fenced code blocks with syntax highlighting SHALL use `var(--bg-code)` as their background color. Image references whose `src` begins with `pi-asset:<hash>` SHALL be resolved against the current `SessionAssetsContext` map and rendered as `<img src="data:<mimeType>;base64,<data>">`; image references with any other scheme (`data:`, `http(s):`, `blob:`, fragment, or relative) SHALL render via the default ReactMarkdown `<img>` with the original `src` unchanged. Every successfully-rendered `<img>` (i.e. excluding the unresolved `pi-asset:` placeholder span) SHALL be clickable: clicking it SHALL open an `<ImageLightbox>` modal carrying the same `src` and `alt` as the rendered `<img>`, providing zoom / pan / Escape-to-close / backdrop-click-to-close behavior. The clickable `<img>` SHALL render with `cursor-pointer` styling so the affordance is discoverable.

#### Scenario: ASCII table in content
- **WHEN** the content contains box-drawing table characters
- **THEN** the component SHALL render them in a monospace code block with columns properly aligned

#### Scenario: Mixed ASCII table and markdown
- **WHEN** the content contains both an ASCII table and regular markdown
- **THEN** the ASCII table SHALL render monospaced and the markdown SHALL render normally

#### Scenario: Plain text content
- **WHEN** the content contains no markdown syntax
- **THEN** the component SHALL render it as a paragraph

#### Scenario: Fenced code block
- **WHEN** the content contains a fenced code block with a language tag (other than `mermaid`)
- **THEN** the component SHALL render the code block with syntax highlighting using react-syntax-highlighter with the appropriate language, using `var(--bg-code)` as the background

#### Scenario: Fenced code block without language
- **WHEN** the content contains a fenced code block without a language tag
- **THEN** the component SHALL render the code block with monospace font and `var(--bg-code)` background without syntax highlighting

#### Scenario: Inline code
- **WHEN** the content contains inline code (backtick-wrapped)
- **THEN** the component SHALL render it with monospace font and a subtle background

#### Scenario: Mixed markdown content
- **WHEN** the content contains headings, lists, bold, and code blocks
- **THEN** all elements SHALL be rendered with appropriate HTML elements and styling

#### Scenario: GFM table
- **WHEN** the content contains a GFM pipe-delimited table
- **THEN** the component SHALL render it as an HTML table with borders, padding, and header styling

#### Scenario: Mermaid code block
- **WHEN** the content contains a fenced code block with language `mermaid`
- **THEN** the component SHALL render it using the MermaidBlock component as an SVG diagram instead of syntax-highlighted text

#### Scenario: LaTeX math expression
- **WHEN** the content contains an inline `$…$` or display `$$…$$` math expression
- **THEN** the component SHALL render it as a KaTeX-typeset HTML node, not as literal dollar-bracketed text

#### Scenario: pi-asset image reference resolves from session map
- **WHEN** the content contains `![alt](pi-asset:abc)` and the active `SessionAssetsContext` map contains `"abc": { data, mimeType }`
- **THEN** the rendered `<img>` SHALL have `src="data:<mimeType>;base64,<data>"` and the original `alt` text

#### Scenario: External URL image reference unchanged
- **WHEN** the content contains `![logo](https://example.com/logo.png)`
- **THEN** the rendered `<img>` SHALL have `src="https://example.com/logo.png"` exactly as today's default ReactMarkdown behavior

#### Scenario: Click on resolved pi-asset image opens lightbox
- **WHEN** the user clicks the rendered `<img>` produced from `![alt](pi-asset:abc)` whose hash IS in the session map
- **THEN** an `<ImageLightbox>` SHALL mount with `src="data:<mimeType>;base64,<data>"` and `alt="alt"`, and the user SHALL be able to zoom / pan / close it with Escape or a backdrop click

#### Scenario: Click on external URL image opens lightbox
- **WHEN** the user clicks the rendered `<img>` produced from `![logo](https://example.com/logo.png)`
- **THEN** an `<ImageLightbox>` SHALL mount with `src="https://example.com/logo.png"` and `alt="logo"`

#### Scenario: Click on inline data URL image opens lightbox
- **WHEN** the user clicks the rendered `<img>` produced from `![inline](data:image/png;base64,iVBOR...)`
- **THEN** an `<ImageLightbox>` SHALL mount with the same `src` and `alt`

#### Scenario: Unresolved pi-asset placeholder is NOT clickable
- **WHEN** the markdown contains `![alt](pi-asset:zzz)` and the session map does NOT contain `"zzz"`
- **THEN** the rendered placeholder element SHALL NOT mount an `<ImageLightbox>` on click (because there's no image to view yet)

#### Scenario: Image inside markdown link does not navigate when clicked
- **WHEN** the markdown contains `[![alt](https://example.com/x.png)](https://example.com/page)` and the user clicks the image
- **THEN** an `<ImageLightbox>` SHALL open, AND the surrounding link SHALL NOT navigate (click event SHALL stopPropagation)

### Requirement: External links open in new context
The `MarkdownContent` component SHALL render anchor (`<a>`) elements such that clicking an external URL never strands the user on a page outside the dashboard. An external URL is any URL whose resolved origin differs from the current page's origin. Same-document fragment references (`#id`) and same-origin URLs SHALL render as bare anchors and remain in-document.

#### Scenario: External absolute URL in markdown content
- **WHEN** the content contains a link whose href resolves to a different origin than the current page (e.g. `[docs](https://example.com)`)
- **THEN** the rendered `<a>` SHALL have `target="_blank"` and `rel="noopener noreferrer"`

#### Scenario: Markdown autolink
- **WHEN** the content contains an autolink (`<https://example.com>` or a bare URL that GFM linkifies)
- **THEN** the rendered `<a>` SHALL have `target="_blank"` and `rel="noopener noreferrer"`

#### Scenario: Fragment-only href stays in-document
- **WHEN** the content contains a link whose href begins with `#` (e.g. `[top](#top)`)
- **THEN** the rendered `<a>` SHALL NOT have a `target` attribute, so the browser performs in-document scrolling

#### Scenario: Same-origin relative href stays in-window
- **WHEN** the content contains a link whose href resolves to the same origin as the current page (e.g. `[settings](/settings)`)
- **THEN** the rendered `<a>` SHALL NOT have a `target` attribute

#### Scenario: Click is safe from reverse tabnabbing
- **WHEN** the rendered anchor has `target="_blank"`
- **THEN** it SHALL also have `rel="noopener noreferrer"` so the opened page cannot access `window.opener` or leak referrer information

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

### Requirement: GFM table visual styling

Rendered GFM tables in `.markdown-content` SHALL use a shared style that reads
legibly on every theme and on every surface that renders markdown (chat view,
editor-pane content view, KB, resources). The `<table>` SHALL render with an
outer border in `var(--border-secondary)`, `border-radius: 8px`, and clipped
overflow so inner fills follow the rounded corners. Header cells (`thead th`)
SHALL use `background: var(--bg-surface)` with `var(--text-primary)` text and a
`var(--border-secondary)` bottom border. Body rows SHALL be zebra-striped: every
even `tbody` row SHALL use `background: var(--table-stripe)`, a theme-driven token
defined for every theme in both dark and light modes. Body cells SHALL separate
with `var(--border-primary)` horizontal borders (suppressed on the last row) and
`var(--border-primary)` vertical column separators between adjacent cells. Hovering
a body row SHALL highlight it with `background: var(--bg-hover)`. The style SHALL
be defined once on the `.markdown-content` scope so no surface diverges.

#### Scenario: Zebra-striped body rows

- **WHEN** a GFM table with three or more body rows renders in `.markdown-content`
- **THEN** even-numbered body rows SHALL have `background: var(--table-stripe)` and
  odd rows SHALL be unstyled, producing visible row banding

#### Scenario: Elevated, separated header

- **WHEN** a GFM table renders on any theme
- **THEN** the header row SHALL use `var(--bg-surface)` (not `var(--bg-tertiary)`),
  so it reads as distinct from the surrounding message/container background

#### Scenario: Rounded clipped frame

- **WHEN** a GFM table renders
- **THEN** the table SHALL have an 8px rounded outer border and its header fill and
  row stripes SHALL be clipped to those rounded corners (via
  `border-collapse: separate` + `overflow: hidden`)

#### Scenario: Kept column separators

- **WHEN** a GFM table with two or more columns renders
- **THEN** adjacent cells SHALL be divided by a `var(--border-primary)` vertical
  border, and the last column SHALL have none

#### Scenario: Theme-driven stripe token defined for every theme

- **WHEN** any of the 9 themes is applied in dark or light mode
- **THEN** `--table-stripe` SHALL resolve to a defined value for that theme/mode,
  so the zebra banding renders on every palette

