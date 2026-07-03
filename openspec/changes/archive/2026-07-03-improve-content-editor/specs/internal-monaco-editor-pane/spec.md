# internal-monaco-editor-pane — delta

## MODIFIED Requirements

### Requirement: Pane SHALL host a collapsible file-tree rail

The pane SHALL render a file-tree browse rail on the left, rooted at the session's
`cwd`, collapsible via a **labelled, discoverable toggle at the rail↔viewer boundary**
(not a bare unlabelled icon buried among header actions). Rail visibility SHALL persist
per session.

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

### Requirement: Pane SHALL dispatch viewers via a kind-based registry

The pane SHALL dispatch the active tab to a viewer via a kind-based registry. The
registry SHALL cover: `monaco` (text/code), `markdown`, `image`, `pdf`, `html`,
`video`, `audio`, `mermaid`, and `binary-warn`. Where a shared `preview/*` renderer
exists for a kind, the registry entry SHALL delegate to it rather than a pane-local
duplicate:

- `pdf` → `PdfPreview` (pdfjs canvas render), NOT `<object type="application/pdf">`,
  so PDFs render in the Electron shell without a native PDF plugin.
- `html` → `HtmlPreview` (`<iframe sandbox="allow-same-origin" srcDoc={text}>`, scripts
  disabled), NOT `<iframe src="/api/file/raw">` (which would execute in the dashboard
  origin).
- `image` → `ImagePreview`, `video` → `VideoPreview`, `audio` → `AudioPreview`,
  `mermaid` → `MermaidBlock`.

`fileKind` SHALL classify `.html`/`.htm` → html, `.mmd`/`.mermaid` → mermaid,
`.mp3`/`.wav`/`.ogg`/`.m4a`/`.flac` → audio, and `.webm`/`.mov` → video. The `line`
scroll target SHALL be passed only to the `monaco` viewer.

#### Scenario: PDF renders via pdfjs, not a native plugin
- **GIVEN** the pane runs inside the Electron shell (no PDF plugin)
- **WHEN** the user opens a `.pdf` tab
- **THEN** the tab renders `PdfPreview` (canvas) with page navigation
- **AND** no download-only fallback is shown

#### Scenario: HTML file renders sandboxed with scripts disabled
- **WHEN** the user opens a local `.html` tab
- **THEN** the tab renders `HtmlPreview` via `<iframe sandbox="allow-same-origin" srcDoc>`
- **AND** the iframe has no `allow-scripts` (embedded JS does not execute)
- **AND** the HTML is not loaded via `<iframe src="/api/file/raw">`

#### Scenario: Media and mermaid kinds dispatch to shared renderers
- **WHEN** the user opens `.mp4`, `.mp3`, or `.mmd` tabs
- **THEN** they render `VideoPreview`, `AudioPreview`, and `MermaidBlock` respectively

### Requirement: Pane SHALL be read-only in v1

The Monaco editor SHALL be configured with `readOnly: true`. The pane SHALL display no save button, no dirty indicator, and no "+" affordance for creating new files in v1.

The shared `fileKind` classifier SHALL return `editable: false` for every file EXCEPT the writable markdown subset (`.md`/`.mdx`), which returns `editable: true`. Only the markdown viewer's Edit mode (see "Markdown tabs SHALL offer a Preview/Edit toggle") exposes a save path; all other viewers (Monaco text/code, media, pdf, html) remain read-only.

When the agent edits a file that the user has open, the pane SHALL NOT auto-refresh. A manual refresh button in the pane header SHALL re-fetch the active file's content from `/api/file`. (Auto-refresh on agent edits is deferred to v4.)

#### Scenario: Read-only editor rejects keystrokes
- **GIVEN** the pane has `foo.ts` open in a Monaco tab
- **WHEN** the user types into the editor area
- **THEN** the buffer content is unchanged
- **AND** no `POST /api/file/write` request is issued

#### Scenario: Manual refresh re-fetches active file
- **GIVEN** `foo.ts` is open in the pane
- **AND** the agent has just written new content to `foo.ts` via the Edit tool
- **WHEN** the user clicks the refresh button in the pane header
- **THEN** the pane issues `GET /api/file?cwd=<cwd>&path=foo.ts`
- **AND** the Monaco buffer updates to the new content
- **AND** the refresh is performed without closing or reopening the tab

## ADDED Requirements

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

The markdown tab SHALL offer a per-tab **Preview / Edit** toggle for files whose
`fileKind` reports `editable` (`.md`/`.mdx`). Edit mode SHALL mount the controlled
`MarkdownEditor`. Saving SHALL `POST /api/file/write` with the buffer's loaded `mtime`;
a `409` (changed on disk) SHALL surface the existing changed-on-disk banner and leave
the file untouched. Non-editable markdown (`.markdown`) SHALL remain preview-only.

#### Scenario: Edit and save a markdown file
- **GIVEN** a `.md` file open in Preview mode
- **WHEN** the user switches to Edit, changes text, and clicks Save
- **THEN** the client POSTs `/api/file/write` with the loaded `mtime`
- **AND** on success the dirty indicator clears

#### Scenario: Non-editable markdown has no Edit affordance
- **WHEN** the user opens a `.markdown` file
- **THEN** only Preview is available (no Edit toggle)

#### Scenario: Stale write is rejected
- **GIVEN** a `.md` file edited in the pane while the agent rewrote it on disk
- **WHEN** the user clicks Save
- **THEN** the write returns 409 and the changed-on-disk banner appears
- **AND** the on-disk file is unchanged
