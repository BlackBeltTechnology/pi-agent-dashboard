# open-in-editor Specification

## Purpose
TBD - created by archiving change linkify-tool-output. Update Purpose after archive.
## Requirements
### Requirement: Editor detection
The system SHALL detect available native editors by checking if the editor application process is currently running AND the corresponding CLI binary is available on the system PATH. Native editor buttons (e.g., Zed) SHALL appear in the folder action bar instead of per-session-card placement. The `code`/`vscode` native editor entry SHALL be excluded from the action bar since VS Code is now served via the browser-based EditorView.

Process detection SHALL use `pgrep`:
- **macOS**: `pgrep -f "<app-bundle-path>"` (e.g., `/Applications/Zed.app`)
- **Linux**: `pgrep -x "<process-name>"` (e.g., `zed`)

If `pgrep` is not available or fails, the editor SHALL be treated as not running.

#### Scenario: Zed is running and CLI is available
- **WHEN** the Zed application process is running and `zed` CLI is on PATH
- **THEN** the Zed button SHALL appear in the folder action bar

#### Scenario: VS Code native entry excluded
- **WHEN** VS Code is running with `code` CLI available
- **THEN** the `code`/`vscode` entry SHALL NOT appear as a native editor button in the action bar
- **THEN** VS Code is accessible via the Editor button (code-server) instead

#### Scenario: Editor is installed but not running
- **WHEN** `zed` CLI is on PATH but the Zed application is not running
- **THEN** the Zed button SHALL NOT appear in the action bar

#### Scenario: Editor is running but CLI not available
- **WHEN** the Zed application is running but `zed` CLI is not on PATH
- **THEN** the response SHALL NOT include Zed in the result

#### Scenario: Multiple editors running
- **WHEN** both Zed and VS Code processes are running with CLIs available
- **THEN** only non-VS Code editors SHALL appear as native editor buttons

#### Scenario: No editors running
- **WHEN** no recognized editor processes are running
- **THEN** no native editor buttons SHALL appear in the action bar

#### Scenario: pgrep not available
- **WHEN** `pgrep` is not found on the system
- **THEN** the detection SHALL return an empty array without error

### Requirement: Editor detection API
The server SHALL expose `GET /api/editors?path=<cwd>` that returns detected editors for the given path. The response SHALL follow the standard `ApiResponse` envelope with `data` containing an array of `{ id: string, name: string }`.

#### Scenario: Valid path with editors
- **WHEN** a GET request is made to `/api/editors?path=/some/project` and editors are detected
- **THEN** the server SHALL respond with `{ success: true, data: [{ id: "zed", name: "Zed" }] }`

#### Scenario: Missing path parameter
- **WHEN** a GET request is made to `/api/editors` without a path query parameter
- **THEN** the server SHALL respond with `{ success: false, error: "path parameter required" }`

### Requirement: Open editor endpoint
The server SHALL expose `POST /api/open-editor` accepting `{ path: string, editor: string, file?: string, line?: number }`. It SHALL validate that `path` matches a known session `cwd` and `editor` is a recognized editor ID, then spawn the editor CLI as a detached process. When `file` is provided, the editor SHALL open that specific file (resolved relative to `path`). When both `file` and `line` are provided, the editor SHALL open the file at the specified line using `file:line` syntax.

#### Scenario: Open project folder
- **WHEN** a POST request is made with `path` and `editor` only
- **THEN** the server SHALL spawn the editor CLI with the cwd as argument and respond with `{ success: true }`

#### Scenario: Open specific file
- **WHEN** a POST request includes `file: "src/main.ts"`
- **THEN** the server SHALL resolve the file path relative to `path` and open it in the editor

#### Scenario: Open file at line
- **WHEN** a POST request includes `file: "src/main.ts"` and `line: 42`
- **THEN** the server SHALL open the file at line 42 using `path/src/main.ts:42` syntax

#### Scenario: Unknown path
- **WHEN** a POST request is made with a path that does not match any session's cwd
- **THEN** the server SHALL respond with `{ success: false, error: "unknown session path" }`

#### Scenario: Unknown editor
- **WHEN** a POST request is made with an editor ID not in the registry
- **THEN** the server SHALL respond with `{ success: false, error: "unknown editor" }`

### Requirement: Localhost-only access
The open-editor and editor detection endpoints SHALL only be accessible from localhost. Requests from non-loopback addresses SHALL be rejected.

#### Scenario: Request from localhost
- **WHEN** a request to `/api/open-editor` originates from `127.0.0.1` or `::1`
- **THEN** the server SHALL process the request normally

#### Scenario: Request from remote address
- **WHEN** a request to `/api/open-editor` originates from a non-loopback IP
- **THEN** the server SHALL respond with `{ success: false, error: "localhost only" }`

### Requirement: Windows editor detection
The editor registry SHALL include Windows-specific process patterns and CLI detection for supported editors.

#### Scenario: Detect VS Code on Windows
- **WHEN** editor detection runs on Windows
- **THEN** it SHALL check for `code.cmd` on PATH and common install paths (`%LOCALAPPDATA%\Programs\Microsoft VS Code\`)

#### Scenario: Detect IntelliJ on Windows
- **WHEN** editor detection runs on Windows
- **THEN** it SHALL check for `idea64.exe` on PATH and common JetBrains Toolbox paths

#### Scenario: Platform-aware process pattern
- **WHEN** the editor registry defines process patterns
- **THEN** it SHALL include a `win32` key alongside existing `darwin` and `linux` keys

### Requirement: Open-editor invocation from linkified tool output

Linkified file references inside tool output (see `tool-output-linkification`) SHALL invoke the same `POST /api/open-editor` endpoint that the existing `OpenFileButton` uses. The endpoint contract MUST NOT change: request body retains `path` (session cwd), `editor` (editor id), `file` (file path), `line` (1-based line number, optional).

Linkified-output invocations MUST resolve relative file paths against the active `ToolContext.cwd` before sending the request. The endpoint MUST continue to enforce its existing localhost-only gate; remote callers MUST receive the same rejection they get today and the client MUST fall back to the in-dashboard preview overlay defined in `tool-output-linkification`.

#### Scenario: localhost file-link click
- **GIVEN** `isLocalhost()` returns true and a VS Code editor is detected for the session cwd `/Users/me/repo`
- **WHEN** the user clicks a file link with `path="src/foo.ts"` and `line=42` rendered inside a bash tool result
- **THEN** the client SHALL POST `{ path: "/Users/me/repo", editor: "code", file: "src/foo.ts", line: 42 }` to `/api/open-editor`

#### Scenario: remote file-link click falls back to preview
- **GIVEN** the dashboard origin is not localhost
- **WHEN** the user clicks a file link inside a tool result
- **THEN** no request SHALL be sent to `/api/open-editor`
- **AND** the in-dashboard preview overlay SHALL open

### Requirement: Absolute path containment on file endpoints

`/api/file` and `/api/open-editor` SHALL accept absolute `path`/`file` values (including decoded `file://` payloads) but MUST continue to enforce that the resolved target lies under a known session cwd. An absolute path outside every session cwd MUST be rejected exactly as a traversal attempt is today.

#### Scenario: absolute path inside session cwd allowed
- **GIVEN** a session cwd `/home/u/proj`
- **WHEN** `/api/file` is called with an absolute `path` resolving to `/home/u/proj/src/foo.ts`
- **THEN** the file SHALL be read and returned

#### Scenario: absolute path outside any session cwd rejected
- **GIVEN** session cwds that do not contain `/etc`
- **WHEN** `/api/file` is called with absolute `path=/etc/passwd`
- **THEN** the request SHALL be rejected (no file content returned)

### Requirement: OpenFileButton SHALL be a split button defaulting to the internal pane

`OpenFileButton` SHALL render as a split control with two affordances:

1. **Body click** — opens the file in the internal Monaco editor pane via `buildEditorUrl(sessionId, filePath, line?)` route navigation.
2. **Caret dropdown** — lists detected native editors (e.g., Zed) as alternates. Selecting an entry invokes the existing `openEditor(cwd, editor.id, filePath, line)` flow unchanged.

When no native editors are detected, the dropdown caret SHALL be hidden and the button SHALL render as a plain "Open" control invoking the internal pane. (Today's behavior of hiding the entire button when no native editor exists is REMOVED — the button now appears whenever a `filePath` is present.)

The button SHALL appear on every tool-card renderer that today renders it (`EditToolRenderer`, `WriteToolRenderer`, `ReadToolRenderer`, `MultiEditToolRenderer` if present). The presence of a `cwd` SHALL still be required; the button SHALL NOT render in the rare case where the tool call has no resolvable cwd.

The dropdown ordering SHALL match the existing `editors` array order. The dropdown SHALL be a standard popover with keyboard navigation (arrow keys + Enter, Escape to dismiss).

#### Scenario: Click opens internal pane
- **GIVEN** a session with Zed detected as a native editor
- **WHEN** the user clicks the `OpenFileButton` body for `src/foo.ts`
- **THEN** the URL navigates to `/session/:id/editor?file=src/foo.ts`
- **AND** the editor pane opens with `src/foo.ts` as the active tab

#### Scenario: Dropdown opens external editor
- **GIVEN** a session with Zed detected as a native editor
- **WHEN** the user opens the `OpenFileButton` dropdown
- **AND** selects "Open in Zed"
- **THEN** the existing `openEditor(cwd, "zed", "src/foo.ts", line)` flow runs
- **AND** the dashboard does NOT navigate to the internal editor route

#### Scenario: No native editor detected hides dropdown
- **GIVEN** a session with NO native editors detected
- **WHEN** the user views a tool card with a file path
- **THEN** the `OpenFileButton` renders as a plain "Open" button with no caret affordance
- **AND** clicking the button opens the internal editor pane

#### Scenario: Button renders even without native editor
- **GIVEN** a session with NO native editors detected
- **AND** an `EditToolRenderer` showing a file path
- **WHEN** the chat renders
- **THEN** the `OpenFileButton` is visible (today's behavior would hide it)
- **AND** clicking it opens the internal pane

#### Scenario: Keyboard navigation through dropdown
- **GIVEN** two detected native editors and the dropdown is open
- **WHEN** the user presses ArrowDown then Enter
- **THEN** the second native editor is selected and invoked
- **WHEN** the user presses Escape with the dropdown open
- **THEN** the dropdown closes without invoking any editor

