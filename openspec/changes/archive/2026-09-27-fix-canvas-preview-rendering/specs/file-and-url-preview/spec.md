## ADDED Requirements

### Requirement: AsciiDoc preview renders latexmath

The AsciiDoc preview SHALL render asciidoctor `latexmath` passthrough, inline `\(…\)` (from `stem:[…]`) and display `\[…\]` (from `[stem]` blocks), with KaTeX, decoding HTML entities first and rendering invalid TeX as an inline error rather than failing the preview. Text inside `<pre>`/`<code>` SHALL be left untouched. KaTeX SHALL be loaded on demand only when the rendered HTML contains math delimiters, so documents without math do not pay for it.

#### Scenario: Inline and display math render
- **GIVEN** an `.adoc` with `stem:[n \cdot c]` and a `[stem]` block, under `:stem: latexmath`
- **WHEN** it is previewed
- **THEN** both render as KaTeX (the block in display mode) and no raw `\(` delimiter text is shown

#### Scenario: Code listings keep literal delimiters
- **WHEN** a source block contains `\(x\)` text
- **THEN** that listing is shown literally, not rendered as math

## MODIFIED Requirements

### Requirement: AsciiDoc rendering endpoint

The server SHALL expose `GET /api/file/render?cwd=&path=` that runs `asciidoctor` in `safe: "secure"` mode against the file and returns `{ success: true, data: { html } }`. The convert SHALL set the `showtitle` attribute so the document title (`= Title`) is kept as an `<h1>` in the embedded output. It SHALL reject any extension other than `.adoc` / `.asciidoc` with HTTP 400. It SHALL enforce the same anti-traversal gate as `/api/file/raw`.

#### Scenario: AsciiDoc rendered to sanitized HTML

- **GIVEN** `notes.adoc` exists in a known cwd and contains valid AsciiDoc
- **WHEN** the client requests `/api/file/render?cwd=…&path=notes.adoc`
- **THEN** the response is `{ success: true, data: { html: "<HTML>" } }` with HTML safe to render via `dangerouslySetInnerHTML`

#### Scenario: Non-AsciiDoc rejected

- **WHEN** the path's extension is `.md`
- **THEN** the response status is 400 and `{ success: false, error: "renderer not supported for extension" }`

#### Scenario: Secure mode neutralizes includes

- **GIVEN** `evil.adoc` contains `include::/etc/passwd[]`
- **WHEN** rendered through this endpoint
- **THEN** the returned HTML does NOT contain `/etc/passwd` contents (the include directive is neutralized by `safe: "secure"`)

#### Scenario: Document title is rendered

- **GIVEN** `guide.adoc` starts with `= Field Guide`
- **WHEN** rendered through this endpoint
- **THEN** the returned HTML contains `<h1>Field Guide</h1>`

### Requirement: Diagram source blocks in AsciiDoc preview hydrate

The AsciiDoc preview SHALL upgrade diagram source blocks in the rendered HTML to rendered diagrams, keying on the language attributes that survive the secure embedded convert (`[source,mermaid]` / `[source,plantuml]` blocks) plus content sniffing for listing blocks that start with `@startuml`. Mermaid blocks SHALL render client-side; PlantUML blocks SHALL render via the diagram render proxy. A hydrated PlantUML diagram SHALL size to its content in the document flow (no fixed-height box): scaled down to the column width when wider, never cropped, aspect ratio preserved, with zoom/pan still available. A block that fails or declines to render SHALL remain visible as its original code listing. Bare style-only blocks (`[mermaid]` without `source`) carry no surviving type information and SHALL remain code listings.

#### Scenario: source,mermaid block hydrates client-side
- **WHEN** a previewed `.adoc` contains a `[source,mermaid]` block with valid mermaid syntax
- **THEN** it renders as a mermaid diagram in place of the code listing, with no server render request

#### Scenario: source,plantuml block hydrates via proxy
- **WHEN** a previewed `.adoc` contains a `[source,plantuml]` block and the proxy resolves an endpoint
- **THEN** it renders as an SVG diagram in place of the code listing

#### Scenario: Tall PlantUML diagram is not cropped
- **WHEN** a hydrated PlantUML SVG is taller than 400px
- **THEN** its container grows to the diagram's height and the whole diagram is visible without panning

#### Scenario: @startuml sniffing
- **WHEN** a plain listing block's content starts with `@startuml`
- **THEN** it is treated as a PlantUML block and hydrated via the proxy

#### Scenario: Declined rendering leaves the listing
- **WHEN** the proxy declines (no endpoint permitted) or fails
- **THEN** the original code listing remains visible, optionally with an unobtrusive notice

#### Scenario: Bare style block stays a listing
- **WHEN** a previewed `.adoc` contains a bare `[mermaid]` style block (not `[source,mermaid]`)
- **THEN** it remains a code listing (no type information survives the secure convert)

### Requirement: Overlay and editor-pane surfaces share renderers

Every renderer (`MarkdownPreview`, `AsciiDocPreview`, `HtmlPreview`, `PdfPreview`, `VideoPreview`, `ImagePreview`, `YouTubePreview`, `DocxPreview`, `PptxPreview`, `SpreadsheetPreview`, `EmlPreview`, `FallbackPreview`) SHALL be usable in two contexts: the `/pi-view` / `…/view` overlay route (FileLink / OpenFileButton / canvas) and the internal editor pane (`viewer-registry` + `UrlViewer`). The renderer component SHALL NOT contain navigation or surface chrome; the shell is owned by the overlay route component or the editor-pane viewer wrapper. Because the editor pane supplies no scroll container of its own, the editor-pane wrapper of a flow-height renderer (`AsciiDocPreview`, `DocxPreview` HTML mode) SHALL provide one, so long documents scroll within the pane instead of overflowing it. There is no longer an in-chat `PreviewCard` surface.

The overlay route SHALL render in a route-backed overlay container: a `Dialog` over a scrim over the pinned background underlay on desktop, and a `MobileShell` depth panel on mobile. It is no longer full-screen on desktop. The URL SHALL be unchanged by this container choice, and the renderer components SHALL be unaffected — the container is owned by the overlay route component, which is exactly the boundary this requirement already draws.

#### Scenario: Same component, two shells

- **GIVEN** a `.pdf` target opens in the editor pane via `/view`
- **WHEN** the same file is opened through a FileLink overlay
- **THEN** both mount the SAME `PdfPreview` component with the same `target` prop (no separate variant component)

#### Scenario: Long document scrolls in the editor pane

- **GIVEN** a long `.adoc` or `.docx` (HTML mode) opened in the editor pane or canvas
- **WHEN** it renders taller than the pane
- **THEN** the content scrolls within the pane and does not overflow the pane's footer

#### Scenario: Overlay route renders in a dialog container on desktop

- **WHEN** `/pi-view?url=…` or `/folder/:cwd/view?path=…` matches on a desktop viewport
- **THEN** the preview SHALL render in a `Dialog` over a scrim over the pinned underlay
- **AND** the URL SHALL be unchanged from the pre-conversion path

#### Scenario: Renderers are unchanged by the container swap

- **GIVEN** the overlay route renders inside a dialog container
- **WHEN** any renderer mounts within it
- **THEN** the renderer SHALL receive the same `target` prop as before
- **AND** SHALL NOT contain navigation or surface chrome of its own
