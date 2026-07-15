# file-and-url-preview — delta

## MODIFIED Requirements

### Requirement: Renderer dispatch is purely shape-based

A pure function `dispatchPreview(target: ViewTarget): RendererKind` SHALL select the
renderer using only the target's shape (extension for files; host + URL extension for
URLs). It SHALL NOT perform server round-trips, MIME sniffing, or file reads to make the
decision. `RendererKind` SHALL be one of
`"markdown" | "asciidoc" | "html" | "pdf" | "video" | "audio" | "image" | "youtube" | "docx" | "spreadsheet" | "email" | "fallback"`.

#### Scenario: Markdown extension
- **WHEN** `dispatchPreview({ kind: "file", cwd, path: "x.md" })` is called
- **THEN** the result is `"markdown"`

#### Scenario: PDF extension
- **WHEN** the file extension is `.pdf`
- **THEN** the result is `"pdf"`

#### Scenario: Video extensions
- **WHEN** the file extension is one of `.mp4`, `.webm`, `.mov`
- **THEN** the result is `"video"`

#### Scenario: Audio extensions
- **WHEN** the file extension is one of `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`
- **THEN** the result is `"audio"`

#### Scenario: Image extensions
- **WHEN** the file extension is one of `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`
- **THEN** the result is `"image"`

#### Scenario: HTML extension
- **WHEN** the file extension is `.html` or `.htm`
- **THEN** the result is `"html"`

#### Scenario: DOCX extension
- **WHEN** the file extension is `.docx` (compared case-insensitively)
- **THEN** the result is `"docx"`

#### Scenario: Spreadsheet extensions
- **WHEN** the file extension is `.xlsx` or `.csv` (compared case-insensitively)
- **THEN** the result is `"spreadsheet"`

#### Scenario: EML extension
- **WHEN** the file extension is `.eml`
- **THEN** the result is `"email"`

#### Scenario: Unknown file extension
- **WHEN** the file extension is unrecognized (e.g. `.dat`)
- **THEN** the result is `"fallback"`

## ADDED Requirements

### Requirement: EML parse endpoint

The server SHALL expose `GET /api/file/eml?cwd=&path=` that parses the file as a MIME
`message/rfc822` document with `mailparser`, sanitizes the HTML body with DOMPurify
(server-side), and returns `{ success: true, data: { headers, html, text, attachments } }`
where `attachments` is an array of `{ index, filename, mimeType, size, contentId, isInline }`
(metadata only — no attachment bytes). Parsing SHALL occur server-side; the raw `.eml` bytes
and inlined attachment base64 SHALL NOT be returned to the client. The endpoint SHALL reject
any extension other than `.eml` (compared case-insensitively) with HTTP 400. It SHALL reject a
file whose size exceeds a configured cap (default 25 MB) with HTTP 413 **before** reading it
into memory. It SHALL enforce anti-traversal by **calling the same shared gate helper as
`/api/file/raw`** (not a re-implementation). The parse result MAY be memoized in a short-lived
cache keyed by path + mtime + size so the attachment endpoint does not re-parse per request.

#### Scenario: EML parsed to headers, sanitized body, attachment metadata
- **GIVEN** `mail.eml` exists in a known cwd and contains a `multipart/mixed` message with an
  HTML body and one PDF attachment
- **WHEN** the client requests `/api/file/eml?cwd=…&path=mail.eml`
- **THEN** the response is `{ success: true, data: { headers, html, text, attachments } }`
- **AND** `attachments` has one entry with `mimeType: "application/pdf"` and its `filename`,
  `size`, and `index`
- **AND** `data` does NOT contain the attachment's base64 bytes

#### Scenario: Body HTML is sanitized
- **GIVEN** an `.eml` whose HTML body contains a `<script>` tag and an `onclick` attribute
- **WHEN** parsed through this endpoint
- **THEN** the returned `html` contains neither the `<script>` element nor the `onclick`
  attribute

#### Scenario: Non-EML rejected
- **WHEN** the path's extension is `.pdf`
- **THEN** the response status is 400 and `{ success: false, error: "renderer not supported for extension" }`

#### Scenario: EML extension matched case-insensitively
- **WHEN** the path is `Mail.EML`
- **THEN** the endpoint accepts it (extension compared lowercased) and parses normally

#### Scenario: Oversized EML rejected before read
- **GIVEN** an `.eml` file larger than the configured size cap (default 25 MB)
- **WHEN** the client requests `/api/file/eml`
- **THEN** the response status is 413 and the server does NOT read the full file into memory

#### Scenario: Unknown cwd rejected
- **GIVEN** `cwd` is not present in any active session
- **WHEN** the client requests `/api/file/eml?cwd=/unknown&path=mail.eml`
- **THEN** the server responds with HTTP 403

#### Scenario: Malformed MIME fails gracefully
- **GIVEN** a `.eml` file whose MIME structure is corrupt/truncated
- **WHEN** parsed through this endpoint
- **THEN** the server responds with an HTTP **400** error and `{ success: false, error: … }`
  and does NOT crash the process (malformed parse uses 400, consistent with the file-routes
  error convention of 400/403/404/413/500 — not 422)

### Requirement: EML attachment streaming endpoint is content-type-safe

The server SHALL expose `GET /api/file/eml-attachment?cwd=&path=&index=` that parses the
`.eml` and streams the single decoded attachment part at `index`. The response SHALL set
`Content-Type` to the part's declared MIME type, and SHALL ALWAYS set
`Content-Disposition: attachment` (never `inline`) carrying the part's original filename AND
`X-Content-Type-Options: nosniff`, so an attacker-declared `text/html`/SVG part cannot execute
in the dashboard origin. It SHALL enforce anti-traversal by calling the same shared gate helper
as `/api/file/raw`. `index` SHALL be parsed as a 0-based integer; a non-integer/negative value
SHALL return HTTP 400 and an index outside the parsed attachment range SHALL return HTTP 404.

#### Scenario: Attachment streamed with safe headers
- **GIVEN** `mail.eml` has a PDF attachment at index 0
- **WHEN** the client requests `/api/file/eml-attachment?cwd=…&path=mail.eml&index=0`
- **THEN** the response Content-Type is `application/pdf`
- **AND** `Content-Disposition` is `attachment` with the original filename
- **AND** the `X-Content-Type-Options: nosniff` header is present
- **AND** the body is the decoded attachment bytes

#### Scenario: HTML-typed attachment cannot execute in origin
- **GIVEN** an attachment whose declared MIME type is `text/html`
- **WHEN** the client requests it from `/api/file/eml-attachment`
- **THEN** the response carries `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`
  (the browser downloads it; it does NOT render as a document in the dashboard origin)

#### Scenario: Non-integer index rejected
- **WHEN** the client requests `index=abc` (or `index=-1`)
- **THEN** the response status is 400

#### Scenario: Out-of-range index returns 404
- **GIVEN** `mail.eml` has 2 attachments (indices 0 and 1)
- **WHEN** the client requests `index=5`
- **THEN** the response status is 404

### Requirement: EmlPreview renders headers, isolated body, and attachments

The client SHALL provide an `EmlPreview` renderer (registered for `RendererKind "email"`)
that fetches `/api/file/eml`, displays the message headers (from, to, subject, date), renders
the sanitized body inside an `<iframe>` whose `sandbox` attribute is the **empty string**
(opaque origin — NOT `allow-same-origin`, and no `allow-scripts`, `allow-forms`,
`allow-top-navigation`, or `allow-popups`), and lists the attachments. This is deliberately
stricter than `HtmlPreview` (which renders trusted local `.html` with `allow-same-origin`)
because `.eml` bodies are untrusted sender HTML: an opaque origin removes any same-origin
access to `/api/*` from embedded refs. Header values SHALL be rendered as escaped text nodes
(never `dangerouslySetInnerHTML`). Like every other renderer, `EmlPreview` SHALL be wired
through `PreviewBody` so it is usable both inline within `PreviewCard` and full-screen within
the `/view` overlay, and SHALL NOT own navigation or surface chrome.

#### Scenario: Body rendered in an opaque-origin, script-free sandbox
- **GIVEN** an `.eml` whose body HTML (post-sanitize) is rendered by `EmlPreview`
- **WHEN** the component mounts
- **THEN** the body iframe's `sandbox` attribute is exactly `""` (empty — no `allow-same-origin`,
  no `allow-scripts`) and no body script executes and the body has no same-origin API access

#### Scenario: Header values are escaped, not HTML
- **GIVEN** an `.eml` whose decoded Subject header contains `<img src=x onerror=alert(1)>`
- **WHEN** `EmlPreview` displays the headers
- **THEN** the subject is shown as literal text (escaped); no element is created from it

#### Scenario: Headers displayed
- **WHEN** `EmlPreview` renders a parsed `.eml`
- **THEN** the from, to, subject, and date headers are shown

#### Scenario: Same component in both shells
- **GIVEN** the inline `PreviewCard` displays an `.eml` target
- **WHEN** the user activates the `⤢ expand` affordance
- **THEN** the `/view` overlay mounts the SAME `EmlPreview` component with the same `target` prop

### Requirement: EML attachments dispatch by MIME to existing renderers

Within `EmlPreview`, each attachment's inline behavior SHALL be selected by its `mimeType`:
`application/pdf` attachments SHALL render inline via the existing `PdfPreview`; `image/*`
attachments SHALL render inline via the existing `ImagePreview`; all other types SHALL render
as a download-only row with no inline preview. Inline previews SHALL fetch the bytes from
`/api/file/eml-attachment` into a `blob:` URL and pass THAT to the renderer — never a top-level
browser navigation to the route. Attachment bytes SHALL be fetched lazily — only when a
previewable attachment is expanded, an inline `cid:` image resolves, or the user downloads it
— never eagerly on parse.

#### Scenario: PDF attachment previews inline
- **GIVEN** a parsed `.eml` with a PDF attachment
- **WHEN** the user expands that attachment row
- **THEN** the PDF renders inline via `PdfPreview` sourced from `/api/file/eml-attachment?…&index=<n>`

#### Scenario: Image attachment previews inline
- **GIVEN** a parsed `.eml` with a `image/jpeg` attachment
- **WHEN** the user expands that attachment row
- **THEN** the image renders inline via `ImagePreview`

#### Scenario: Non-previewable attachment is download-only
- **GIVEN** a parsed `.eml` with a `.docx` attachment
- **THEN** its row offers download only (no expand affordance, no inline preview)

#### Scenario: Attachment bytes fetched lazily
- **GIVEN** a parsed `.eml` with a 4 MB PDF attachment
- **WHEN** `EmlPreview` first renders (no attachment expanded)
- **THEN** no request to `/api/file/eml-attachment` has been made
- **AND** the request occurs only when the attachment row is expanded or downloaded

### Requirement: Remote content blocked by default in EML bodies

`EmlPreview` SHALL NOT load remote resources referenced by the email body by default; remote
image references SHALL be neutralized so no network request is made on render. The component
SHALL surface a "Load remote content" affordance that re-requests the body with
`?allowRemote=1` and permits remote content for the current view only (not persisted). Remote
resources SHALL be fetched by the **browser** inside the sandboxed iframe; the **server SHALL
NOT fetch remote URLs** on the sender's behalf (no SSRF). Inline `cid:` images (backed by
attachment parts) are NOT remote and SHALL be resolved to `blob:` URLs (case-insensitive
Content-ID match, angle brackets stripped) and displayed by default, including `cid:` refs that
appear in CSS `url()` within `<style>` blocks and inline `style` attributes.

#### Scenario: Remote image blocked on render
- **GIVEN** an `.eml` body referencing `<img src="https://tracker.example/pixel.gif">`
- **WHEN** `EmlPreview` renders it
- **THEN** no request is made to `tracker.example` and the image is shown as a blocked
  placeholder

#### Scenario: Load remote content on demand
- **GIVEN** the blocked-remote-content banner is shown
- **WHEN** the user activates "Load remote content"
- **THEN** the client re-requests the body with `?allowRemote=1` and remote resources in the
  current view are permitted to load (fetched by the browser, not the server)

#### Scenario: Server never fetches remote resources
- **GIVEN** an `.eml` body referencing `<img src="http://localhost:8000/api/file/raw?...">`
  or an intranet URL
- **WHEN** the body is parsed/sanitized server-side (even with `allowRemote=1`)
- **THEN** the server makes NO outbound request to that URL (remote fetches happen only in the
  browser)

#### Scenario: Inline cid image shown by default
- **GIVEN** an `.eml` whose body references an inline image via `cid:logo@x` backed by an
  attachment part
- **WHEN** `EmlPreview` renders it
- **THEN** the image is displayed (sourced from `/api/file/eml-attachment`), not blocked
