# Spec Delta

## MODIFIED Requirements

### Requirement: Pane SHALL open at a per-session route

The dashboard SHALL expose a route `/session/:id/editor?file=<relPath>&line=<n>&url=<url>` that renders the internal editor pane for the named session. The pane SHALL be mountable **inside the chat + editor split** (co-existing with `ChatView`), not only as a full-screen replacement of `ChatView`. Entering the route SHALL open the split (via the `openInSplit` helper) and render the pane alongside `ChatView`. The route SHALL be parseable from inbound URLs (browser back/forward, copied URLs) and SHALL restore the pane state from `localStorage` on mount.

When the route is entered with a `file` query parameter, the named file SHALL be opened in a new (or existing if already open) tab and that tab SHALL become active. When `line` is provided, the active viewer SHALL scroll to that line (1-indexed).

When the route is entered with a `url` query parameter, the URL SHALL be opened in a new or existing URL tab via `openUrlTarget`, except a loopback URL (`isLoopbackUrl`) which SHALL open via `openLiveTarget` (the SSRF-gated live-server viewer). `SplitRouteSync` SHALL perform this bridge, mirroring the `file` → `openInSplit` path. `file` and `url` are intended mutually exclusive; when a route carries BOTH, `file` SHALL win and `url` SHALL be ignored (no error surface).

A close/unsplit affordance SHALL exist at the right end of the pane bar (see `editor-pane-chrome`). Activating it SHALL close the split (returning the content area to `ChatView`) without destroying the persisted pane state.

#### Scenario: Route opens the pane inside the split

- **GIVEN** a session `abc123` whose cwd is `/Users/u/proj`
- **WHEN** the user navigates to `/session/abc123/editor?file=src/foo.ts&line=42`
- **THEN** the split opens and the editor pane renders alongside `ChatView`
- **AND** `src/foo.ts` is open in an active tab, scrolled so line 42 is visible

#### Scenario: URL param opens a URL tab

- **WHEN** the user navigates to `/session/abc123/editor?url=https%3A%2F%2Fexample.com%2Fdoc.pdf`
- **THEN** `SplitRouteSync` opens a URL tab via `openUrlTarget` rendering the PDF through the shared preview renderer
- **AND** a copied version of this URL reopens the same tab on reload

#### Scenario: file param wins when both are present

- **WHEN** the user navigates to `/session/abc123/editor?file=a.ts&url=https%3A%2F%2Fx`
- **THEN** `a.ts` opens in a file tab
- **AND** no URL tab is opened (`url` is ignored)

#### Scenario: Close affordance unsplits without destroying pane state

- **GIVEN** the pane is open in the split with three tabs
- **WHEN** the user activates the close/unsplit affordance in the pane bar
- **THEN** the content area renders `ChatView` alone
- **AND** the three tabs remain in `localStorage`

### Requirement: Pane SHALL host a collapsible file-tree rail

The pane SHALL render a file-tree browse rail on the left, rooted at the session's
`cwd`, collapsible via a **labelled, discoverable toggle at the left end of the pane bar, directly above
the rail** (not a bare unlabelled icon buried among other actions). The toggle SHALL keep its text
label at every pane width. Rail visibility SHALL persist
per session. In the **absence of a persisted preference** for a session, the rail SHALL
default to **collapsed** so the opened viewer fills the pane width; a user's explicit
toggle SHALL persist per session and override the collapsed default on subsequent opens
(the rail SHALL NOT re-collapse each time the split reopens once the user has revealed
it for that session).

The rail SHALL list a directory's entries from a **single tree-listing source of truth**
returning `{ name: string; isDir: boolean }` per entry, so **hidden directories
(`.`-prefixed, e.g. `.git`, `.pi`) render and expand as folders** — never as files. The
rail SHALL NOT infer directory-ness by intersecting a full name list with a
hidden-stripped directory list.

Each row SHALL show a **per-kind mime icon** derived from the shared `fileKind`
classifier (distinct icon/colour for code, json, markdown, pdf, image, video, audio,
mermaid, folder, hidden-folder). Clicking a file SHALL invoke the file-open path with
the classifier's viewer kind; clicking a directory SHALL expand/collapse it.

#### Scenario: Hidden directory renders and expands as a folder
- **GIVEN** a session cwd containing `.git/` and `.pi/`
- **WHEN** the rail lists the cwd
- **THEN** `.git` and `.pi` render as folders with an expand chevron
- **AND** clicking one expands to show its child entries
- **AND** neither is treated as a file / passed to `openFile`

#### Scenario: Rows show per-kind icons
- **WHEN** the rail lists `index.ts`, `config.json`, `logo.png`, `demo.mp4`, `chime.mp3`, `arch.mmd`, `spec.pdf`
- **THEN** each row shows a distinct mime icon derived from `fileKind`

#### Scenario: Rail toggle is labelled and persistent
- **WHEN** the user collapses the rail via the labelled toggle
- **THEN** the rail hides and the viewer fills the freed width
- **AND** the collapsed state persists across reload

#### Scenario: Rail defaults to collapsed with no persisted preference
- **GIVEN** a session with no persisted rail-visibility preference
- **WHEN** the split content viewer opens (e.g. via `openInSplit`)
- **THEN** the Files rail SHALL be collapsed and the viewer SHALL fill the pane width
- **AND** the labelled `[Files]` toggle SHALL remain present so the rail can be revealed

#### Scenario: Revealed rail stays revealed for the session
- **GIVEN** a session whose split viewer opened with the rail collapsed by default
- **WHEN** the user reveals the rail via the `[Files]` toggle
- **THEN** the revealed state SHALL persist for that session across reload
- **AND** reopening the split for that session SHALL NOT re-collapse the rail

### Requirement: Pane SHALL be read-only in v1

The Monaco editor SHALL be configured with `readOnly: true`. The pane SHALL display no save button, no dirty indicator, and no affordance for creating new files in v1 (the pane bar's New tab control opens terminals, live previews and existing files only), except within the Preview/Edit tabs and plugin file-handler modes described below.

The shared `fileKind` classifier SHALL return `editable: false` for every file EXCEPT the editable text kinds — the writable markdown subset (`.md`/`.mdx`), `.csv`, and AsciiDoc (`.adoc`/`.asciidoc`) — which return `editable: true`.

Only these expose a save path:
- the Preview/Edit tabs of the editable text kinds (see "Markdown tabs SHALL offer a Preview/Edit toggle");
- edit modes contributed by enabled file-handler plugins (see the `editor-pane-file-handlers` capability), which save only through the core handler save path.

All other viewers (Monaco text/code, media, pdf, html, every built-in preview) remain read-only.

When the agent edits a file that the user has open, the pane SHALL NOT auto-refresh. A manual Reload control in the document bar (see `editor-pane-chrome`) SHALL re-fetch the active file's content from `/api/file`. On a tab showing a plugin file-handler mode, manual refresh SHALL instead reload the handler from a fresh read of the file, asking for confirmation first when the handler has unsaved edits or an unknown saved state. (Auto-refresh on agent edits is deferred to v4.)

#### Scenario: Read-only editor rejects keystrokes
- **GIVEN** the pane has `foo.ts` open in a Monaco tab
- **WHEN** the user types into the editor area
- **THEN** the buffer content is unchanged
- **AND** no `POST /api/file/write` request is issued

#### Scenario: Manual refresh re-fetches active file
- **GIVEN** `foo.ts` is open in the pane
- **AND** the agent has just written new content to `foo.ts` via the Edit tool
- **WHEN** the user clicks Reload in the document bar
- **THEN** the pane issues `GET /api/file?cwd=<cwd>&path=foo.ts`
- **AND** the Monaco buffer updates to the new content
- **AND** the refresh is performed without closing or reopening the tab

#### Scenario: Manual refresh on a handler tab with unsaved edits
- **GIVEN** `report.docx` is open in a plugin edit mode holding unsaved edits
- **WHEN** the user clicks Reload in the document bar
- **THEN** a confirmation is shown, and only after confirming does the handler reload from the file on disk

#### Scenario: Built-in Office preview stays read-only
- **GIVEN** `report.docx` is open in its built-in preview
- **THEN** no save button or dirty indicator is shown

### Requirement: Editor-pane tabs SHALL offer system-open actions gated to a local server

Each editor-pane tab SHALL offer system-open actions in the pane's document bar (see `editor-pane-chrome`).

A **file** tab SHALL offer:
- **Open in default app**;
- a **Reveal** action labelled for the **server host's** platform as reported by `/api/health` (`platform`): "Reveal in Finder" for `darwin`, "Show in Explorer" for `win32`, "Reveal in file manager" otherwise or when the platform is unknown.

A **url** tab SHALL offer *Open in system browser*.

The two **file** actions SHALL be shown only when the server advertises `capabilities.systemOpen === true` on `/api/health`.
- The server computes this value at startup. It is true only for a desktop-capable host (an OS opener plus a display session), and false when headless, containerized or remote.
- A browser-side loopback check SHALL NOT be used as the gate. It is wrong for the Docker forwarded-port case, where the browser origin is `localhost:PORT` but the server runs in a headless container.
- When `capabilities.systemOpen` is false, the file actions SHALL be hidden, including from the document bar's More menu.

The **url** action SHALL be unconditional.

The file actions SHALL dispatch to `POST /api/open-in-system` and `POST /api/reveal-in-file-manager`.
- Each takes `{ cwd, path }` and spawns the OS opener on the server host: macOS `open` / `open -R`; Linux `xdg-open` / freedesktop reveal; Windows `start` / `explorer /select,`.
- The opener SHALL be invoked via `execFile`/`spawn` with an **argument array**, never a shell string, so a path containing a comma, space, quote or newline cannot inject (notably the `explorer /select,<path>` argument).
- Both endpoints SHALL contain the resolved path through the shared file-route containment gate defined by the `file-read-containment` capability.
- Both endpoints SHALL refuse when `capabilities.systemOpen` is false.
- Both endpoints SHALL reject a request whose Origin/Host is not loopback. An absent Origin/Host SHALL be treated as non-loopback and rejected.
- Neither endpoint SHALL read or stream the file content.
- *Reveal* SHALL select the file without executing it.

The **url** action SHALL open the URL in a new system-browser window or tab (Electron hands it to the OS browser, subject to the shell's external-link scheme allowlist) and SHALL issue no `/api` request.

#### Scenario: File actions shown when the server is desktop-capable

- **GIVEN** `/api/health` reports `capabilities.systemOpen === true`
- **WHEN** a file tab is active
- **THEN** *Open in default app* and the platform-labelled *Reveal* action are available in the document bar

#### Scenario: Reveal label follows the platform

- **GIVEN** a desktop-capable server whose `/api/health` reports `platform: "darwin"`
- **WHEN** a file tab is active
- **THEN** the Reveal action is labelled "Reveal in Finder", whatever the browser's own platform

#### Scenario: File actions hidden when the server is headless/remote

- **GIVEN** `/api/health` reports `capabilities.systemOpen === false` (headless Docker image, or remote)
- **WHEN** a file tab is active
- **THEN** the two file actions are NOT shown
- **AND** the URL action remains available on url tabs

#### Scenario: Endpoint refuses when systemOpen is false

- **GIVEN** a server whose `capabilities.systemOpen` is false
- **WHEN** `/api/open-in-system` is called anyway
- **THEN** it is refused without spawning an opener

#### Scenario: Reveal is path-contained

- **WHEN** a client posts `/api/reveal-in-file-manager` with `path` resolving outside every containment anchor of `file-read-containment` (e.g. `../../../etc/passwd`)
- **THEN** the server responds 403 and spawns no opener

#### Scenario: Endpoint rejects a non-loopback or absent origin

- **GIVEN** a request to `/api/open-in-system` whose Origin/Host is non-loopback OR absent
- **WHEN** the server handles it
- **THEN** it is rejected without spawning an opener (defense-in-depth beyond the UI gate)

#### Scenario: Reveal argument is not shell-interpolated

- **GIVEN** a contained path containing a comma or space
- **WHEN** *Reveal* spawns the opener
- **THEN** the path is passed as a single `execFile` argument (no shell), so it cannot break `explorer /select,` or inject

#### Scenario: Open URL in system browser works remotely

- **GIVEN** a url tab in a remote browser session
- **WHEN** the user activates *Open in system browser*
- **THEN** the URL opens in the user's own browser (no server round-trip)
