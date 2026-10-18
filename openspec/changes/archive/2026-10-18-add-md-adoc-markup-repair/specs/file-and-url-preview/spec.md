## MODIFIED Requirements

### Requirement: AsciiDoc rendering endpoint

The server SHALL expose `GET /api/file/render?cwd=&path=` that runs `asciidoctor` in `safe: "secure"` mode against the file and returns `{ success: true, data: { html, repairs, warnings, mtime } }` (`mtime` = the file's modification token at read time). The convert SHALL set the `showtitle` attribute so the document title (`= Title`) is kept as an `<h1>` in the embedded output. The server SHALL run AsciiDoc markup repair (see `markup-repair`) on the source and convert the repaired source when any repair applies, else the original, converting once per request; with the query parameter `repair=0` the server SHALL skip repair and convert the original source (`repairs: []`); `repairs` SHALL list each applied repair `{ rule, line }` (empty when none) and `warnings` SHALL list the converter's diagnostics for the converted source (empty when none). It SHALL reject any extension other than `.adoc` / `.asciidoc` with HTTP 400. It SHALL enforce the same anti-traversal gate as `/api/file/raw`.

#### Scenario: AsciiDoc rendered to sanitized HTML

- **GIVEN** `notes.adoc` exists in a known cwd and contains valid AsciiDoc
- **WHEN** the client requests `/api/file/render?cwd=…&path=notes.adoc`
- **THEN** the response is `{ success: true, data: { html: "<HTML>", repairs: [], warnings: [], mtime: <number> } }` with HTML safe to render via `dangerouslySetInnerHTML`

#### Scenario: Repaired AsciiDoc reports repairs

- **GIVEN** `guide.adoc` contains a listing block that is never closed before `== Next`
- **WHEN** rendered through this endpoint
- **THEN** `repairs` contains an `A2` entry with the opener's line and `html` renders `Next` as a section heading

#### Scenario: Repair skipped on request

- **GIVEN** `guide.adoc` contains a listing block that is never closed before `== Next`
- **WHEN** the client requests `/api/file/render?cwd=…&path=guide.adoc&repair=0`
- **THEN** `repairs` is empty and `html` renders `Next` inside the unterminated listing

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

The AsciiDoc preview SHALL upgrade diagram source blocks in the rendered HTML to rendered diagrams, keying on the language attributes that survive the secure embedded convert (`[source,mermaid]` / `[source,plantuml]` blocks) plus content sniffing for listing blocks that start with `@startuml`. Bare `[mermaid]` style blocks on a `----` or `....` delimited block SHALL hydrate as mermaid diagrams via AsciiDoc markup repair, which renders them as `[source,mermaid]` blocks and reports the repair; a `[mermaid]` style applied to a non-delimited paragraph SHALL remain as rendered by the converter. Mermaid blocks SHALL render client-side; PlantUML blocks SHALL render via the diagram render proxy. A hydrated PlantUML diagram SHALL size to its content in the document flow (no fixed-height box): scaled down to the column width when wider, never cropped, aspect ratio preserved, with zoom/pan still available. A block that fails or declines to render SHALL remain visible as its original code listing.

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

#### Scenario: Bare style block hydrates via repair
- **WHEN** a previewed `.adoc` contains a bare `[mermaid]` style on a `----` delimited block (not `[source,mermaid]`)
- **THEN** it renders as a mermaid diagram and the document repair notice lists the repair

#### Scenario: Bare style block stays a listing
- **WHEN** a previewed `.adoc` applies a bare `[mermaid]` style to a non-delimited paragraph
- **THEN** no repair is applied and it is not hydrated as a diagram
