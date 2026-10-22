# internal-monaco-editor-pane Specification

## Purpose
TBD - created by archiving change add-internal-monaco-editor-pane. Update Purpose after archive.

## Requirements

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

### Requirement: Pane SHALL host multi-file tabs

The pane SHALL display a horizontal tab list of open files. Exactly one tab SHALL be active at any time. Opening a file that is already open SHALL activate its existing tab rather than creating a duplicate.

The tab list SHALL support:

- click to activate,
- middle-click or "×" to close,
- `Ctrl/Cmd-W` keyboard shortcut to close the active tab,
- drag to reorder.

Closing the last tab SHALL leave the pane in an empty state with a "no files open — pick one from the tree" message. The pane SHALL NOT navigate back to chat on last-tab-close.

#### Scenario: Opening an already-open file activates its tab
- **GIVEN** the pane has `a.ts` (index 0, active) and `b.ts` (index 1) open
- **WHEN** the user triggers `openFile("a.ts")` from the file tree
- **THEN** the tab list still has exactly two tabs
- **AND** `a.ts` (index 0) is the active tab
- **AND** no duplicate is created

#### Scenario: Closing the active tab activates the next adjacent tab
- **GIVEN** tabs `a.ts`, `b.ts`, `c.ts` with `b.ts` active
- **WHEN** the user closes `b.ts`
- **THEN** `c.ts` becomes active
- **AND** the tab list contains `a.ts`, `c.ts`

#### Scenario: Closing the last tab leaves the pane in empty state
- **GIVEN** a single tab `a.ts` is open and active
- **WHEN** the user closes `a.ts`
- **THEN** the pane displays an empty-state message
- **AND** the pane remains on the `/session/:id/editor` route
- **AND** the tree rail remains visible

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

### Requirement: Pane SHALL dispatch viewers via a kind-based registry

The pane SHALL dispatch the active tab to a viewer via a kind-based registry. The registry SHALL cover: `monaco` (text/code), `markdown`, `image`, `pdf`, `html`, `video`, `audio`, `mermaid`, `docx`, `pptx`, `spreadsheet`, `asciidoc`, `email`, and `binary-warn`. Where a shared `preview/*` renderer exists for a kind, the registry entry SHALL delegate to it rather than a pane-local duplicate:

- `pdf` → `PdfPreview`; `html` → `HtmlPreview` (sandboxed, scripts disabled);
  `image` → `ImagePreview`; `video` → `VideoPreview`; `audio` → `AudioPreview`;
  `mermaid` → `MermaidBlock`.
- `docx` → `DocxPreview`; `pptx` → `PptxPreview`; `spreadsheet` →
  `SpreadsheetPreview`; `asciidoc` → `AsciiDocPreview`; `email` → `EmlPreview`.
  Each reuses the existing shared renderer with its established sandbox /
  remote-content posture; no new preview logic and no new bytes path.

`fileKind` SHALL classify `.html`/`.htm` → html, `.mmd`/`.mermaid` → mermaid, `.mp3`/`.wav`/`.ogg`/`.m4a`/`.flac` → audio, `.webm`/`.mov` → video, `.docx` → docx, `.pptx` → pptx, `.xlsx`/`.xls`/`.csv` → spreadsheet, `.adoc`/`.asciidoc` → asciidoc, and `.eml` → email. The `line` scroll target SHALL be passed only to the `monaco` viewer.

The registry governs the tab's built-in view. When a plugin file-handler mode is selected for a tab, the handler renders instead and the tab's registry viewer SHALL NOT be mounted, so it fetches nothing.

#### Scenario: Office and email kinds dispatch to shared renderers

- **WHEN** the user opens `.docx`, `.pptx`, `.xlsx`, `.adoc`, or `.eml` tabs
- **THEN** they render `DocxPreview`, `PptxPreview`, `SpreadsheetPreview`, `AsciiDocPreview`, and `EmlPreview` respectively
- **AND** none renders as raw text in Monaco

#### Scenario: PDF renders via pdfjs, not a native plugin

- **GIVEN** the pane runs inside the Electron shell (no PDF plugin)
- **WHEN** the user opens a `.pdf` tab
- **THEN** the tab renders `PdfPreview` as a continuous-scroll pdfjs viewer (text-selectable, find-capable), not a Prev/Next paged canvas

#### Scenario: Handler mode replaces the registry viewer

- **GIVEN** an enabled plugin claims `.docx` and `report.docx` is open
- **WHEN** the user selects the plugin's mode
- **THEN** `DocxPreview` is not mounted and no preview request for `report.docx` is made

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

### Requirement: Pane state SHALL persist per session in localStorage

Open tabs, active tab index, and expanded tree directories SHALL persist in `localStorage` under key `pi-dashboard:editor-pane:<sessionId>`. State SHALL be restored on page reload, on dashboard restart, and on re-entry to the route within the same browser profile.

State persistence SHALL be best-effort: quota errors and corrupt JSON SHALL NOT crash the pane; failures SHALL be logged and the in-memory state SHALL continue to function.

State SHALL be scoped per session id — switching sessions SHALL load that session's distinct pane state.

#### Scenario: Reload restores open tabs
- **GIVEN** the pane has `a.ts` and `b.ts` open with `b.ts` active
- **WHEN** the user reloads the browser page
- **AND** re-navigates to `/session/:id/editor`
- **THEN** the tab list shows `a.ts` and `b.ts`
- **AND** `b.ts` is the active tab

#### Scenario: Dashboard restart preserves pane state
- **GIVEN** the pane has three tabs open
- **WHEN** the dashboard server restarts via `POST /api/restart`
- **AND** the client reconnects
- **THEN** the three tabs are still rendered without re-opening
- **AND** the active tab is unchanged

#### Scenario: Corrupt localStorage value does not crash the pane
- **GIVEN** `localStorage.getItem("pi-dashboard:editor-pane:abc123")` returns malformed JSON
- **WHEN** the user opens the pane for session `abc123`
- **THEN** the pane renders with an empty state (no tabs)
- **AND** an error is logged to the console
- **AND** the pane functions normally on subsequent state changes

### Requirement: Monaco bundle SHALL be lazy-loaded with a curated language allowlist

The Monaco editor and its language workers SHALL be packaged as a Vite-split lazy chunk loaded only on first text-file open. Sessions whose pane never opens a Monaco-rendered file SHALL NOT trigger the Monaco chunk to load.

The bundled language set SHALL be curated to: TypeScript, JavaScript, JSON, Markdown, Python, Go, Rust, YAML, HTML, CSS, SQL, Shell (a baseline allowlist). Other languages SHALL fall back to plain-text rendering in Monaco without their dedicated worker.

The lazy chunk gzipped size SHALL be ≤ 2 MB (warn budget) and SHALL be ≤ 3 MB (hard fail in CI).

#### Scenario: Pane open without text files does not load Monaco
- **GIVEN** a session whose pane only opens an image file
- **WHEN** the pane renders the image tab
- **THEN** no network request for the Monaco chunk is issued
- **AND** the `MonacoBuffer` lazy boundary remains unresolved

#### Scenario: First text-file open triggers Monaco chunk fetch
- **GIVEN** the pane is open with no text tabs
- **WHEN** the user opens `src/foo.ts`
- **THEN** the dashboard fetches the Monaco chunk
- **AND** displays a loading skeleton until the chunk resolves
- **AND** then renders the Monaco editor

### Requirement: Server SHALL extend `/api/file` and add `/api/file/raw`

`GET /api/file?cwd=<cwd>&path=<relPath>` SHALL return `{ type: "file", kind, mimeType, size, mtime, content? }` for file entries. `content` SHALL be present when the classified `viewer ∈ { "monaco", "markdown" }` OR when `editable === true` (so an editable non-markdown tab such as `.csv` or `.adoc` can load its text into Monaco). `content` SHALL be omitted for all other kinds, including `image`, `pdf`, `binary`, `docx`, `pptx`, `xlsx` spreadsheets, and `email`.

`mtime` SHALL be the file's modification time in milliseconds at full filesystem precision (not rounded or truncated). It is the optimistic-concurrency token for `POST /api/file/write`. Echoing it back unchanged for an unmodified file SHALL pass the write-side conflict check.

`GET /api/file/raw?cwd=<cwd>&path=<relPath>` SHALL stream raw file bytes with the resolved `Content-Type` header. Both endpoints SHALL apply the existing security gates: `cwd` admitted by the shared cwd admission guard (`core-cwd-admission`: a known folder — session cwd, pinned directory or workspace folder — or a subdirectory / linked worktree whose main checkout is a known folder); the resolved path SHALL lie inside the containment anchors of `file-read-containment` (path-traversal prevention).

The file-kind discrimination SHALL invoke the shared `fileKind` module with the first 1024 bytes of the file as the `sniff` argument; the server SHALL NOT read the full file just to classify.

#### Scenario: Editable CSV returns content

- **WHEN** `GET /api/file?cwd=/Users/u/proj&path=data.csv` succeeds
- **THEN** the response includes `content` (`editable === true`), `kind: "spreadsheet"`

#### Scenario: Binary spreadsheet omits content

- **WHEN** `GET /api/file?cwd=/Users/u/proj&path=book.xlsx` succeeds
- **THEN** the response does NOT include `content` (`editable === false`)

#### Scenario: Office/email omit content

- **WHEN** `GET /api/file?cwd=/Users/u/proj&path=report.docx` (or `mail.eml`) succeeds
- **THEN** the response does NOT include `content`
- **AND** the client renders it via the rich viewer, not Monaco raw text

#### Scenario: Editable AsciiDoc returns content

- **WHEN** `GET /api/file?cwd=/Users/u/proj&path=guide.adoc` succeeds
- **THEN** the response includes `content` (`editable === true`), `kind: "asciidoc"`

#### Scenario: Fractional mtime round-trips through save

- **GIVEN** an editable `.md` file whose on-disk mtime has a sub-millisecond fraction (e.g. `1700000000000.5`)
- **WHEN** the client loads it via `GET /api/file` and POSTs `/api/file/write` with the returned `mtime` and new content, with no intervening disk change
- **THEN** the server responds `200` and the file holds the new content

#### Scenario: Genuine external change still conflicts

- **GIVEN** a file loaded via `GET /api/file` at token T
- **WHEN** the file is modified on disk and the client POSTs `/api/file/write` with T
- **THEN** the server responds `409` and the file is left untouched

### Requirement: Shared `fileKind` classifier SHALL be the single source of viewer discrimination

The pure module `packages/shared/src/file-kind.ts` SHALL export `fileKind(absPath: string, sniff?: Buffer | string): { kind, mimeType, viewer, editable }`. Both server (`/api/file`, `/api/file/raw`) and client (`OpenFileButton`, `EditorFileTree`) SHALL use this function — no separate discrimination logic SHALL exist elsewhere.

The function SHALL be pure: same inputs always produce the same output; no I/O. Sniff is optional; when absent the function SHALL classify by extension only. The office/asciidoc/email kinds SHALL classify by extension only and SHALL NOT depend on `sniff`.

The `viewer` field SHALL take a value in the `ViewerKind` union including `docx`, `pptx`, `spreadsheet`, `asciidoc`, and `email`. The `editable` field SHALL be `true` for `.md`/`.mdx` and for `.csv` (spreadsheet source is editable as text); it SHALL be `false` for all other kinds, including `.xlsx`/`.xls`, `.docx`, `.pptx`, `.adoc`, and `.eml`.

#### Scenario: Office extensions classify identically on both ends

- **GIVEN** the path `/abs/cwd/report.docx`
- **WHEN** both server and client invoke `fileKind` with that path
- **THEN** both return `{ kind: "docx", viewer: "docx", editable: false }` and matching `mimeType`

#### Scenario: `.csv` is an editable spreadsheet, `.xlsx` is not

- **WHEN** `fileKind` classifies `data.csv` and `book.xlsx`
- **THEN** `data.csv` → `{ kind: "spreadsheet", viewer: "spreadsheet", editable: true }`
- **AND** `book.xlsx` → `{ kind: "spreadsheet", viewer: "spreadsheet", editable: false }`

#### Scenario: Extension-only, sniff-independent for rich kinds

- **GIVEN** a `.eml` path with arbitrary `sniff` bytes
- **WHEN** `fileKind` classifies it
- **THEN** the result is `{ kind: "email", viewer: "email", editable: false }` regardless of `sniff`

### Requirement: Pane SHALL surface a changed-on-disk banner for open files

The server SHALL watch the files currently open in a session's editor pane and emit a
`file_changed` signal each time an open file's watch fires (e.g. an agent edit or an
external change). Each signal is a **candidate** only. Before a file tab's viewer
mounts (open, tab activation, Refresh) the session-scoped pane SHALL record a content
**baseline** for that file (its digest at that moment). On every candidate for an open
tab the pane SHALL compare the file's current digest with the baseline and SHALL
display the per-tab banner stating the file changed on disk, offering a **Refresh**
action, ONLY when the current content differs from the baseline, the file no longer
exists, the digest is refused or fails, or the file exceeds the digest ceiling (no
hash). When the current digest equals the baseline the pane SHALL drop that candidate
and SHALL clear any banner already shown for that path. A candidate that arrives while an earlier verification of the
same path is running SHALL be verified again; a verification whose baseline changed
while it ran (Refresh, remount, own save) SHALL be discarded and re-run against the new
baseline.

The pane SHALL NOT auto-reload the buffer (preserving the read-only-v1
no-auto-refresh decision); Refresh SHALL re-fetch via the existing manual-refresh path,
SHALL reset the tab's baseline, and SHALL clear the banner. Dismissing the banner SHALL
clear it, SHALL leave the cached (stale) view in place, and SHALL NOT change the
baseline.

Shortly after a newly opened tab's baseline is taken, the pane SHALL run one
verification without waiting for a candidate, so a change that lands before the
server watch is established is still detected.

A save performed from within the pane (the editable tabs' Save, and any in-pane
repair or apply-fix action that writes the open file) SHALL NOT display the banner when
the saved content is within the digest ceiling: after a successful save the tab's
baseline SHALL equal the saved content; a candidate that arrives, or a verification
that is running, while a save for that path is in flight SHALL be verified only after
the save settles (bounded: 60 s, after which it is verified against the current
baseline). A write from outside the pane (another dashboard surface, an agent, an external
editor) SHALL be treated as an external change. A save the server refused (`4xx` or `5xx` response) SHALL leave the
baseline unchanged. A save whose outcome is unknown (no response) or whose success
response carries no content hash SHALL clear the baseline, so the next candidate shows
the banner.

The folder-scoped pane (no session watch) SHALL NOT record baselines or request digests.

The watch SHALL be scoped to the pane's **open files only**, not the whole `cwd` tree,
and SHALL be created and torn down as tabs open and close, on session switch, and on
client disconnect, so no file descriptors leak. When an open file is replaced
atomically (written to a temporary file and renamed over the original) or deleted and
re-created shortly after, the watch SHALL keep signalling later changes to that path.

#### Scenario: Agent edit to an open file shows the banner
- **GIVEN** `foo.ts` is open in the pane and unchanged on disk
- **WHEN** the agent writes new content to `foo.ts`
- **THEN** the pane displays a changed-on-disk banner on the `foo.ts` tab
- **AND** the buffer content is NOT auto-reloaded

#### Scenario: Identical-content rewrite does not show the banner
- **GIVEN** `foo.ts` is open in the pane
- **WHEN** a process rewrites `foo.ts` with byte-identical content
- **THEN** no changed-on-disk banner is shown

#### Scenario: Metadata-only touch does not show the banner
- **GIVEN** `foo.ts` is open in the pane
- **WHEN** `foo.ts` has its mtime or permissions changed without a content change
- **THEN** no changed-on-disk banner is shown

#### Scenario: Change then revert clears the banner
- **GIVEN** `foo.ts` is open and a different write raised the banner
- **WHEN** `foo.ts` is rewritten back to the exact bytes of the baseline
- **THEN** the changed-on-disk banner for `foo.ts` clears

#### Scenario: A second change during verification is not lost
- **GIVEN** `foo.ts` is open and a touch candidate is being verified
- **WHEN** the agent writes different content to `foo.ts` before that verification completes
- **THEN** the pane displays a changed-on-disk banner on the `foo.ts` tab

#### Scenario: Change racing the tab mount is not hidden
- **GIVEN** the user opens `foo.ts`
- **WHEN** `foo.ts` changes after its baseline is taken but before or after its viewer fetches content
- **THEN** the change never leaves a stale view without a banner (a banner may show even if the viewer already loaded the new bytes)

#### Scenario: Own save does not show the banner
- **GIVEN** `README.md` is open in an editable pane tab
- **WHEN** the user edits the buffer and saves successfully
- **THEN** no changed-on-disk banner is shown for `README.md`

#### Scenario: In-pane repair write does not show the banner
- **GIVEN** a markdown or mermaid file open in the pane
- **WHEN** the user applies an in-pane repair or AI fix that writes the file successfully
- **THEN** no changed-on-disk banner is shown for that file

#### Scenario: Change before the watch is established is detected
- **GIVEN** the user opens `foo.ts`
- **WHEN** `foo.ts` changes after its baseline is taken but before the server watch fires for it
- **THEN** the pane displays a changed-on-disk banner on the `foo.ts` tab

#### Scenario: Activating a changed background tab reloads it and clears the banner
- **GIVEN** `foo.ts` is open in a background tab and changed on disk
- **WHEN** the user activates the `foo.ts` tab
- **THEN** the viewer loads the current content
- **AND** no changed-on-disk banner is shown for that change

#### Scenario: Own save while a verification is running does not show the banner
- **GIVEN** a touch candidate for `README.md` is being verified
- **WHEN** the user saves `README.md` successfully before that verification completes
- **THEN** no changed-on-disk banner is shown for `README.md`

#### Scenario: Failed save keeps detecting external changes
- **GIVEN** `README.md` is open in an editable tab
- **WHEN** a save returns `409`
- **AND** the agent later writes different content to `README.md`
- **THEN** the pane displays a changed-on-disk banner on the `README.md` tab

#### Scenario: Change after an atomic replace is still signalled
- **GIVEN** `foo.ts` is open and was replaced via write-to-temp + rename
- **WHEN** the agent writes different content to `foo.ts`, including within 50 ms of the rename
- **THEN** the pane displays a changed-on-disk banner on the `foo.ts` tab

#### Scenario: Change after delete and re-create is still signalled
- **GIVEN** `foo.ts` is open
- **WHEN** `foo.ts` is deleted and re-created within 1 s
- **AND** the agent later writes different content to `foo.ts`
- **THEN** the pane displays a changed-on-disk banner on the `foo.ts` tab

#### Scenario: Reconnect re-establishes watches and catches up
- **GIVEN** `foo.ts` is open and the dashboard WebSocket disconnects
- **WHEN** `foo.ts` changes while disconnected and the WebSocket reconnects
- **THEN** the pane displays a changed-on-disk banner on the `foo.ts` tab
- **AND** a later change to `foo.ts` is still signalled

#### Scenario: Baselines are per session
- **GIVEN** sessions A and B with different `cwd` both have a tab for relative path `X`
- **WHEN** session A's `X` changes on disk
- **THEN** the change is verified against session A's baseline only

#### Scenario: Deleted open file shows the banner
- **GIVEN** `foo.ts` is open in the pane
- **WHEN** `foo.ts` is deleted on disk
- **THEN** the pane displays a changed-on-disk banner on the `foo.ts` tab

#### Scenario: File above the digest ceiling keeps today's banner
- **GIVEN** an open text file larger than the 256 MiB digest ceiling
- **WHEN** its watch fires
- **THEN** the pane displays a changed-on-disk banner (no content check is possible)

#### Scenario: Refresh re-fetches the changed file
- **GIVEN** the changed-on-disk banner is shown for `foo.ts`
- **WHEN** the user activates Refresh
- **THEN** the pane re-fetches `GET /api/file?cwd=<cwd>&path=foo.ts`
- **AND** the Monaco buffer updates to the new content
- **AND** the banner clears
- **AND** a later identical-content rewrite of `foo.ts` shows no banner

#### Scenario: Dismiss clears the banner and keeps the stale view
- **GIVEN** the changed-on-disk banner is shown for `foo.ts`
- **WHEN** the user activates Dismiss
- **THEN** the banner clears and the buffer still shows the earlier content

#### Scenario: Folder pane requests no digests
- **GIVEN** the folder-scoped editor pane with `foo.ts` open
- **WHEN** the tab mounts and `foo.ts` changes on disk
- **THEN** no `GET /api/file/digest` request is made and no banner is shown

#### Scenario: Closing a tab tears down its watch
- **GIVEN** `foo.ts` and `bar.ts` are open with active watches
- **WHEN** the user closes the `foo.ts` tab
- **THEN** the watch on `foo.ts` is torn down
- **AND** the watch on `bar.ts` remains active

#### Scenario: Change to a non-open file does not signal
- **GIVEN** only `foo.ts` is open in the pane
- **WHEN** an unrelated file `baz.ts` (not open) changes on disk
- **THEN** no changed-on-disk banner is shown

### Requirement: Pane viewers SHALL follow the dashboard theme live

Pane viewers with their own colour theme SHALL consume the shared theme via
`useThemeContext()` (the `ThemeProvider` value), NOT the raw per-instance `useTheme()`
hook — this applies to the `monaco` text/code viewer and the markdown editor. When the
dashboard named theme or light/dark mode changes, open editor viewers SHALL recolour
without remount.

#### Scenario: Monaco recolours on theme switch
- **GIVEN** a `.ts` file open in a Monaco tab in dark mode
- **WHEN** the dashboard is switched to light mode
- **THEN** the Monaco editor recolours to the light theme without reopening the tab

### Requirement: Tree and tabs SHALL stay in sync both directions

Opening a file (from tree click, chat file-link, or search result) SHALL auto-expand
every ancestor directory of the file in the rail and reveal + highlight its row.
Changing the active tab SHALL likewise reveal + highlight the corresponding tree row.
The highlight SHALL track the active tab's path.

#### Scenario: Opening a deep file reveals it in the tree
- **GIVEN** the rail is collapsed at the root
- **WHEN** the user opens `src/components/EditorPane.tsx` via a chat file-link
- **THEN** `src/` and `src/components/` expand
- **AND** the `EditorPane.tsx` row is highlighted and scrolled into view

#### Scenario: Switching tabs syncs the tree highlight
- **GIVEN** three tabs open from different directories
- **WHEN** the user activates a different tab
- **THEN** the tree highlight moves to that file's row and scrolls it into view

### Requirement: Markdown tabs SHALL offer a Preview/Edit toggle

An `editable` tab SHALL offer a per-tab **Preview / Edit** toggle.

| Kind | Preview | Edit |
|---|---|---|
| `.md`/`.mdx` | rendered markdown | the controlled `MarkdownEditor` |
| `.csv` | `SpreadsheetPreview` | a plain Monaco text buffer over the raw file text |
| AsciiDoc (`.adoc`/`.asciidoc`) | `AsciiDocPreview` | a plain Monaco text buffer over the raw file text |

The tab body below the toggle toolbar SHALL be the scroll container, since the editor pane supplies none. Saving SHALL `POST /api/file/write` with the buffer's loaded `mtime`; a `409` (changed on disk) SHALL surface the existing changed-on-disk banner and leave the file untouched.

Non-editable kinds (`.markdown`, `.xlsx`, `.docx`, `.eml`, …) SHALL have no built-in Edit affordance. Any edit mode they show SHALL come from an enabled file-handler plugin claim.

#### Scenario: Edit and save a markdown file

- **GIVEN** a `.md` file open in Preview mode
- **WHEN** the user switches to Edit, changes text, and clicks Save
- **THEN** the client POSTs `/api/file/write` with the loaded `mtime` and the dirty indicator clears on success

#### Scenario: CSV offers a spreadsheet Preview and a Monaco Edit

- **GIVEN** a `.csv` file open in the pane
- **WHEN** the tab renders
- **THEN** Preview shows the `SpreadsheetPreview` grid and an Edit toggle is available
- **WHEN** the user switches to Edit
- **THEN** a Monaco text buffer over the raw CSV is mounted, saved via `/api/file/write` with `mtime`

#### Scenario: AsciiDoc offers a rendered Preview and a Monaco Edit

- **GIVEN** an `.adoc` file open in the pane
- **WHEN** the tab renders
- **THEN** Preview shows the rendered AsciiDoc inside a scrollable body and an Edit toggle is available
- **WHEN** the user switches to Edit, changes text, and clicks Save
- **THEN** the raw source is saved via `/api/file/write` with `mtime`, and returning to Preview re-renders the saved file

#### Scenario: Non-editable kinds have no Edit affordance

- **WHEN** the user opens a `.xlsx`, `.docx`, or `.eml` file and no enabled plugin claims its extension
- **THEN** only Preview is available (no Edit toggle)

### Requirement: File-tree rows SHALL offer a copy-path popup

Each file-tree rail row (both files and directories) SHALL expose a **copy
affordance** that is hover-revealed: a copy glyph SHALL appear, flush-right on
the row, when the row is hovered or its popup is open, and SHALL be otherwise
visually unobtrusive.

Activating the copy glyph SHALL NOT open the file or expand/collapse the
directory (the glyph's activation SHALL stop propagation to the row). Activating
the glyph SHALL open a **popup menu anchored to the glyph** offering exactly
three actions:

- **Copy full path** — the row's absolute path (`cwd` joined with the row's
  path relative to `cwd`).
- **Copy relative path** — the row's path relative to the session `cwd`.
- **Copy file name** — the row's basename.

The popup SHALL display the target absolute path (truncated as needed) as a
header so the action target is unambiguous. When the popup would overflow the
rail's bottom edge, it SHALL render above the glyph instead of below.

Selecting an action SHALL copy the corresponding payload to the clipboard using
`navigator.clipboard.writeText()`, SHALL show a transient ✓ confirmation, and
SHALL then close the popup. When the Clipboard API is unavailable (e.g. a
non-secure context), the action SHALL fail silently without throwing, matching
the existing `CopyButton` behavior.

The popup SHALL be dismissable by clicking outside it, by scrolling the rail, and
by pressing Escape.

#### Scenario: Copy glyph is hover-revealed and does not open the file
- **GIVEN** a file-tree row for `src/foo.ts`
- **WHEN** the user hovers the row
- **THEN** a copy glyph appears flush-right on the row
- **WHEN** the user activates the copy glyph
- **THEN** the copy-path popup opens
- **AND** `onOpenFile` is NOT invoked for `src/foo.ts`

#### Scenario: Copy full path
- **GIVEN** a session whose cwd is `/Users/u/proj` and a row for `src/foo.ts`
- **WHEN** the user activates the copy glyph and selects **Copy full path**
- **THEN** `/Users/u/proj/src/foo.ts` SHALL be written to the clipboard
- **AND** a ✓ confirmation SHALL show and the popup SHALL close

#### Scenario: Copy relative path and file name
- **GIVEN** a session whose cwd is `/Users/u/proj` and a row for `src/foo.ts`
- **WHEN** the user selects **Copy relative path**
- **THEN** `src/foo.ts` SHALL be written to the clipboard
- **WHEN** the user selects **Copy file name**
- **THEN** `foo.ts` SHALL be written to the clipboard

#### Scenario: Directory rows offer the same copy actions
- **GIVEN** a directory row for `.git`
- **WHEN** the user activates its copy glyph and selects **Copy full path**
- **THEN** the directory's absolute path SHALL be copied
- **AND** the directory SHALL NOT expand or collapse

#### Scenario: Popup dismissal
- **GIVEN** an open copy-path popup
- **WHEN** the user clicks outside it, or scrolls the rail, or presses Escape
- **THEN** the popup SHALL close without copying anything

#### Scenario: Clipboard unavailable
- **GIVEN** a context where `navigator.clipboard` is undefined
- **WHEN** the user selects any copy action
- **THEN** the action SHALL fail silently without throwing

### Requirement: `/view` opens its target in the editor pane

The `/view` composer command SHALL open its target in the internal editor pane, not as an inline chat row. A file target SHALL navigate to `/session/:id/editor?file=<relPath>`; a URL target SHALL navigate to `/session/:id/editor?url=<url>`. The composer handler SHALL perform this via route navigation (it lives outside `SplitWorkspaceProvider` and does not call the openers directly).

#### Scenario: `/view @file` opens a file tab

- **GIVEN** a session `abc123` with `cwd = "/Users/u/proj"`
- **WHEN** the user runs `/view @src/foo.ts`
- **THEN** the app navigates to `/session/abc123/editor?file=src/foo.ts`
- **AND** the split opens with `src/foo.ts` in an active tab
- **AND** no inline `PreviewCard` is added to the transcript

#### Scenario: `/view <url>` opens a URL tab

- **GIVEN** a session `abc123`
- **WHEN** the user runs `/view https://youtu.be/x`
- **THEN** the app navigates to `/session/abc123/editor?url=https%3A%2F%2Fyoutu.be%2Fx`
- **AND** `UrlViewer` renders the URL via the shared `dispatchPreview → PreviewBody` (a YouTube embed here)

#### Scenario: loopback URL routes to the live-server viewer

- **GIVEN** a session `abc123`
- **WHEN** the user runs `/view http://localhost:5173`
- **THEN** `SplitRouteSync` detects `isLoopbackUrl` and opens the target via `openLiveTarget` (SSRF-gated `LiveServerViewer`), not `UrlViewer`

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

### Requirement: Oversized files SHALL fall back to a too-large notice

The editor pane SHALL gate rich viewers on the configured **editor large-file limit**
(`editor.largeFileLimitMb`, default 10 MiB, see the `settings-panel` capability). The
shared `MAX_PREVIEW_BYTES = 10 * 1024 * 1024` SHALL be the default when the setting is
absent or invalid. When an opened file's `size` (as reported by `/api/file`) exceeds the
limit, the viewer SHALL mount a `TooLargePreview` fallback (a short notice naming the
editor limit plus an **Open raw** affordance that streams `/api/file/raw`) INSTEAD of
the rich renderer (`MarkdownViewer`, `SpreadsheetPreview`, `DocxPreview`, `PdfPreview`,
`ImagePreview`, etc.). Monaco text tabs retain their existing large-file handling and
are not governed by this limit. This replaces the inline size caps removed with the
in-chat `PreviewCard` surface.

The gate SHALL use the limit from the server config; until the client has loaded it,
the gate SHALL wait (showing the viewer loading state) and SHALL fall back to the
default if the config fails to load or has not loaded within 3 s. A change to the setting SHALL take effect
for tabs opened or refreshed after the change, without a page reload. The editor-limit
gate SHALL run before any rich-viewer fetch. Server-side office conversion caps are
independent of this setting and are not raised by it: when the server refuses an office
conversion with `413`, the too-large notice SHALL name that office cap, not the editor
limit.

#### Scenario: File over the cap shows the too-large fallback

- **GIVEN** the large-file limit is the default 10 MiB
- **AND** a `report.docx` whose `/api/file` `size` is `10 * 1024 * 1024 + 1`
- **WHEN** the file opens in the pane
- **THEN** `TooLargePreview` mounts with an **Open raw** affordance (streams `/api/file/raw`)
- **AND** `DocxPreview` is NOT mounted

#### Scenario: File at or below the cap renders richly

- **GIVEN** the large-file limit is the default 10 MiB
- **AND** a `data.csv` whose `size` is exactly `10 * 1024 * 1024`
- **WHEN** the file opens in the pane
- **THEN** the rich `SpreadsheetPreview` mounts (no too-large fallback)

#### Scenario: Raised limit lets a large markdown file open for editing

- **GIVEN** a `notes.md` of 30 MiB
- **AND** the large-file limit is set to 64 MiB
- **WHEN** the file opens in the pane
- **THEN** `MarkdownViewer` mounts with its edit affordance
- **AND** no too-large fallback is shown

#### Scenario: Limit change applies without reload

- **GIVEN** a 30 MiB `notes.md` tab showing the too-large fallback under the default limit
- **WHEN** the user raises the limit to 64 MiB in Settings and saves
- **AND** refreshes or reopens the `notes.md` tab
- **THEN** `MarkdownViewer` mounts without a page reload

#### Scenario: No too-large flash before the config loads

- **GIVEN** the large-file limit is set to 64 MiB
- **WHEN** a 30 MiB `notes.md` tab mounts before the client has loaded the config
- **THEN** the viewer loading state shows until the config loads
- **AND** `TooLargePreview` is never shown for it

#### Scenario: Office 413 names the office cap

- **GIVEN** the large-file limit is 256 MiB
- **WHEN** a 60 MiB `.docx` opens and the server refuses the conversion with `413`
- **THEN** `TooLargePreview` names the docx office cap, not the editor limit

### Requirement: Server SHALL expose a content digest for a file without its content

`GET /api/file/digest?cwd=<cwd>&path=<path>` SHALL return `{ size, mtime, sha1 }` for a
regular file, where `sha1` is the lowercase hex SHA-1 of the file bytes and `mtime` is
the full-precision `stat.mtimeMs`, without returning the content. It SHALL apply the
same cwd admission, path decoding, containment anchors and layers as `GET /api/file`,
in the same order, SHALL admit the same files (including an in-`cwd` symlink to a
regular file, and the grant-verified open for grant-admitted paths), and SHALL refuse with the same status, error,
and remedy fields for every path `GET /api/file` refuses; a path refused by containment
SHALL be refused before existence is revealed. The dashboard client SHALL request
digests opted out of the access-grant prompt, so a prompt-eligible containment miss is
refused immediately (never suspended, never prompting). A directory or other
non-regular file SHALL return `404` without blocking, as SHALL a missing file. For a
file larger than the fixed 256 MiB digest ceiling it SHALL return `{ size, mtime }`
with no `sha1`. The server SHALL always hash; it SHALL NOT report a file unchanged from
caller-supplied metadata. The response SHALL NOT be cacheable.

`POST /api/file/write` SHALL accept request bodies large enough for content up to the
digest ceiling and SHALL refuse content above the ceiling with `413`. It SHALL additionally return `size` and `sha1` of the bytes it
wrote (the UTF-8 encoding of the submitted content) in its success payload, alongside
the existing `mtime`, unless the content exceeds the digest ceiling (then no `sha1`).
A digest of the file immediately after an uncontested write SHALL equal the write's
`sha1`.

#### Scenario: Digest of a contained file
- **GIVEN** `foo.ts` exists under `cwd`
- **WHEN** the client requests `GET /api/file/digest?cwd=<cwd>&path=foo.ts`
- **THEN** the response is `success: true` with `size`, full-precision `mtime` and the file's `sha1`
- **AND** the response contains no file content
- **AND** the response is marked non-cacheable

#### Scenario: Digest refuses exactly what /api/file refuses
- **GIVEN** a path that `GET /api/file` refuses (unknown session, outside containment, or refused grant)
- **WHEN** the client requests its digest
- **THEN** the digest endpoint refuses with the same status, error and remedy fields as `GET /api/file`

#### Scenario: Digest admits what /api/file admits
- **GIVEN** a file that `GET /api/file` serves without a grant (under `cwd`, through an in-`cwd` symlink to a regular file, or under the read site's `~/.pi` anchor)
- **WHEN** the client requests its digest
- **THEN** the response carries its `sha1`

#### Scenario: Missing file outside containment is refused, not 404
- **GIVEN** a non-existent path outside the working directory
- **WHEN** the client requests its digest
- **THEN** the response is the containment refusal, not `404`

#### Scenario: Non-regular file returns 404
- **GIVEN** a directory or a FIFO at the requested path under `cwd`
- **WHEN** the client requests its digest
- **THEN** the response is `404` and the request does not block

#### Scenario: File above the digest ceiling has no hash
- **GIVEN** a file larger than 256 MiB
- **WHEN** the client requests its digest
- **THEN** the response carries `size` and `mtime` and no `sha1`

#### Scenario: Large markdown save is accepted
- **GIVEN** a 20 MiB `notes.md` open for editing
- **WHEN** the user saves it
- **THEN** `POST /api/file/write` succeeds (no request-body-size refusal)

#### Scenario: Write returns the content hash
- **WHEN** `POST /api/file/write` succeeds
- **THEN** the response data contains `mtime`, `size` and the `sha1` of the written bytes
- **AND** an immediate digest of the file returns the same `sha1`
