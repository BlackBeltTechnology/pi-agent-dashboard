# Spec Delta

## ADDED Requirements

### Requirement: External markdown anchors open in the editor pane

A markdown anchor in the chat transcript of the session the editor pane belongs to, whose `href` is a non-loopback http(s) URL, SHALL on a plain primary-button click open that URL in a web tab of that pane instead of a browser tab. On any other surface it SHALL open with `target="_blank"` as before.

#### Scenario: plain click on an external anchor
- **GIVEN** a chat message rendering `[docs](https://example.com/docs)`
- **WHEN** the user left-clicks the link with no modifiers
- **THEN** a web tab for `https://example.com/docs` SHALL open in the editor pane and no browser tab SHALL open

#### Scenario: other surface
- **GIVEN** the same anchor rendered in a README dialog or a markdown file preview
- **WHEN** the user left-clicks it
- **THEN** it SHALL open with `target="_blank"`

### Requirement: Modifier-click on any web anchor escapes to the browser

A click on any http(s) markdown anchor with `meta`, `ctrl`, `shift` or `alt` held, or with a non-primary mouse button, SHALL NOT be intercepted, and the native `target="_blank"` SHALL open the URL.

#### Scenario: ctrl-click on an external anchor
- **GIVEN** a chat message rendering `[docs](https://example.com/docs)`
- **WHEN** the user ctrl-clicks it
- **THEN** no editor-pane tab SHALL open and the browser SHALL open the URL

### Requirement: Relative markdown anchors open as file links

A markdown anchor with a relative `href` (no scheme, not starting with `#`, `/` or `//`) SHALL act as a file link based on the previewed document's directory in a file preview, else on the chat session cwd. It is percent-decoded with the query dropped; `#L<n>` is the line and other fragments are ignored. It uses file-link routing and the containment gate and MUST NOT navigate the dashboard page. With no base it SHALL keep its previous behaviour.

#### Scenario: relative doc link in chat
- **GIVEN** a chat message rendering `[guide](docs/guide.md)` in a session whose cwd contains `docs/guide.md`
- **WHEN** the user clicks it
- **THEN** `docs/guide.md` SHALL open in the editor pane and the dashboard URL SHALL NOT change

#### Scenario: relative link in a markdown file preview
- **GIVEN** the editor pane previewing `docs/a/readme.md` containing `[next](../b/next.md)`
- **WHEN** the user clicks it
- **THEN** `docs/b/next.md` SHALL open

#### Scenario: relative link with a line anchor
- **GIVEN** a chat message rendering `[here](src/a.ts#L12)`
- **WHEN** the user clicks it
- **THEN** `src/a.ts` SHALL open scrolled to line 12

#### Scenario: relative link with a section fragment
- **GIVEN** a chat message rendering `[setup](docs/guide.md#setup)`
- **WHEN** the user clicks it
- **THEN** `docs/guide.md` SHALL open

#### Scenario: root-relative href is not a file link
- **GIVEN** a chat message rendering `[settings](/settings/access)`
- **WHEN** it renders
- **THEN** it SHALL NOT be treated as a file link

#### Scenario: no base known
- **GIVEN** a relative anchor rendered where neither a document directory nor a session cwd is known
- **WHEN** it renders
- **THEN** it SHALL render as it did before this change

### Requirement: Markdown web anchors show the provider icon

In the dashboard's chat transcript, a markdown anchor with an http(s) `href` SHALL show the provider icon from link-provider-recognition before its text. The author's link text SHALL be kept; only an autolink whose text equals its URL SHALL be replaced by the short label. Anchors on other surfaces are unchanged.

#### Scenario: authored anchor text kept
- **GIVEN** `[the fix](https://github.com/org/repo/pull/123)`
- **WHEN** it renders
- **THEN** it SHALL show the GitHub icon followed by `the fix`

#### Scenario: autolink shortened
- **GIVEN** `<https://github.com/org/repo/pull/123>`
- **WHEN** it renders
- **THEN** it SHALL show the GitHub icon followed by `org/repo#123`

### Requirement: Fragment, root-relative and non-web anchors are unchanged

A markdown anchor whose `href` starts with `#`, `/` or `//`, or uses a scheme other than http(s) (for example `mailto:`), SHALL behave exactly as before this change and SHALL NOT open the editor pane or be treated as a file link.

#### Scenario: mailto unchanged
- **GIVEN** a chat message rendering `[mail](mailto:a@example.com)`
- **WHEN** the user clicks it
- **THEN** it SHALL behave as before and the editor pane SHALL NOT open

#### Scenario: fragment link unchanged
- **GIVEN** a chat message rendering a `#section` fragment link
- **WHEN** the user clicks it
- **THEN** it SHALL scroll in-document as today, and the split viewer SHALL NOT open

## MODIFIED Requirements

### Requirement: Loopback URLs in chat markdown open in the internal split viewer

A URL rendered as an anchor by `MarkdownContent` whose origin is loopback (`http(s)://` with hostname in `{localhost, 127.0.0.1, ::1}`, any port) SHALL, when a split workspace is present, on a plain primary-button click (left mouse button, no `meta`/`ctrl`/`shift`/`alt` modifier), open in the internal `live-server` split viewer by opening a `live-server` viewer tab (`path="live:<url>"`) and expanding the split — rather than navigating or opening a system-browser tab. The client SHALL call `preventDefault()` for that click. The full URL — including `pathname` and `search` — SHALL be carried to the viewer, not reduced to the origin. Opening the same loopback URL twice SHALL activate the existing tab, not duplicate it.

Loopback classification MUST reuse the shared `isLoopbackUrl` helper (backed by `LOOPBACK_HOSTS`). A URL that merely embeds `localhost` in credentials or path (e.g. `http://localhost@evil.com/`, `http://evil.com/localhost`) MUST NOT be classified as loopback; it is routed as a non-loopback web link.

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
- **THEN** the link SHALL NOT open in the `live-server` split viewer
- **AND** it SHALL follow "External markdown anchors open in the editor pane", whose web tab never frames a non-https target

## REMOVED Requirements

### Requirement: Non-loopback and non-URL anchors are unchanged
**Reason**: External anchors now open in the editor pane and relative anchors now open as file links; only fragment anchors keep their old behaviour.
**Migration**: Covered by "External markdown anchors open in the editor pane", "Modifier-click on any web anchor escapes to the browser", "Relative markdown anchors open as file links" and "Fragment, root-relative and non-web anchors are unchanged".
