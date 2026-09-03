# terminal-emulator Specification

## Purpose

Provides a real terminal against a folder group from inside the dashboard. Covers spawning, rendering, resize, the binary WebSocket transport, server-side PTY management, output buffering and replay, instance keep-alive, naming, routing, theme matching, and lifecycle cleanup. Carries the robustness rules that make it survive real use: cross-platform shell detection, working terminal creation on a fresh install, and rejection of degenerate PTY resize messages.

## Requirements

### Requirement: Spawn terminal from folder group
The system SHALL provide a `+Terminal` button in the folder action bar. Clicking it SHALL create a new terminal session with cwd set to that folder's directory AND navigate to the TerminalsView content area for that folder.

#### Scenario: User spawns a terminal
- **WHEN** user clicks the +Terminal button in the folder action bar
- **THEN** a new terminal session is created with cwd matching the folder
- **THEN** the content area navigates to `/folder/:encodedCwd/terminals`
- **THEN** the newly created terminal is the active tab in the TerminalsView

#### Scenario: Multiple terminals per folder
- **WHEN** user clicks the +Terminal button multiple times in the same folder
- **THEN** each click creates an independent terminal session
- **THEN** all terminal sessions appear as tabs in the TerminalsView

### Requirement: Terminal view rendering
When a terminal tab is selected in the TerminalsView, the tab content area SHALL display a full terminal emulator using xterm.js with ANSI color support, scrollback, and resize handling.

#### Scenario: Select terminal tab
- **WHEN** user clicks a terminal tab in the TerminalsView
- **THEN** the tab content area displays the xterm.js terminal view
- **THEN** the terminal is interactive (accepts keyboard input)
- **THEN** ANSI colors and escape sequences render correctly

#### Scenario: Scrollback
- **WHEN** terminal output exceeds the visible area
- **THEN** user can scroll back using mouse wheel or Shift+PageUp/PageDown
- **THEN** at least 10,000 lines of scrollback are available

### Requirement: Terminal resize
The terminal SHALL automatically resize to fill its container. When the browser window or sidebar resizes, the terminal SHALL send updated dimensions to the server and the PTY SHALL be resized accordingly.

#### Scenario: Window resize
- **WHEN** the browser window is resized
- **THEN** xterm.js recalculates columns and rows via FitAddon
- **THEN** the new dimensions are sent to the server
- **THEN** the server resizes the PTY
- **THEN** the shell receives SIGWINCH and redraws

#### Scenario: Sidebar resize
- **WHEN** the resizable sidebar width changes
- **THEN** the terminal container width changes
- **THEN** the terminal recalculates and resizes accordingly

### Requirement: Binary WebSocket transport
Each terminal SHALL communicate via a dedicated binary WebSocket at `/ws/terminal/:id`. Binary frames carry terminal I/O data. Text frames carry JSON control messages (resize, title).

#### Scenario: Terminal data flow
- **WHEN** user types in the terminal
- **THEN** keystrokes are sent as binary WebSocket frames to the server
- **THEN** the server writes them to the PTY
- **THEN** PTY output is sent as binary WebSocket frames to the client
- **THEN** xterm.js renders the output

#### Scenario: Resize control message
- **WHEN** the terminal needs to resize
- **THEN** a text frame with `{ "type": "resize", "cols": N, "rows": N }` is sent
- **THEN** the server resizes the PTY to match

### Requirement: Server-side PTY management
The server SHALL spawn PTY processes using node-pty with the user's default shell (detected from `$SHELL` environment variable). Each PTY SHALL have an associated 256KB ring buffer for output replay.

#### Scenario: Shell detection
- **WHEN** a terminal is created
- **THEN** the server uses the value of `$SHELL` to determine the shell binary
- **THEN** if `$SHELL` is not set, it falls back to `/bin/bash`

#### Scenario: PTY spawn
- **WHEN** a terminal creation request is received
- **THEN** the server spawns a PTY with node-pty in the requested cwd
- **THEN** the PTY inherits the server's environment variables
- **THEN** the terminal is assigned an ID with `term-` prefix

### Requirement: Output buffering and replay
The server SHALL maintain a 256KB ring buffer of raw PTY output per terminal. When a new WebSocket client connects to a terminal, the server SHALL replay the buffer contents before streaming live output.

#### Scenario: Reconnect replay
- **WHEN** a new WebSocket connects to an existing terminal
- **THEN** the server sends the entire ring buffer contents as binary frames
- **THEN** subsequent PTY output is streamed live
- **THEN** the client renders the replay followed by live output seamlessly

#### Scenario: Buffer overflow
- **WHEN** PTY output exceeds 256KB
- **THEN** oldest bytes are discarded from the ring buffer
- **THEN** newest bytes are retained

### Requirement: Terminal instance keep-alive
xterm.js terminal instances SHALL remain mounted in the DOM when navigating away from a terminal. Visibility SHALL be toggled via CSS (`display: none/flex`) rather than mount/unmount.

#### Scenario: Switch away and back
- **WHEN** user selects an agent session (navigating away from a terminal)
- **THEN** the terminal xterm.js instance remains in the DOM (hidden)
- **WHEN** user selects the terminal again
- **THEN** the terminal is shown instantly with full scrollback preserved
- **THEN** no replay flicker occurs

### Requirement: Terminal naming
Terminal names SHALL be derived from PTY title escape sequences. The shell name (e.g., "zsh") SHALL be used as default. Users SHALL be able to manually rename terminals.

#### Scenario: Default name
- **WHEN** a terminal is first created
- **THEN** the card displays the shell name (e.g., "zsh", "bash")

#### Scenario: PTY title update
- **WHEN** the shell sends a title escape sequence (ESC ]0;title BEL)
- **THEN** xterm.js fires a title event
- **THEN** the terminal card name updates to reflect the new title

#### Scenario: Manual rename
- **WHEN** user renames a terminal card
- **THEN** the name is updated and the PTY title no longer overrides it

### Requirement: Terminal lifecycle and cleanup
When the shell process exits or the user closes a terminal, the system SHALL send SIGTERM to the PTY, clean up server resources, close the WebSocket, and remove the card from the sidebar.

#### Scenario: Shell exit
- **WHEN** user types `exit` or the shell process terminates
- **THEN** the server detects the PTY exit event
- **THEN** the server closes the terminal WebSocket
- **THEN** the server broadcasts terminal removal to all browser clients
- **THEN** the terminal card is removed from the sidebar
- **THEN** if the terminal was selected, the view navigates away

#### Scenario: User closes terminal via UI
- **WHEN** user clicks the close button on a terminal card or header
- **THEN** the server sends SIGTERM to the PTY process
- **THEN** cleanup proceeds as in the shell exit scenario

### Requirement: Theme matching
The xterm.js terminal theme SHALL match the dashboard's current theme. Theme colors SHALL be derived from the dashboard's CSS variables.

#### Scenario: Theme applied
- **WHEN** a terminal view is rendered
- **THEN** the xterm.js background, foreground, cursor, and ANSI palette colors match the dashboard theme

#### Scenario: Theme change
- **WHEN** the user switches the dashboard theme
- **THEN** all terminal instances update their theme to match

### Requirement: Terminal routing
Terminal views SHALL be accessible via URL routing at `/terminal/:id`, separate from agent session routing at `/session/:id`.

#### Scenario: Direct URL access
- **WHEN** user navigates to `/terminal/term-abc`
- **THEN** the terminal view for that terminal is displayed
- **THEN** the corresponding terminal card is highlighted in the sidebar

#### Scenario: Invalid terminal URL
- **WHEN** user navigates to `/terminal/:id` for a non-existent terminal
- **THEN** the view redirects to the landing page

### Requirement: Cross-platform shell detection for terminal spawn
The terminal manager SHALL detect the appropriate shell binary based on the platform instead of defaulting to `/bin/bash`.

#### Scenario: macOS/Linux shell detection
- **WHEN** a terminal is created on macOS or Linux
- **THEN** the shell SHALL be `process.env.SHELL` or `/bin/bash` as fallback (existing behavior)

#### Scenario: Windows shell detection
- **WHEN** a terminal is created on Windows
- **THEN** the shell SHALL be `process.env.COMSPEC` or `powershell.exe` as fallback
- **AND** `/bin/bash` SHALL NOT be used

#### Scenario: Windows terminal environment
- **WHEN** a terminal is spawned on Windows
- **THEN** the environment SHALL include `TERM=cygwin` or appropriate Windows terminal type

### Requirement: Terminal creation succeeds on fresh install

After a fresh `npm install` on a supported platform (macOS, Linux, Windows), creating a new terminal via the dashboard UI or the `create_terminal` WebSocket message SHALL succeed without manual filesystem fix-ups. In particular, native `node-pty` prebuild artifacts required for spawning (notably the `spawn-helper` executable on macOS/Linux) SHALL have the execute bit set after install completes.

#### Scenario: spawn-helper is executable after install on macOS/Linux
- **WHEN** the project's `npm install` has completed on macOS or Linux
- **THEN** the file at the `node-pty` prebuild path for the current platform (`<node-pty-root>/prebuilds/<platform>/spawn-helper`) exists
- **AND** its file mode has at least one execute bit set (`mode & 0o111 !== 0`)

#### Scenario: User creates a first terminal from the Terminals view
- **WHEN** the Terminals view is open for a folder with zero existing terminals
- **AND** the user clicks the "+ New Terminal" button
- **THEN** the server spawns a PTY without throwing `posix_spawnp failed.`
- **AND** the server broadcasts a `terminal_added` message
- **AND** the Terminals view displays the new terminal as the active tab

#### Scenario: node-pty is hoisted by workspace tooling
- **WHEN** `node-pty` is installed at the workspace root's `node_modules/node-pty/` (hoisted by npm workspaces) rather than inside a specific package's `node_modules/`
- **THEN** the permission-fix step SHALL still locate and chmod the prebuild's `spawn-helper`

### Requirement: Server SHALL reject degenerate PTY resize messages
The terminal gateway SHALL ignore any inbound `{type:"resize", cols, rows}` control message where `cols < 2` or `rows < 2`. The PTY SHALL retain its previous dimensions. The connection SHALL remain open; no error frame is sent.

This guard is defense in depth: it prevents misbehaving clients (or transient `display:none` containers measured by FitAddon during route transitions) from corrupting `node-pty` geometry to a state where the shell renders into a 1×1 viewport.

A PTY at `cols < 2` or `rows < 2` is non-functional for every supported shell binding; no legitimate user intent maps to those dimensions.

#### Scenario: Resize with cols below floor is ignored
- **WHEN** an attached client sends `{type:"resize", cols: 1, rows: 24}`
- **THEN** the server SHALL NOT call `pty.resize(...)`
- **THEN** the PTY SHALL retain its previous cols and rows
- **THEN** the WebSocket connection SHALL remain open

#### Scenario: Resize with rows below floor is ignored
- **WHEN** an attached client sends `{type:"resize", cols: 80, rows: 0}`
- **THEN** the server SHALL NOT call `pty.resize(...)`
- **THEN** the PTY SHALL retain its previous cols and rows

#### Scenario: Resize at floor is accepted
- **WHEN** an attached client sends `{type:"resize", cols: 2, rows: 2}`
- **THEN** the server SHALL call `pty.resize(2, 2)`

#### Scenario: Normal resize is accepted
- **WHEN** an attached client sends `{type:"resize", cols: 80, rows: 24}`
- **THEN** the server SHALL call `pty.resize(80, 24)`
