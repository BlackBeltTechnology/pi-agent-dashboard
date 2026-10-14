# client-untrusted-content-sanitization Specification

## Purpose
TBD - created by archiving change sanitize-untrusted-rendered-content. Update Purpose after archive.

## Requirements

### Requirement: Markdown renderer sanitizes untrusted HTML and URL schemes
The markdown renderer SHALL sanitize embedded raw HTML and SHALL restrict URL
schemes when rendering untrusted content (LLM/tool output). Raw HTML parsed by
`rehypeRaw` SHALL pass through a schema-based sanitizer (`rehype-sanitize`)
before math rendering and before React renders it. The schema SHALL remove
script-bearing and embedding elements — `<script>`, `<style>`, `<iframe>`,
`<object>`, `<embed>`, `<picture>`, `<source>`, inline `<svg>` and `<math>` —
without leaking their text content, and SHALL remove all event-handler
attributes and the `style`, `srcset`, `srcdoc` and `xlink:href` attributes.
`id` and `name` values SHALL be kept only when they carry the `user-content-`
prefix (plus the exact id `footnote-label`), so raw HTML cannot clobber DOM
globals while GFM footnote anchors keep working. If rendering throws, the
renderer SHALL show the message source as plain text and SHALL NOT fall back to
the unsanitized tree; when the content changes afterwards (e.g. the next
streamed token), the renderer SHALL try rendering it as markdown again.

Every URL SHALL be filtered by an allowlist: react-markdown's default safe set
(`http`, `https`, `mailto`, `irc`, `ircs`, `xmpp`) and scheme-less (relative,
fragment, query) URLs on any URL attribute, using react-markdown's default URL
parsing; additionally, on `<img src>` only, lower-case `pi-asset:`, `blob:` and
`data:image/…`. Any other value, including `javascript:` and `data:text/html`
in any letter case, SHALL be dropped, so the element renders without that
attribute; a link whose target was dropped SHALL render with no `href` and
SHALL NOT navigate when clicked. A legitimate scheme written in upper case and
a relative name containing a colon (e.g. `photo:1.png`) are dropped as well.

The sanitizer SHALL preserve KaTeX math, GFM tables, task lists and footnotes,
fenced code blocks (including syntax highlighting and mermaid diagrams), the
GitHub-safe inline HTML set (`<details>`, `<summary>`, `<kbd>`, `<sub>`,
`<sup>`, `<br>`), and the image sources the app legitimately uses.

#### Scenario: javascript: link neutralized
- **WHEN** markdown source contains `[x](javascript:alert(document.domain))`, `[y]( JaVaScRiPt:alert(1))` or `<a href="java&#x09;script:alert(1)">z</a>`
- **THEN** each rendered anchor SHALL carry no `href`, and clicking it SHALL NOT navigate or reload the dashboard

#### Scenario: iframe srcdoc script neutralized
- **WHEN** markdown source contains `<iframe srcdoc="<script>fetch('//evil')</script>">`
- **THEN** the rendered output SHALL contain no `<iframe>` and SHALL NOT execute the embedded script in the dashboard origin

#### Scenario: active elements and attributes removed without text leakage
- **WHEN** markdown source contains `a<style>p{}</style>b`, `<object data="x">fb</object>`, `<embed src="x">`, `<svg><a xlink:href="javascript:alert(1)">s</a></svg>`, `<picture>pt<source srcset="https://evil.example/t.png"></picture>`, `<div style="position:fixed;inset:0">o</div>`, `<img src="x" onerror="fetch('//evil')">` and `<p onclick="alert(1)">c</p>`
- **THEN** the rendered output SHALL contain none of those elements' active parts (no `<style>`, `<object>`, `<embed>`, `<svg>`, `<picture>`, `<source>`, `style`, `srcset`, `xlink:href` or `on*` attribute) and SHALL NOT display the `<style>`, `<object>` or `<picture>` inner text

#### Scenario: data URL restricted to images
- **WHEN** markdown source contains `![ok](data:image/png;base64,AAAA)` and `[bad](data:text/html,<script>alert(1)</script>)`
- **THEN** the image SHALL render with its `data:image/png` source unchanged and the link SHALL carry no `href`

#### Scenario: upper-case dangerous scheme on an image dropped
- **WHEN** markdown source contains `<img src="DATA:TEXT/HTML,x">` and `<img src="JAVASCRIPT:alert(1)">`
- **THEN** neither image SHALL carry a `src`

#### Scenario: raw HTML cannot clobber DOM globals
- **WHEN** markdown source contains `<img name="getElementById" id="config">`
- **THEN** the rendered element SHALL carry neither an `id` nor a `name` attribute

#### Scenario: rendering failure shows plain text
- **WHEN** the sanitizer throws while rendering markdown that contains raw HTML
- **THEN** the message SHALL show its source as plain text and no element from the unsanitized raw HTML SHALL reach the DOM

#### Scenario: rendering recovers when content changes
- **WHEN** a streamed message failed to render once and its content then changes to markdown that renders
- **THEN** the message SHALL render as markdown again, without remounting messages whose content did not change

#### Scenario: legitimate content preserved
- **WHEN** markdown source contains inline math, a display math block with `$$` on its own lines, a GFM table, a task list, a GFM footnote, a `<details>` block, a fenced `ts` code block, a fenced `mermaid` block, a loopback link, a relative link, a fragment link, and images with `pi-asset:`, `blob:`, `data:image/png` and `https:` sources
- **THEN** all of them SHALL render normally after sanitization, the math in its inline or display mode and the footnote reference navigating to its definition

### Requirement: Document preview HTML is sanitized before injection
Document preview HTML derived from untrusted files SHALL be sanitized with
DOMPurify before it is injected via `dangerouslySetInnerHTML`. The AsciiDoc
preview SHALL sanitize asciidoctor output on the server (parity with the DOCX
and EML paths) so inline HTML passthrough (`+++…+++`, `pass:[…]`) cannot
introduce active content, `<style>` blocks, form controls, or `style`
attributes outside table column definitions. Any configuration specific to the
AsciiDoc pass SHALL NOT change how the other server-side sanitizer consumers
(EML, DOCX, PlantUML) sanitize. After the server pass, the client SHALL only
add markup by rendering math found in text content with KaTeX (`trust:false`)
— never inside attribute values or `pre`/`code` text. `safe:"secure"` alone
SHALL NOT be treated as HTML sanitization. A DOMPurify instance that reports
itself unsupported SHALL be treated as unavailable. If the sanitizer is
unavailable or throws, the render request SHALL fail rather than return
unsanitized HTML. The already-sanitized DOCX, EML and PlantUML previews SHALL
keep their current rendering.

#### Scenario: AsciiDoc passthrough stripped
- **WHEN** an `.adoc` file contains `+++<img src=x onerror=fetch('//evil')>+++`, `pass:[<style>@import url(//evil)</style>]` and `+++<div style="position:fixed;inset:0">o</div>+++`
- **THEN** the returned preview HTML SHALL contain neither the `onerror` handler, the `<style>` element, nor the `style` attribute on the `<div>`

#### Scenario: AsciiDoc legitimate formatting preserved
- **WHEN** an `.adoc` file with `:stem: latexmath` contains headings, lists, a table with explicit column widths, the expressions `stem:[a^2]` and `stem:[\sqrt{\frac{a}{b}}]`, a `[source,mermaid]` block and a `[plantuml]` block
- **THEN** the preview SHALL render those elements normally, keeping the table column widths, both expressions typeset by KaTeX (the radical drawn), and both diagram blocks rendered as diagrams

#### Scenario: math rewrite never touches attribute values
- **WHEN** sanitized AsciiDoc HTML contains `\(x\)` inside an attribute value and inside a code listing
- **THEN** both SHALL be left as literal text and the HTML injected into the DOM SHALL be well-formed

#### Scenario: AsciiDoc pass does not leak into other previews
- **WHEN** an AsciiDoc preview is rendered and then an EML and a DOCX file containing inline `style` attributes are previewed
- **THEN** the EML and DOCX previews SHALL keep those `style` attributes exactly as they did before the AsciiDoc render

#### Scenario: sanitizer unavailable fails closed
- **WHEN** the server-side sanitizer cannot be loaded, reports itself unsupported, or throws during an AsciiDoc, EML or PlantUML render
- **THEN** the response SHALL be an error and SHALL NOT contain the unsanitized markup

#### Scenario: existing sanitized previews unchanged
- **WHEN** a DOCX file, an EML file with remote images and a PlantUML diagram are previewed with a working sanitizer
- **THEN** each SHALL render as before this change, with the EML body still inside a script-less sandboxed iframe and the PlantUML SVG still sanitized server-side

### Requirement: Mermaid SVG sanitization is final and fail-closed
The mermaid renderer SHALL sanitize the rendered SVG with DOMPurify — SVG and
SVG-filter profiles, `<foreignObject>` treated as an HTML integration point so
HTML labels including `<br>` line breaks survive, form controls and embeds
forbidden — and SHALL NOT use a regular expression for it. Sanitization SHALL
be the last transformation applied before the SVG is cached or injected, for
original and repaired renders alike. A DOMPurify instance that reports itself
unsupported SHALL be treated as a failure; a failure SHALL NOT cache or inject
the unsanitized SVG. Diagram-level directives (`%%{init}%%`) SHALL NOT be able
to override the theme CSS or font family that mermaid emits into the SVG's
`<style>` element.

#### Scenario: SVG xlink:href javascript dropped
- **WHEN** a rendered diagram contains an `<a xlink:href="javascript:alert(1)">`
- **THEN** the injected SVG SHALL NOT retain the `javascript:` reference

#### Scenario: event handler dropped in any quoting form
- **WHEN** the rendered SVG contains elements with event-handler attributes written double-quoted, single-quoted and unquoted
- **THEN** the injected SVG SHALL carry no event-handler attribute

#### Scenario: foreignObject labels preserved
- **WHEN** a flowchart uses HTML labels rendered in `<foreignObject>`, including a `<br>` line break
- **THEN** the injected SVG SHALL still display the full label text on separate lines

#### Scenario: diagram types keep their features
- **WHEN** a flowchart with arrowhead markers, a sequence diagram, a class diagram and an ER diagram are rendered
- **THEN** each injected SVG SHALL keep its markers, theme `<style>` and label text

#### Scenario: init directive cannot inject theme CSS
- **WHEN** a diagram starts with `%%{init: {"themeCSS": "@import url(//evil.example/x.css); * {display:none}", "fontFamily": "x;*{display:none}"}}%%`
- **THEN** the injected SVG's `<style>` SHALL contain neither the `@import` nor the injected rules

#### Scenario: repaired render sanitized
- **WHEN** a diagram's original source fails to render and the rule-repaired source renders an SVG containing an event-handler attribute
- **THEN** the injected SVG SHALL carry no event-handler attribute

#### Scenario: sanitizer failure fails closed
- **WHEN** the sanitizer throws or reports itself unsupported during a render
- **THEN** the block SHALL show either the error view or a repaired render that itself passed sanitization, and no unsanitized SVG SHALL be injected or stored in the outcome cache
