# file-and-url-preview Specification

## Purpose
TBD - created by archiving change render-file-previews. Update Purpose after archive.
## Requirements
### Requirement: ViewTarget discriminated union

The dashboard SHALL define a `ViewTarget` discriminated union in `packages/shared/src/types.ts` with exactly two variants: `{ kind: "file"; cwd: string; path: string }` and `{ kind: "url"; url: string }`. `ChatMessage` SHALL gain an optional `view?: ViewTarget` field; the existing `content`, `role`, `id`, and other fields remain unchanged. The addition is additive — existing serialized messages without a `view` field deserialize successfully.

#### Scenario: File target shape

- **GIVEN** the user runs `/view @docs/foo.md` while in a session with `cwd = "/home/u/proj"`
- **WHEN** the composer constructs a `ViewTarget`
- **THEN** the result is `{ kind: "file", cwd: "/home/u/proj", path: "docs/foo.md" }`

#### Scenario: URL target shape

- **GIVEN** the user runs `/view https://youtu.be/abc123`
- **WHEN** the composer constructs a `ViewTarget`
- **THEN** the result is `{ kind: "url", url: "https://youtu.be/abc123" }`

#### Scenario: Backward compatibility

- **GIVEN** a `ChatMessage` serialized before this change (no `view` field)
- **WHEN** deserialized by code that includes this change
- **THEN** the resulting object has `view === undefined` and all other fields intact

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

### Requirement: Binary-safe file serving endpoint

The server SHALL expose `GET /api/file/raw?cwd=&path=` that streams the file contents with `Content-Type` derived from the file extension via a shared `extToContentType` mapping. The endpoint SHALL enforce the same anti-traversal gate as `/api/file`: `cwd` must match a known session cwd, and `path.resolve(cwd, relPath)` must remain inside `cwd`. The endpoint SHALL support HTTP `Range` requests so `<video>` seek bars work.

#### Scenario: Unknown cwd rejected

- **GIVEN** `cwd` is not present in any active session
- **WHEN** the client requests `/api/file/raw?cwd=/unknown&path=foo.pdf`
- **THEN** the server responds with HTTP 403 and `{ success: false, error: "unknown session path" }`

#### Scenario: Path traversal rejected

- **GIVEN** `cwd` is a known session cwd
- **WHEN** the client requests `/api/file/raw?cwd=/home/u/proj&path=../../../etc/passwd`
- **THEN** the server responds with HTTP 403 and `{ success: false, error: "path outside working directory" }`

#### Scenario: PDF served with correct Content-Type

- **GIVEN** `foo.pdf` exists inside a known cwd
- **WHEN** the client requests `/api/file/raw?cwd=…&path=foo.pdf`
- **THEN** the response Content-Type is `application/pdf` and the body is the raw file bytes

#### Scenario: Range request returns 206

- **GIVEN** `video.mp4` exists inside a known cwd
- **WHEN** the client requests with `Range: bytes=1024-2047`
- **THEN** the response status is 206 (Partial Content) with the requested byte range and a `Content-Range` header

#### Scenario: Missing file returns 404

- **GIVEN** the resolved path does not exist on disk
- **WHEN** the client requests `/api/file/raw`
- **THEN** the response status is 404

### Requirement: AsciiDoc rendering endpoint

The server SHALL expose `GET /api/file/render?cwd=&path=` that runs `asciidoctor` in `safe: "secure"` mode against the file and returns `{ success: true, data: { html } }`. It SHALL reject any extension other than `.adoc` / `.asciidoc` with HTTP 400. It SHALL enforce the same anti-traversal gate as `/api/file/raw`.

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

### Requirement: HTML preview is sandboxed without script execution

The `HtmlPreview` component SHALL render local `.html` files in an `<iframe>` with the `sandbox` attribute set to `allow-same-origin` only. It SHALL NOT include `allow-scripts`, `allow-forms`, `allow-top-navigation`, or `allow-popups`. The iframe `srcdoc` attribute SHALL be populated with the file contents fetched from `/api/file/raw`.

#### Scenario: Sandbox excludes scripts

- **GIVEN** a local `.html` file containing a `<script>` tag
- **WHEN** the user opens it through `/view @file.html`
- **THEN** the iframe sandbox is `"allow-same-origin"` and the `<script>` does not execute (sandbox without `allow-scripts` blocks all script execution)

#### Scenario: Chat HTML content NOT rendered

- **GIVEN** an agent message contains an `<html>` block in its content
- **WHEN** the message renders in `ChatView`
- **THEN** the existing markdown / text rendering path runs; the `HtmlPreview` component does NOT render chat content (HtmlPreview is only invoked from `/view @<file>.html`)

### Requirement: PDF preview ships as a lazy chunk

The `PdfPreview` component SHALL be imported via dynamic `import()` (`React.lazy`) so that the `pdfjs-dist` dependency does NOT appear in the main client bundle. The build output SHALL place pdfjs in a separate chunk loaded only when a PDF preview mounts.

#### Scenario: Main bundle excludes pdfjs

- **WHEN** `npm run build` runs
- **THEN** the main entry chunk (`assets/index-*.js`) does NOT contain `pdfjs-dist`
- **AND** a separate chunk containing `pdfjs-dist` exists

### Requirement: Inline + overlay surfaces share renderers

Every renderer (`MarkdownPreview`, `AsciiDocPreview`, `HtmlPreview`, `PdfPreview`, `VideoPreview`, `ImagePreview`, `YouTubePreview`, `FallbackPreview`) SHALL be usable in two contexts: inline within `PreviewCard` (in-chat) and full-screen within the `/view` overlay route. The renderer component SHALL NOT contain navigation or surface chrome; the shell is owned by `PreviewCard` (inline) or the overlay route component (full-screen).

#### Scenario: Same component, two shells

- **GIVEN** the inline `PreviewCard` displays a `.pdf` target
- **WHEN** the user clicks the `⤢ expand` icon
- **THEN** the overlay route mounts the SAME `PdfPreview` component with the same `target` prop (no separate fullscreen variant component)

### Requirement: Preview overlay does not block the composer

The file/URL preview overlay SHALL be a non-blocking inspector: while it is open, the chat composer (textarea and all its controls, including the send button) SHALL remain interactive. The overlay's dimming backdrop SHALL NOT intercept pointer events over the composer region, so a user can send a new prompt without first dismissing the preview. Explicit dismissal (Esc, close button, backdrop click outside the panel) SHALL still close the overlay.

This preserves the companion invariant (change `fix-file-preview-survives-message-churn`): the overlay stays open with its content intact across a new message, streaming tokens, and the streaming→committed transition.

#### Scenario: Send a prompt while a preview is open

- **WHEN** a file preview overlay is open
- **AND** the user types a prompt into the composer and clicks the send button
- **THEN** the prompt SHALL be sent (the send-button click SHALL NOT be intercepted by the preview backdrop)
- **AND** the overlay SHALL remain open with its content intact

#### Scenario: Explicit dismissal still closes the overlay

- **WHEN** a file preview overlay is open
- **AND** the user presses Escape
- **THEN** the overlay SHALL close

### Requirement: Inline size caps prevent runaway height

`PreviewCard` SHALL apply size caps to the inline renderer per the design.md D2 policy: markdown/asciidoc/html capped at `max-h-[60vh]` with internal scroll; pdf fixed at `h-[60vh]`; video/youtube at 16:9 aspect ratio with `max-w-full`; image capped at `max-h-[40vh] max-w-full`.

#### Scenario: Large markdown does not stretch chat

- **GIVEN** the target is a 10,000-line markdown file
- **WHEN** the `PreviewCard` mounts in chat
- **THEN** the card height is at most 60vh and the body scrolls internally

#### Scenario: Image dimensions capped

- **GIVEN** the target is a 4000×3000 image
- **WHEN** the `PreviewCard` mounts in chat
- **THEN** the image scales to fit within `max-h-[40vh]` and `max-w-full` without overflow

### Requirement: Markdown preview enables frontmatter properties

When a file dispatches to the `"markdown"` renderer (a `.md`/`.mdx` file in `FilePreviewOverlay` or any inline markdown preview surface), the renderer SHALL pass `frontmatter="properties"` to `MarkdownContent` so a leading YAML frontmatter block renders as a collapsed Properties panel above the body instead of being hidden or mangled.

#### Scenario: Markdown file with frontmatter opened in overlay

- **WHEN** the user opens a `.md` file whose content begins with a YAML frontmatter block in `FilePreviewOverlay`
- **THEN** the overlay SHALL render a collapsed Properties panel above the markdown body
- **AND** the frontmatter SHALL NOT render as a heading or a thematic break

#### Scenario: Markdown file without frontmatter

- **WHEN** the user opens a `.md` file with no leading frontmatter block
- **THEN** no Properties panel SHALL render and the body SHALL render normally

### Requirement: Audio preview renderer

The dashboard SHALL provide an `AudioPreview` renderer for audio file targets. It SHALL
stream bytes from `/api/file/raw` into an `<audio controls preload="metadata">` element,
relying on the raw endpoint's HTTP Range support for seeking. It SHALL show a loading
state and an error state on fetch failure, mirroring the other `preview/*` renderers.

#### Scenario: Audio file renders with native controls
- **GIVEN** a target `{ kind: "file", cwd, path: "assets/chime.mp3" }`
- **WHEN** the audio preview renders
- **THEN** it mounts `<audio controls>` sourced from `/api/file/raw?cwd=&path=assets/chime.mp3`
- **AND** the seek bar works via the endpoint's Range responses

### Requirement: DOCX rendered two ways, engine-gated

The server render endpoint `GET /api/file/render?cwd=&path=` SHALL, for a `.docx` file, return a
discriminated result `{ success: true, data: { mode, … } }` where `mode` is `"pdf"` or `"html"`:

- When the `document-converter` engine is available, the endpoint SHOULD render the docx to PDF
  via the existing `renderPdf` facade, cache it (keyed by path + mtime + size), and return
  `{ mode: "pdf" }`; the PDF bytes SHALL be streamed by a companion
  `GET /api/file/rendered-pdf?cwd=&path=` endpoint, not inlined in this response.
- Otherwise — or when any engine call fails (`DOCKER_UNAVAILABLE`, non-zero exit, timeout) — the
  endpoint SHALL fall back to `{ mode: "html", html, truncated, imageCount, note }`, where `html`
  is produced by `mammoth` and DOMPurify-sanitized server-side. The `mammoth` parse SHALL apply
  a `transformDocument` hyperlink-guard that sets `href` to an empty string on any hyperlink node
  whose href and anchor are both null, so documents that would otherwise crash `mammoth` render
  successfully, and SHALL apply the bounded-preview policy (strip images past a count/byte cap).

The endpoint SHALL reject any extension it does not support (compared case-insensitively) with
HTTP 400, SHALL enforce anti-traversal by calling the same shared gate helper as
`/api/file/raw`, and SHALL reject a file whose size exceeds a configured cap (HTTP 413) before
reading it into memory. The raw `.docx` bytes SHALL NOT be returned to the client. A missing or
unavailable engine SHALL never fail the request.

#### Scenario: Engine available renders to PDF
- **GIVEN** the `document-converter` engine is available
- **WHEN** a valid `.docx` is requested
- **THEN** the response is `{ mode: "pdf" }` and `GET /api/file/rendered-pdf` streams the PDF bytes

#### Scenario: Engine unavailable falls back to sanitized HTML
- **GIVEN** the engine is unavailable (or its call fails)
- **WHEN** a valid `.docx` with headings and a table is requested
- **THEN** the response is `{ mode: "html" }` whose `html` contains the heading and table markup
  with no `<script>` or event-handler attributes

#### Scenario: Hyperlink-guard prevents the null-href crash (html mode)
- **GIVEN** the engine is unavailable and a `.docx` contains a hyperlink with neither a URL
  target nor an internal anchor
- **WHEN** it is rendered
- **THEN** the response is `success: true`, `mode: "html"` with rendered HTML (no server error)

#### Scenario: Image-heavy docx is bounded (html mode)
- **GIVEN** the engine is unavailable and a `.docx` whose image count or HTML size exceeds the cap
- **WHEN** it is rendered
- **THEN** `data.truncated` is `true`, images are replaced with placeholders, and `data.html`
  stays below the byte cap

#### Scenario: Corrupt docx degrades, does not crash
- **WHEN** a corrupt or non-zip `.docx` is requested
- **THEN** the response is `{ success: false, error }` and the worker does not crash

#### Scenario: Oversize docx rejected before read
- **WHEN** a `.docx` larger than the size cap is requested
- **THEN** the response is HTTP 413 and the full file is not read into memory

### Requirement: Spreadsheet parse endpoint

The server SHALL expose `GET /api/file/sheet?cwd=&path=&limit=` that parses a `.xlsx` or `.csv`
file with SheetJS and returns
`{ success: true, data: { sheets: [{ name, header, rows, totalRows, totalCols, truncated }], activeSheet, encoding } }`.
Each sheet's `rows` SHALL be bounded to the first N rows (default 500, overridable up to a
maximum by `limit`) and to a configured column cap, with `truncated` set when the sheet exceeds
either cap and `totalRows`/`totalCols` reporting the true dimensions. For `.csv`, the endpoint
SHALL detect the file encoding and decode to UTF-8 before parsing, reporting the decoded charset
in `data.encoding`. The endpoint SHALL reject any extension other than `.xlsx`/`.csv` (compared
case-insensitively) with HTTP 400, SHALL enforce anti-traversal by calling the same shared gate
helper as `/api/file/raw`, and SHALL reject a file whose size exceeds a configured cap
(HTTP 413) before reading it into memory.

#### Scenario: Multi-sheet workbook parsed with tabs
- **WHEN** a `.xlsx` with multiple sheets is requested
- **THEN** `data.sheets` has one entry per sheet and `data.activeSheet` names the first

#### Scenario: Large sheet is bounded
- **GIVEN** a sheet with more rows than the cap
- **WHEN** it is requested
- **THEN** its `rows` length equals the cap, `truncated` is `true`, and `totalRows` reports the
  true row count

#### Scenario: Non-UTF-8 csv decoded
- **GIVEN** a `.csv` encoded as windows-1250 (e.g. Hungarian, with ő/ű double-acute vowels)
- **WHEN** it is requested
- **THEN** the accented characters decode correctly and `data.encoding` reports a
  Central-European (Latin-2 family) charset such as `"ISO-8859-2"` or `"windows-1250"`
  (statistical detection may label either; both decode the shared Hungarian letters identically)

#### Scenario: Password-protected or corrupt spreadsheet degrades
- **WHEN** a password-protected or corrupt spreadsheet is requested
- **THEN** the response is `{ success: false, error }` and the worker does not crash

#### Scenario: Oversize spreadsheet rejected before read
- **WHEN** a `.xlsx`/`.csv` larger than the size cap is requested
- **THEN** the response is HTTP 413 and the full file is not read into memory

### Requirement: DOCX and spreadsheet renderers mount in shared shells

`PreviewBody` SHALL render the `"docx"` kind with a `DocxPreview` component and the
`"spreadsheet"` kind with a `SpreadsheetPreview` component, so both the inline `PreviewCard` and
the `/view` overlay use the same renderer. `DocxPreview` SHALL fetch `/api/file/render`, show
loading and error states, and branch on `data.mode`: for `"pdf"` it SHALL mount the existing
`PdfPreview` against `/api/file/rendered-pdf`; for `"html"` it SHALL render the sanitized HTML
via `dangerouslySetInnerHTML` and show a truncation banner when `data.truncated`.
`SpreadsheetPreview` SHALL fetch `/api/file/sheet`,
render a frozen-header grid with sheet tabs for multi-sheet workbooks, and show a truncation
banner reporting bounded vs. total rows (and decoded charset for `.csv`). Any server
`{ success: false }` SHALL render the existing `FallbackPreview` download card.

#### Scenario: docx inline and overlay share the renderer
- **WHEN** a `.docx` is viewed inline and then expanded to the `/view` overlay
- **THEN** both render via `DocxPreview`

#### Scenario: docx pdf mode mounts PdfPreview
- **GIVEN** a `/api/file/render` response with `mode: "pdf"`
- **WHEN** `DocxPreview` renders
- **THEN** it mounts `PdfPreview` pointed at `/api/file/rendered-pdf`

#### Scenario: Truncation banner shown when bounded
- **GIVEN** a spreadsheet response with `truncated: true`
- **WHEN** `SpreadsheetPreview` renders
- **THEN** a banner shows the bounded row count, the total row count, and a download affordance

#### Scenario: Server failure falls back to download
- **GIVEN** a server response `{ success: false }`
- **WHEN** the renderer handles it
- **THEN** the existing `FallbackPreview` download card is shown

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

