## MODIFIED Requirements

### Requirement: MarkdownContent img override resolves pi-asset URIs
The `MarkdownContent` component SHALL register an `img` component override with ReactMarkdown. The override SHALL inspect `props.src` and:
- If `src` begins with `pi-asset:`, look up `src.slice("pi-asset:".length)` in the current `SessionAssetsContext` map. If found and its `mimeType` begins with `image/`, render `<img src="data:<mimeType>;base64,<data>" alt={alt} …>`; a registered asset with any other `mimeType` SHALL render the unresolved placeholder instead. If not found, render an unresolved placeholder (a small italic text node `[image not yet loaded]` or equivalent visual; exact wording an implementation detail but MUST be visible).
- Otherwise, for an allowed lower-case scheme — `data:image/*`, `http:`, `https:`, `blob:` — or a `#` or relative URL the agent didn't rewrite, render a default `<img>` with the original `src` unchanged so existing web-image behavior is preserved. Any other scheme (e.g. `data:text/html`, `javascript:`) reaches the override with no `src` (see `client-untrusted-content-sanitization`).

#### Scenario: pi-asset src with registered hash renders the image
- **WHEN** `MarkdownContent` renders text containing `![pic](pi-asset:abc)` and the session asset map contains `"abc": { data: "iVBOR...", mimeType: "image/png" }`
- **THEN** the rendered DOM SHALL contain `<img src="data:image/png;base64,iVBOR..." alt="pic">`

#### Scenario: pi-asset src with unregistered hash renders placeholder
- **WHEN** `MarkdownContent` renders text containing `![pic](pi-asset:zzz)` and `"zzz"` is NOT in the session asset map
- **THEN** the rendered DOM SHALL show a visible unresolved-placeholder element (not a broken-image glyph and not silent absence)

#### Scenario: External URL src unchanged
- **WHEN** `MarkdownContent` renders text containing `![logo](https://example.com/logo.png)`
- **THEN** the rendered DOM SHALL contain `<img src="https://example.com/logo.png" alt="logo">` exactly as today's default ReactMarkdown behavior

#### Scenario: data: src unchanged
- **WHEN** `MarkdownContent` renders text containing `![](data:image/png;base64,XXX)`
- **THEN** the rendered DOM SHALL contain `<img src="data:image/png;base64,XXX" …>`

#### Scenario: pi-asset with a non-image mimeType renders the placeholder
- **WHEN** the session asset map contains `"abc": { data: "PHNjcmlwdD4=", mimeType: "text/html" }` and `MarkdownContent` renders `![pic](pi-asset:abc)`
- **THEN** no `<img>` with a `data:text/html` source SHALL be rendered and the unresolved placeholder SHALL be shown

#### Scenario: Dropped-scheme image is not clickable
- **WHEN** `MarkdownContent` renders `![x](data:text/html;base64,AAAA)`
- **THEN** the rendered image SHALL have no `src` and clicking it SHALL NOT open the lightbox
