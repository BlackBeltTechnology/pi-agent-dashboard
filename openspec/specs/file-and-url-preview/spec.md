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

A pure function `dispatchPreview(target: ViewTarget): RendererKind` SHALL select the renderer using only the target's shape (extension for files; host + URL extension for URLs). It SHALL NOT perform server round-trips, MIME sniffing, or file reads to make the decision. `RendererKind` SHALL be one of `"markdown" | "asciidoc" | "html" | "pdf" | "video" | "image" | "youtube" | "fallback"`.

#### Scenario: Markdown extension

- **WHEN** `dispatchPreview({ kind: "file", cwd, path: "x.md" })` is called
- **THEN** the result is `"markdown"`

#### Scenario: AsciiDoc extensions

- **WHEN** the file extension is `.adoc` or `.asciidoc` (case-insensitive)
- **THEN** the result is `"asciidoc"`

#### Scenario: PDF extension

- **WHEN** the file extension is `.pdf`
- **THEN** the result is `"pdf"`

#### Scenario: Video extensions

- **WHEN** the file extension is one of `.mp4`, `.webm`, `.mov`
- **THEN** the result is `"video"`

#### Scenario: Image extensions

- **WHEN** the file extension is one of `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`
- **THEN** the result is `"image"`

#### Scenario: HTML extension

- **WHEN** the file extension is `.html` or `.htm`
- **THEN** the result is `"html"`

#### Scenario: YouTube hosts

- **WHEN** the URL host is one of `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`
- **THEN** the result is `"youtube"`

#### Scenario: Unknown file extension

- **WHEN** the file extension is unrecognized (e.g. `.dat`)
- **THEN** the result is `"fallback"`

#### Scenario: Unknown URL with no known extension

- **WHEN** the URL is `https://example.com/foo` (no extension, no known host)
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

