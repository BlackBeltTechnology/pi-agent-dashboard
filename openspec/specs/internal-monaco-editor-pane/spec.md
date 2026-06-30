# internal-monaco-editor-pane Specification

## Purpose
TBD - created by archiving change add-internal-monaco-editor-pane. Update Purpose after archive.
## Requirements
### Requirement: Pane SHALL open at a per-session route

The dashboard SHALL expose a route `/session/:id/editor?file=<relPath>&line=<n>` that renders the internal editor pane in the content area for the named session, replacing `ChatView`. The route SHALL be parseable from inbound URLs (e.g. browser back/forward, copied URLs) and SHALL restore the pane state from `localStorage` on mount.

When the route is entered with a `file` query parameter, the named file SHALL be opened in a new (or existing if already open) tab and that tab SHALL become active. When `line` is provided, the active viewer SHALL scroll to that line (1-indexed).

A back-to-chat affordance SHALL exist in the pane header. Activating it SHALL navigate to the prior route (typically `/session/:id`) without destroying the persisted pane state.

#### Scenario: Direct URL navigation opens the requested file
- **GIVEN** a session `abc123` whose cwd is `/Users/u/proj`
- **WHEN** the user navigates to `/session/abc123/editor?file=src/foo.ts&line=42`
- **THEN** the editor pane renders in the content area
- **AND** `src/foo.ts` is open in an active tab
- **AND** the Monaco viewer scrolls so line 42 is visible

#### Scenario: Back button returns to chat preserving pane state
- **GIVEN** the editor pane is open with three tabs
- **WHEN** the user clicks the back-to-chat button
- **THEN** the content area renders `ChatView` for the session
- **AND** the three tabs remain in `localStorage`
- **AND** re-entering the editor route restores the three tabs and the previously active one

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

The pane SHALL render a file-tree rail on the left, rooted at the session's `cwd`. The rail SHALL be collapsible via a toggle button in the pane header. When collapsed, the rail SHALL hide entirely and the viewer SHALL expand to fill the freed width.

Directories in the tree SHALL be lazily expanded — clicking a folder SHALL issue a `GET /api/browse` request for that folder's contents and render the children inline. Expanded directories SHALL persist across reloads via `treeOpenRoots` in `localStorage`.

Clicking a file in the tree SHALL invoke `openFile(relPath, viewer)` where `viewer` is determined by the shared file-kind classifier.

#### Scenario: Lazy expansion fetches children on first click
- **GIVEN** the tree shows the root cwd with directories `src/`, `docs/`, `tests/` collapsed
- **WHEN** the user clicks `src/`
- **THEN** a `GET /api/browse` request is issued for `<cwd>/src`
- **AND** the children of `src` render inline beneath the folder
- **AND** `src` is added to `treeOpenRoots` in `localStorage`

#### Scenario: Collapsed rail hides tree and expands viewer
- **GIVEN** the rail is open and the viewer occupies 70% of the pane width
- **WHEN** the user clicks the tree-toggle button
- **THEN** the rail hides entirely
- **AND** the viewer occupies the full pane width
- **AND** the toggle button remains visible to re-open the rail

### Requirement: Pane SHALL dispatch viewers via a kind-based registry

The pane SHALL select the tab's content component via a registry keyed by `ViewerKind`. The v1 registry SHALL include entries for:

- `monaco` — text/code via lazy-loaded Monaco editor,
- `image` — raster/SVG images via `<img>` with pan/zoom,
- `pdf` — PDF documents via the browser's native PDF rendering,
- `markdown` — markdown documents via the dashboard's existing `MarkdownContent` renderer with `pi-asset:` resolution,
- `binary-warn` — non-displayable binary files with a "open externally" hint.

The viewer selection SHALL be performed by the shared `fileKind(absPath, sniff?)` classifier with the discrimination order:

1. Extension on the text/code allowlist → `monaco`,
2. Extension on the image allowlist → `image`,
3. `.pdf` extension → `pdf`,
4. `.md` / `.mdx` extension → `markdown` (overrides #1),
5. Sniff (server-side only) detects NUL byte in first 1024 bytes → `binary-warn`,
6. Default → `monaco` (assume text).

#### Scenario: TypeScript file routes to Monaco
- **WHEN** the pane opens `src/foo.ts`
- **THEN** the active tab renders `MonacoBuffer`
- **AND** the Monaco editor is configured with the `typescript` language

#### Scenario: Markdown file overrides Monaco for MarkdownViewer
- **WHEN** the pane opens `README.md`
- **THEN** the active tab renders `MarkdownViewer`, NOT `MonacoBuffer`
- **AND** `pi-asset:` references inside the markdown resolve via `SessionAssetsContext`

#### Scenario: Binary file shows BinaryWarn
- **GIVEN** the server's classifier detects NUL bytes in `data.bin` first 1024 bytes
- **WHEN** the pane opens `data.bin`
- **THEN** the active tab renders `BinaryWarn`
- **AND** no file content is rendered in the tab
- **AND** the warn component offers an "Open in <native editor>" button when a native editor is detected

### Requirement: Pane SHALL be read-only in v1

The Monaco editor SHALL be configured with `readOnly: true`. The pane SHALL display no save button, no dirty indicator, and no "+" affordance for creating new files in v1. The shared `fileKind` classifier SHALL return `editable: false` for every file in v1.

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

`GET /api/file?cwd=<cwd>&path=<relPath>` SHALL return `{ type: "file", kind, mimeType, size, content? }` for file entries. `content` SHALL be present for `kind ∈ { "text", "markdown" }` and SHALL be omitted for `image`, `pdf`, `binary`.

`GET /api/file/raw?cwd=<cwd>&path=<relPath>` SHALL stream raw file bytes with the resolved `Content-Type` header. Both endpoints SHALL apply the existing security gates: `cwd` matched against a known session path; resolved path SHALL start with `cwd + path.sep` (path-traversal prevention).

The file-kind discrimination SHALL invoke the shared `fileKind` module with the first 1024 bytes of the file as the `sniff` argument; the server SHALL NOT read the full file just to classify.

#### Scenario: Text file returns content + kind
- **WHEN** `GET /api/file?cwd=/Users/u/proj&path=src/foo.ts` succeeds
- **THEN** the response is `{ success: true, data: { type: "file", kind: "text", mimeType: "text/x.typescript", size: 1234, content: "..." } }`

#### Scenario: Image file omits content
- **WHEN** `GET /api/file?cwd=/Users/u/proj&path=logo.png` succeeds
- **THEN** the response is `{ success: true, data: { type: "file", kind: "image", mimeType: "image/png", size: 5678 } }`
- **AND** the response body does NOT include `content`

#### Scenario: Raw endpoint streams bytes with correct Content-Type
- **WHEN** the client issues `GET /api/file/raw?cwd=/Users/u/proj&path=logo.png`
- **THEN** the server streams the raw PNG bytes
- **AND** the response includes `Content-Type: image/png`

#### Scenario: Path traversal rejected on raw endpoint
- **WHEN** the client issues `GET /api/file/raw?cwd=/Users/u/proj&path=../../../etc/passwd`
- **THEN** the server responds 403 with `{ success: false, error: "path outside working directory" }`
- **AND** no file content is transmitted

### Requirement: Shared `fileKind` classifier SHALL be the single source of viewer discrimination

The pure module `packages/shared/src/file-kind.ts` SHALL export `fileKind(absPath: string, sniff?: Buffer | string): { kind, mimeType, viewer, editable }`. Both server (`/api/file`, `/api/file/raw`) and client (`OpenFileButton`, `EditorFileTree`) SHALL use this function — no separate discrimination logic SHALL exist elsewhere.

The function SHALL be pure: same inputs always produce the same output; no I/O. Sniff is optional; when absent the function SHALL classify by extension only.

In v1 the `editable` field SHALL always return `false`. v3/v4 will repurpose this field; v1 callers SHALL ignore it for the present.

#### Scenario: Same extension classifies identically on both ends
- **GIVEN** the path `/abs/cwd/src/foo.ts`
- **WHEN** both server and client invoke `fileKind` with that path
- **THEN** both return `{ kind: "text", viewer: "monaco", editable: false }`
- **AND** the `mimeType` strings match

#### Scenario: Sniff promotes unknown extension to binary
- **GIVEN** an extension-less file `bin/myhelper` whose first 1024 bytes contain a NUL byte
- **WHEN** the server invokes `fileKind("/abs/cwd/bin/myhelper", sniff)`
- **THEN** the result is `{ kind: "binary", viewer: "binary-warn", editable: false }`
- **AND** without `sniff` the same path classifies as `{ kind: "unknown", viewer: "monaco" }`

