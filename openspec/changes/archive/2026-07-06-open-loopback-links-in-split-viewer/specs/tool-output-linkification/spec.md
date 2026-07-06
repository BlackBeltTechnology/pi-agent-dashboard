## ADDED Requirements

### Requirement: Loopback URLs in tool output open in the internal split viewer

A URL rendered by `UrlLink` (the anchor used by `LinkifiedText` / `GenericToolRenderer`, including the `serve_mockup` result card) whose origin is loopback (`http(s)://` with hostname in `{localhost, 127.0.0.1, ::1}`, any port) SHALL, on a plain primary-button click (left button, no `meta`/`ctrl`/`shift`/`alt`), open in the internal `live-server` split viewer by opening a `live-server` viewer tab (`path="live:<url>"`) and expanding the split, rather than opening a system-browser tab. The client SHALL call `preventDefault()` for that click and carry the full URL (`pathname` + `search`) to the viewer. This routing MUST use the same shared handler (`useLoopbackLinkOpen` → `SplitWorkspaceContext.openLiveTarget`) as `MarkdownContent` (no duplicated logic).

Non-loopback URLs — including the LAN URL that `serve_mockup` prints alongside the loopback URL — MUST keep their current `target="_blank"` behavior. Loopback classification MUST use the shared `isLoopbackUrl` helper.

#### Scenario: plain click on a loopback tool-output link opens the split viewer
- **GIVEN** a `serve_mockup` result card rendering `http://localhost:50452/board.html`
- **WHEN** the user left-clicks the loopback link with no modifiers
- **THEN** `preventDefault` SHALL be called
- **AND** the `live-server` split viewer SHALL open carrying `http://localhost:50452/board.html`

#### Scenario: the LAN URL stays a browser link
- **GIVEN** a `serve_mockup` result card that also prints a LAN URL `http://192.168.1.20:50452/board.html`
- **WHEN** the user left-clicks the LAN link
- **THEN** the split viewer SHALL NOT open
- **AND** the anchor SHALL open with `target="_blank"` as today

#### Scenario: modifier-click on a loopback tool-output link escapes to the browser
- **GIVEN** a tool-output loopback link
- **WHEN** the user clicks it with meta/ctrl held (or middle-clicks)
- **THEN** `preventDefault` SHALL NOT be called and the split viewer SHALL NOT open

#### Scenario: no split-workspace context falls back to the browser
- **GIVEN** `UrlLink` rendered outside a `SplitWorkspaceProvider` (so `useOptionalSplitWorkspace()` returns `null`)
- **WHEN** the user left-clicks a loopback link
- **THEN** the shared handler SHALL be a no-op (no crash, no throw)
- **AND** the native anchor `target="_blank"` SHALL open the URL
