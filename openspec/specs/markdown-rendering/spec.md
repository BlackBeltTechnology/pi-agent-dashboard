## ADDED Requirements

### Requirement: Markdown text rendering
The MarkdownContent component SHALL accept a `content` string prop, pre-process it with `wrapAsciiTables` to ensure ASCII/box-drawing tables render in monospace, then render the result as formatted HTML using react-markdown with the `remark-gfm` plugin enabled. Supported elements SHALL include: paragraphs, headings, bold, italic, strikethrough, lists (ordered and unordered), links, inline code, fenced code blocks, GFM tables, task lists, autolinks, blockquotes, and Mermaid diagrams. Fenced code blocks with syntax highlighting SHALL use `var(--bg-code)` as their background color.

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
