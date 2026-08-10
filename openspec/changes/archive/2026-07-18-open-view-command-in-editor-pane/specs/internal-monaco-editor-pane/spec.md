# internal-monaco-editor-pane — delta

## ADDED Requirements

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

Each editor-pane tab SHALL offer system-open actions. A **file** tab SHALL offer *Open in system app* and *Reveal in file manager*; a **url** tab SHALL offer *Open in system browser*.

The two **file** actions SHALL be shown only when the server advertises `capabilities.systemOpen === true` on `/api/health` — a value the server computes at startup, true only for a desktop-capable host (an OS opener plus a display session) and false when headless / containerized / remote. A browser-side loopback check SHALL NOT be used as the gate: it is wrong for the Docker forwarded-port case (browser origin is `localhost:PORT` but the server runs in a headless container). When `capabilities.systemOpen` is false the file actions SHALL be hidden. The **url** action SHALL be unconditional.

The file actions SHALL dispatch to `POST /api/open-in-system` and `POST /api/reveal-in-file-manager`, each taking `{ cwd, path }` and spawning the OS opener on the server host (macOS `open` / `open -R`; Linux `xdg-open` / freedesktop reveal; Windows `start` / `explorer /select,`). The opener SHALL be invoked via `execFile`/`spawn` with an **argument array**, never a shell string, so a path containing a comma, space, quote, or newline cannot inject (notably the `explorer /select,<path>` argument). Both endpoints SHALL reuse the existing file-routes containment gate (the resolved path MUST start with a known session `cwd + path.sep`), SHALL refuse when `capabilities.systemOpen` is false, AND SHALL reject a request whose Origin/Host is not loopback — an absent Origin/Host SHALL be treated as non-loopback (rejected). Neither endpoint SHALL read or stream the file content. *Reveal in file manager* SHALL select the file without executing it.

The **url** action SHALL be `window.open(url, "_blank")`, which opens the system browser in every context (Electron rewrites it to `openExternal`; browsers honor it natively); it requires no server round-trip.

#### Scenario: File actions shown when the server is desktop-capable

- **GIVEN** `/api/health` reports `capabilities.systemOpen === true`
- **WHEN** a file tab is active
- **THEN** *Open in system app* and *Reveal in file manager* are available

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

- **WHEN** a client posts `/api/reveal-in-file-manager` with `path` resolving outside the session `cwd` (e.g. `../../../etc/passwd`)
- **THEN** the server responds 403 and spawns no opener

#### Scenario: Endpoint rejects a non-loopback or absent origin

- **GIVEN** a request to `/api/open-in-system` whose Origin/Host is non-loopback OR absent
- **WHEN** the server handles it
- **THEN** it is rejected without spawning an opener (defense-in-depth beyond the UI gate)

#### Scenario: Reveal argument is not shell-interpolated

- **GIVEN** a contained path containing a comma or space
- **WHEN** *Reveal in file manager* spawns the opener
- **THEN** the path is passed as a single `execFile` argument (no shell), so it cannot break `explorer /select,` or inject

#### Scenario: Open URL in system browser works remotely

- **GIVEN** a url tab in a remote browser session
- **WHEN** the user activates *Open in system browser*
- **THEN** `window.open(url, "_blank")` opens the URL in the user's own browser (no server round-trip)

### Requirement: Oversized files SHALL fall back to a too-large notice

The editor pane SHALL define a shared `MAX_PREVIEW_BYTES = 10 * 1024 * 1024` (10 MB) cap. When an opened file's `size` (as reported by `/api/file`) exceeds the cap, the viewer SHALL mount a `TooLargePreview` fallback — a short notice plus an **Open raw** affordance that streams `/api/file/raw` — INSTEAD of the rich renderer (`SpreadsheetPreview`, `DocxPreview`, `PdfPreview`, `ImagePreview`, etc.). Monaco text tabs retain their existing large-file handling and are not governed by this cap. This replaces the inline size caps removed with the in-chat `PreviewCard` surface.

#### Scenario: File over the cap shows the too-large fallback

- **GIVEN** a `report.docx` whose `/api/file` `size` is `10 * 1024 * 1024 + 1`
- **WHEN** the file opens in the pane
- **THEN** `TooLargePreview` mounts with an **Open raw** affordance (streams `/api/file/raw`)
- **AND** `DocxPreview` is NOT mounted

#### Scenario: File at or below the cap renders richly

- **GIVEN** a `data.csv` whose `size` is exactly `10 * 1024 * 1024`
- **WHEN** the file opens in the pane
- **THEN** the rich `SpreadsheetPreview` mounts (no too-large fallback)

## MODIFIED Requirements

### Requirement: Pane SHALL open at a per-session route

The dashboard SHALL expose a route `/session/:id/editor?file=<relPath>&line=<n>&url=<url>` that renders the internal editor pane for the named session. The pane SHALL be mountable **inside the chat + editor split** (co-existing with `ChatView`), not only as a full-screen replacement of `ChatView`. Entering the route SHALL open the split (via the `openInSplit` helper) and render the pane alongside `ChatView`. The route SHALL be parseable from inbound URLs (browser back/forward, copied URLs) and SHALL restore the pane state from `localStorage` on mount.

When the route is entered with a `file` query parameter, the named file SHALL be opened in a new (or existing if already open) tab and that tab SHALL become active. When `line` is provided, the active viewer SHALL scroll to that line (1-indexed).

When the route is entered with a `url` query parameter, the URL SHALL be opened in a new or existing URL tab via `openUrlTarget`, except a loopback URL (`isLoopbackUrl`) which SHALL open via `openLiveTarget` (the SSRF-gated live-server viewer). `SplitRouteSync` SHALL perform this bridge, mirroring the `file` → `openInSplit` path. `file` and `url` are intended mutually exclusive; when a route carries BOTH, `file` SHALL win and `url` SHALL be ignored (no error surface).

A close/unsplit affordance SHALL exist in the pane header. Activating it SHALL close the split (returning the content area to `ChatView`) without destroying the persisted pane state.

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
- **WHEN** the user activates the close/unsplit affordance in the pane header
- **THEN** the content area renders `ChatView` alone
- **AND** the three tabs remain in `localStorage`

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

#### Scenario: Office and email kinds dispatch to shared renderers

- **WHEN** the user opens `.docx`, `.pptx`, `.xlsx`, `.adoc`, or `.eml` tabs
- **THEN** they render `DocxPreview`, `PptxPreview`, `SpreadsheetPreview`, `AsciiDocPreview`, and `EmlPreview` respectively
- **AND** none renders as raw text in Monaco

#### Scenario: PDF renders via pdfjs, not a native plugin

- **GIVEN** the pane runs inside the Electron shell (no PDF plugin)
- **WHEN** the user opens a `.pdf` tab
- **THEN** the tab renders `PdfPreview` (canvas) with page navigation

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

### Requirement: Server SHALL extend `/api/file` and add `/api/file/raw`

`GET /api/file?cwd=<cwd>&path=<relPath>` SHALL return `{ type: "file", kind, mimeType, size, content? }` for file entries. `content` SHALL be present when the classified `viewer ∈ { "monaco", "markdown" }` OR when `editable === true` (so an editable non-markdown tab such as `.csv` can load its text into Monaco). `content` SHALL be omitted for all other kinds, including `image`, `pdf`, `binary`, `docx`, `pptx`, `xlsx` spreadsheets, `asciidoc`, and `email`.

`GET /api/file/raw?cwd=<cwd>&path=<relPath>` SHALL stream raw file bytes with the resolved `Content-Type` header. Both endpoints SHALL apply the existing security gates: `cwd` matched against a known session path; resolved path SHALL start with `cwd + path.sep` (path-traversal prevention).

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

### Requirement: Markdown tabs SHALL offer a Preview/Edit toggle

An `editable` tab SHALL offer a per-tab **Preview / Edit** toggle. For `.md`/`.mdx`, Edit mode SHALL mount the controlled `MarkdownEditor`. For an editable non-markdown kind — currently `.csv` — Preview SHALL render the kind's rich viewer (`SpreadsheetPreview` for `.csv`) and Edit SHALL mount a plain Monaco text buffer over the raw file text. Saving SHALL `POST /api/file/write` with the buffer's loaded `mtime`; a `409` (changed on disk) SHALL surface the existing changed-on-disk banner and leave the file untouched. Non-editable kinds (`.markdown`, `.xlsx`, `.docx`, `.eml`, …) SHALL remain preview-only with no Edit affordance.

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

#### Scenario: Non-editable kinds have no Edit affordance

- **WHEN** the user opens a `.xlsx`, `.docx`, or `.eml` file
- **THEN** only Preview is available (no Edit toggle)
