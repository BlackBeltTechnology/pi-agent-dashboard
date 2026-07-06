## ADDED Requirements

### Requirement: Loopback URLs in chat markdown open in the internal split viewer

A URL rendered as an anchor by `MarkdownContent` whose origin is loopback (`http(s)://` with hostname in `{localhost, 127.0.0.1, ::1}`, any port) SHALL, on a plain primary-button click (left mouse button, no `meta`/`ctrl`/`shift`/`alt` modifier), open in the internal `live-server` split viewer by opening a `live-server` viewer tab (`path="live:<url>"`) and expanding the split — rather than navigating or opening a system-browser tab. The client SHALL call `preventDefault()` for that click. The full URL — including `pathname` and `search` — SHALL be carried to the viewer, not reduced to the origin. Opening the same loopback URL twice SHALL activate the existing tab, not duplicate it.

Loopback classification MUST reuse the shared `isLoopbackUrl` helper (backed by `LOOPBACK_HOSTS`). A URL that merely embeds `localhost` in credentials or path (e.g. `http://localhost@evil.com/`, `http://evil.com/localhost`) MUST NOT be classified as loopback.

#### Scenario: plain click on a loopback link opens the split viewer
- **GIVEN** a chat message rendering `http://localhost:50452/instructions-tree-resize.html`
- **WHEN** the user left-clicks the link with no modifier keys held
- **THEN** `preventDefault` SHALL be called
- **AND** a `live-server` viewer tab SHALL open with `path="live:http://localhost:50452/instructions-tree-resize.html"` and the split SHALL be expanded
- **AND** no system-browser tab SHALL open

#### Scenario: clicking the same loopback link twice reuses one tab
- **GIVEN** a `live-server` tab already open for `http://localhost:50452/x.html`
- **WHEN** the user plain-clicks another link to the same URL
- **THEN** the existing tab SHALL be activated
- **AND** no duplicate tab SHALL be created

#### Scenario: deep path and query preserved
- **GIVEN** a chat message rendering `http://localhost:5173/app?tab=preview`
- **WHEN** the user left-clicks the link with no modifiers
- **THEN** the target opened in the viewer SHALL retain the path `/app` and query `?tab=preview`

#### Scenario: credentialed non-loopback host is not loopback
- **GIVEN** a chat message rendering `http://localhost@evil.com/`
- **WHEN** the user left-clicks the link
- **THEN** the link SHALL NOT open in the split viewer
- **AND** the anchor SHALL keep its existing external-link behavior (`target="_blank"`)

### Requirement: Modifier-click and middle-click on loopback links escape to the system browser

A loopback anchor click with any of `meta`, `ctrl`, `shift`, or `alt` held, OR a non-primary mouse button (e.g. middle-click), SHALL NOT be intercepted: `preventDefault` is not called and the native anchor (`target="_blank"`) opens the URL in a system-browser tab, exactly as today.

#### Scenario: cmd/ctrl-click opens a browser tab
- **GIVEN** a chat message rendering `http://localhost:50452/x.html`
- **WHEN** the user clicks the link with the meta (or ctrl) key held
- **THEN** `preventDefault` SHALL NOT be called
- **AND** the split viewer SHALL NOT open

#### Scenario: middle-click opens a browser tab
- **GIVEN** a chat message rendering `http://localhost:50452/x.html`
- **WHEN** the user middle-clicks the link
- **THEN** the split viewer SHALL NOT open

### Requirement: Non-loopback and non-URL anchors are unchanged

External (non-loopback) URLs, same-origin links, and fragment (`#…`) links rendered by `MarkdownContent` SHALL retain their current behavior. Only loopback URLs gain split-viewer routing.

#### Scenario: external link unchanged
- **GIVEN** a chat message rendering `https://example.com/docs`
- **WHEN** the user left-clicks the link
- **THEN** it SHALL open with `target="_blank"` as today, and the split viewer SHALL NOT open

#### Scenario: fragment link unchanged
- **GIVEN** a chat message rendering a `#section` fragment link
- **WHEN** the user clicks it
- **THEN** it SHALL scroll in-document as today, and the split viewer SHALL NOT open
