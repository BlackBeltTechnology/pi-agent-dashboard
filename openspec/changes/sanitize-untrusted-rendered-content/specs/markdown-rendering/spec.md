## MODIFIED Requirements

### Requirement: Markdown text rendering
The MarkdownContent component SHALL accept a `content` string prop, pre-process it with `wrapAsciiTables` to ensure ASCII/box-drawing tables render in monospace, then render the result as formatted HTML using react-markdown with the `remark-gfm` plugin enabled and the `remark-math` plugin enabled. The rehype plugin chain SHALL be ordered `[rehypeRaw, rehypeSanitize, rehypeKatex, stripReactRefAttributes]`, and every URL SHALL pass the scheme allowlist defined in `client-untrusted-content-sanitization`. Supported elements SHALL include: paragraphs, headings, bold, italic, strikethrough, lists (ordered and unordered), links, inline code, fenced code blocks, GFM tables, task lists, autolinks, blockquotes, Mermaid diagrams, LaTeX math expressions (inline `$…$` and display `$$…$$`), and image references. Fenced code blocks with syntax highlighting SHALL use `var(--bg-code)` as their background color. Image references whose `src` begins with `pi-asset:<hash>` SHALL be resolved against the current `SessionAssetsContext` map and rendered as `<img src="data:<mimeType>;base64,<data>">` when the asset's `mimeType` is `image/*` (otherwise the unresolved placeholder, see `chat-asset-resolver`); image references with an allowed lower-case scheme (`data:image/*`, `http(s):`, `blob:`) or a fragment or relative `src` SHALL render via the default ReactMarkdown `<img>` with the original `src` unchanged; any other scheme (e.g. `javascript:`, `data:text/html`) SHALL render with no `src`. Every successfully-rendered `<img>` (i.e. excluding the unresolved `pi-asset:` placeholder span and any image whose `src` was dropped by the URL allowlist) SHALL be clickable: clicking it SHALL open an `<ImageLightbox>` modal carrying the same `src` and `alt` as the rendered `<img>`, providing zoom / pan / Escape-to-close / backdrop-click-to-close behavior. The clickable `<img>` SHALL render with `cursor-pointer` styling so the affordance is discoverable.

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
