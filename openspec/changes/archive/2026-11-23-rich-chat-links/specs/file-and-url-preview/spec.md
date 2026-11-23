# Spec Delta

## ADDED Requirements

### Requirement: Web page views probe and frame only after an operator action

A web page view SHALL request a framing verdict, and SHALL frame the page, only after an operator action for that URL: a plain click on a chat link that opens or re-focuses the view, or the "Check and embed" action on its card. A view opened any other way SHALL show the open-in-browser card with "Check and embed" and SHALL make no request for the URL. Examples: an agent's canvas declaration, a `?url=` route or a `/pi-view` link.

#### Scenario: agent canvas URL is not auto-framed
- **WHEN** an agent declares a canvas target `https://example.com/x`
- **THEN** the view SHALL show the card with "Check and embed", and no probe request and no frame SHALL be made until the user chooses it

#### Scenario: chat link click checks and frames
- **WHEN** the user plain-clicks `https://example.com/docs` in the chat and the verdict is allowed
- **THEN** the page SHALL render in the view in a frame

#### Scenario: operator click on an agent-opened view
- **GIVEN** an agent opened a view for `https://example.com/x` that shows the card
- **WHEN** the user plain-clicks a chat link to the same URL
- **THEN** that view SHALL be focused and SHALL request the verdict

### Requirement: Framing verdicts and what each shows

The probe SHALL answer one of four verdicts: "allowed" frames the page; "refused" and "ineligible" show the open-in-browser card only; "undetermined" shows the card plus "Try to embed", which frames the page under the same isolation. "Undetermined" is only for a checked public target that answered without a clear verdict; every target the probe could not fully check is "ineligible". Any other probe error, including an unavailable route, SHALL show the card only.

#### Scenario: plain http is never framed
- **WHEN** a web page view is asked to show `http://example.com/`
- **THEN** no frame SHALL be created and the card SHALL be shown without "Try to embed"

#### Scenario: internal DNS name is never framed
- **WHEN** `https://wiki.corp.example/` resolves only to `10.1.2.3`
- **THEN** the verdict SHALL be ineligible and no frame or "Try to embed" SHALL be offered

#### Scenario: dashboard-trusted origin is never framed
- **WHEN** the URL is on the dashboard's own tunnel origin
- **THEN** the verdict SHALL be ineligible and no frame SHALL be created

#### Scenario: GitHub refuses framing
- **WHEN** the verdict for `https://github.com/org/repo` is refused
- **THEN** the view SHALL show the card and SHALL NOT contain a frame

#### Scenario: undetermined offers an explicit attempt
- **WHEN** the probe for an eligible URL times out
- **THEN** the card SHALL offer "Try to embed", and choosing it SHALL frame the page

#### Scenario: older server without the probe
- **WHEN** the probe route is unavailable
- **THEN** the view SHALL show the card without "Try to embed"

### Requirement: Framed web pages are isolated from the dashboard

A framed web page SHALL be sandboxed with scripts and forms only: an opaque origin, no same-origin access, no popups and no top-level navigation. It SHALL be loaded with no referrer. The shell SHALL say the page was embedded from the opened URL's host.

#### Scenario: frame cannot take over the dashboard
- **WHEN** a framed page tries to navigate the top-level window
- **THEN** the dashboard page SHALL NOT navigate

#### Scenario: navigation onto the dashboard origin stays opaque
- **WHEN** a framed page navigates itself to a URL on the dashboard's own origin
- **THEN** the loaded document SHALL have an opaque origin and SHALL NOT be able to read dashboard data or call dashboard APIs with credentials

#### Scenario: no popups
- **WHEN** a framed page calls `window.open`
- **THEN** no window SHALL open, in the browser or in the Electron shell

#### Scenario: no referrer leaks
- **WHEN** a view frames `https://example.com/docs`
- **THEN** the frame request SHALL carry no `Referer` naming the dashboard

### Requirement: Every web page view offers open in browser

The shell of every web page view, in the editor pane and in the overlay route alike, SHALL show an "Open in browser" control regardless of the verdict. The card SHALL also offer it.

#### Scenario: control present on a framed page
- **WHEN** a web page view in the editor pane renders a framed page
- **THEN** its header SHALL contain an "Open in browser" control that opens the URL in a new browser tab

#### Scenario: control present in the overlay
- **WHEN** `/pi-view?url=https://example.com/` renders
- **THEN** the overlay header SHALL contain an "Open in browser" control

### Requirement: The framing probe only contacts public https origins on port 443

The probe SHALL connect only to `https` origins on port 443 whose host shape is eligible for preview egress and whose address resolution is entirely public. Every redirect hop SHALL be re-checked the same way, and the probe SHALL connect to the address it checked. Special-purpose, reserved, IPv4-embedding IPv6 and unparseable addresses, single-label and internal-suffix hosts, and every dashboard-trusted origin SHALL be refused as "ineligible".

#### Scenario: private address refused
- **WHEN** a probe is requested for `https://10.0.0.5/admin`
- **THEN** the server SHALL NOT connect and SHALL return ineligible

#### Scenario: non-standard port refused
- **WHEN** a probe is requested for `https://example.com:8443/`
- **THEN** the server SHALL NOT connect and SHALL return ineligible

#### Scenario: redirect to a private address
- **WHEN** a public origin redirects to `https://192.168.1.1/`
- **THEN** the server SHALL stop before connecting to the private address and return ineligible

#### Scenario: Teredo or NAT64 address refused
- **WHEN** a host's only AAAA record is in `2001::/32` or `64:ff9b:1::/48`
- **THEN** the server SHALL NOT connect and SHALL return ineligible

#### Scenario: unresolvable host
- **WHEN** the server cannot resolve the host
- **THEN** the verdict SHALL be ineligible

#### Scenario: redirect chain longer than allowed
- **WHEN** an origin redirects more than 3 times
- **THEN** the verdict SHALL be ineligible and no further hop SHALL be contacted

#### Scenario: redirect to plain http
- **WHEN** a public origin redirects to `http://example.com/`
- **THEN** the server SHALL NOT follow it and SHALL return ineligible

#### Scenario: redirect to a dashboard-trusted origin
- **WHEN** a public origin redirects to the dashboard's own tunnel origin
- **THEN** the server SHALL stop before connecting and return ineligible

### Requirement: The framing probe touches only the origin root and returns only a verdict

The client SHALL send only the URL's origin. The probe SHALL send `HEAD /` and follow at most 3 redirects to server-given locations, never `GET`, cookies or credentials. It gives up within 5 seconds and returns only the verdict. It is a state-changing request under the cross-site origin check, needs a browser `Origin` that is one of the dashboard's own origins, requires the `control` tier, and is rate-limited per client with a global concurrency cap. Verdicts are cached per client and origin.

#### Scenario: path and query never sent
- **WHEN** the user opens `https://example.com/reset/abc123?token=x`
- **THEN** the probe request SHALL carry only `https://example.com`, and the first outbound request SHALL be `HEAD https://example.com/`

#### Scenario: cross-site request refused
- **WHEN** a page on another site makes the browser send a probe request
- **THEN** the server SHALL refuse it without any outbound request

#### Scenario: request without a dashboard origin refused
- **WHEN** a probe request carries no `Origin`, or an `Origin` that is not one of the dashboard's own origins
- **THEN** the server SHALL refuse it without any outbound request

#### Scenario: redirect carrying credentials
- **WHEN** a redirect `Location` contains `user:pass@`
- **THEN** the verdict SHALL be ineligible and no request SHALL carry those credentials

#### Scenario: HEAD not supported
- **WHEN** the origin answers `HEAD /` with 405
- **THEN** the verdict SHALL be undetermined and no `GET` SHALL be sent

#### Scenario: verdicts are cached per client
- **WHEN** the same client probes the same origin twice within the cache window
- **THEN** the server SHALL make at most one outbound request

#### Scenario: observe-tier client refused
- **WHEN** a client with only the `observe` tier requests a probe
- **THEN** the server SHALL refuse it without any outbound request

#### Scenario: rate limit
- **WHEN** one client exceeds the probe rate limit
- **THEN** the server SHALL refuse with 429 and make no outbound request

### Requirement: Framing verdict follows the browser's framing precedence

Only a final 2xx response gives "allowed" or "refused"; any other final status is "undetermined". CSP `frame-ancestors` directives, when present, alone decide: "refused" unless each matches the dashboard origin. Without them, `X-Frame-Options` `DENY`, `SAMEORIGIN`, `ALLOW-FROM` or conflicting values (any case) SHALL give "refused"; an unparseable single value is ignored. Otherwise "allowed".

#### Scenario: DENY refuses
- **WHEN** the response has `X-Frame-Options: deny` and no `frame-ancestors`
- **THEN** the verdict SHALL be refused

#### Scenario: frame-ancestors overrides X-Frame-Options
- **WHEN** the response has `X-Frame-Options: SAMEORIGIN` and `Content-Security-Policy: frame-ancestors https:` and the dashboard origin is https
- **THEN** the verdict SHALL be allowed

#### Scenario: frame-ancestors none refuses
- **WHEN** the response has `Content-Security-Policy: frame-ancestors 'none'`
- **THEN** the verdict SHALL be refused

#### Scenario: challenge page is not allowed
- **WHEN** the final response to `HEAD /` is a 403 with no framing headers
- **THEN** the verdict SHALL be undetermined

#### Scenario: conflicting X-Frame-Options
- **WHEN** the response has `X-Frame-Options: DENY, SAMEORIGIN`
- **THEN** the verdict SHALL be refused

## MODIFIED Requirements

### Requirement: Renderer dispatch is purely shape-based

A pure function `dispatchPreview(target: ViewTarget): RendererKind` SHALL select the
renderer using only the target's shape (extension for files; host + URL extension for
URLs). It SHALL NOT perform server round-trips, MIME sniffing, or file reads to make the
decision. `RendererKind` SHALL be one of
`"markdown" | "asciidoc" | "html" | "pdf" | "video" | "audio" | "image" | "youtube" | "docx" | "pptx" | "spreadsheet" | "email" | "diagram" | "webpage" | "fallback"`.
The `.pptx` file extension (compared case-insensitively) SHALL map to `"pptx"`. An http(s) URL target that is not a YouTube host SHALL map to `"webpage"` unless its path has a media or document extension whose renderer accepts URL targets; `.html`, `.htm`, `.md` and other file-only kinds map to `"webpage"` for URL targets. Framing decisions are made by that renderer, not by dispatch. `"webpage"` is not a canvas type.

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

#### Scenario: PPTX extension
- **WHEN** the file extension is `.pptx` (compared case-insensitively)
- **THEN** the result is `"pptx"`

#### Scenario: Spreadsheet extensions
- **WHEN** the file extension is `.xlsx` or `.csv` (compared case-insensitively)
- **THEN** the result is `"spreadsheet"`

#### Scenario: EML extension
- **WHEN** the file extension is `.eml`
- **THEN** the result is `"email"`

#### Scenario: PlantUML extensions
- **WHEN** the file extension is `.puml` or `.plantuml` (compared case-insensitively)
- **THEN** the result is `"diagram"`

#### Scenario: Unknown file extension
- **WHEN** the file extension is unrecognized (e.g. `.dat`)
- **THEN** the result is `"fallback"`

#### Scenario: Generic web URL
- **WHEN** `dispatchPreview({ kind: "url", url: "https://example.com/docs" })` is called
- **THEN** the result is `"webpage"`

#### Scenario: Web URL with a media extension
- **WHEN** the URL is `https://example.com/clip.mp4`
- **THEN** the result is `"video"`

#### Scenario: Web URL ending in .html
- **WHEN** the URL is `https://example.com/index.html`
- **THEN** the result is `"webpage"`

### Requirement: Overlay and editor-pane surfaces share renderers

Every renderer (`MarkdownPreview`, `AsciiDocPreview`, `HtmlPreview`, `PdfPreview`, `VideoPreview`, `ImagePreview`, `YouTubePreview`, `DocxPreview`, `PptxPreview`, `SpreadsheetPreview`, `EmlPreview`, `WebPagePreview`, `FallbackPreview`) SHALL be usable in two contexts: the `/pi-view` / `…/view` overlay route (FileLink / OpenFileButton / canvas) and the internal editor pane (`viewer-registry` + `UrlViewer`). The renderer component SHALL NOT contain navigation or surface chrome; the shell is owned by the overlay route component or the editor-pane viewer wrapper, and both shells SHALL offer "Open in browser" for URL targets. Because the editor pane supplies no scroll container of its own, the editor-pane wrapper of a flow-height renderer (`AsciiDocPreview`, `DocxPreview` HTML mode) SHALL provide one, so long documents scroll within the pane instead of overflowing it. There is no longer an in-chat `PreviewCard` surface.

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

#### Scenario: Web page renderer in both shells

- **GIVEN** a web URL opened in the editor pane and through `/pi-view?url=`
- **WHEN** each renders
- **THEN** both SHALL mount the same `WebPagePreview`, and each shell SHALL show "Open in browser"
