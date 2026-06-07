## ADDED Requirements

### Requirement: Open inline terminal via bare `!!`
The system SHALL open an inline interactive terminal card in the chat stream when the user submits `!!` with no command. `!! <command>` and `! <command>` (with a command) SHALL retain their existing one-shot `bash_output` behavior unchanged.

#### Scenario: Bare `!!` opens inline terminal
- **WHEN** the user submits `!!` with no following command
- **THEN** the system SHALL spawn an ephemeral PTY terminal
- **THEN** an inline interactive terminal card SHALL appear in the chat stream
- **THEN** no `bash_output` event SHALL be emitted

#### Scenario: `!!` with a command is unchanged
- **WHEN** the user submits `!!docker ps`
- **THEN** the system SHALL execute it as a one-shot command and emit `bash_output` with `excludeFromContext: true`
- **THEN** no inline terminal card SHALL open

#### Scenario: `!` with a command is unchanged
- **WHEN** the user submits `!git status`
- **THEN** the system SHALL execute it as a one-shot command and emit `bash_output` with `excludeFromContext: false`

### Requirement: Open inline terminal via composer button
The chat composer SHALL provide a button that opens an inline interactive terminal card, using the same path as bare `!!`.

#### Scenario: Button opens inline terminal
- **WHEN** the user clicks the composer's open-inline-terminal button
- **THEN** an ephemeral PTY terminal SHALL be spawned
- **THEN** an inline interactive terminal card SHALL appear in the chat stream

### Requirement: Inline terminal card rendering
A live inline terminal card SHALL render a fully interactive xterm.js terminal at a fixed height, reusing the existing PTY transport (`/ws/terminal/:id`). The card SHALL be scrollable internally via xterm scrollback while the chat page scrolls past it normally.

#### Scenario: Interactive input
- **WHEN** an inline terminal card is live and focused
- **THEN** keystrokes SHALL be sent to the PTY and output rendered with ANSI colors
- **THEN** tab-completion and interactive programs (REPL, editors, ssh) SHALL work

#### Scenario: Fixed height with internal scrollback
- **WHEN** terminal output exceeds the card's fixed height
- **THEN** the card SHALL retain its fixed height
- **THEN** the user SHALL scroll within the card using xterm scrollback (mouse wheel / Shift+PageUp)
- **THEN** at least 10,000 lines of scrollback SHALL be available

#### Scenario: Resize to card width
- **WHEN** the card's container width changes
- **THEN** xterm SHALL recalculate columns/rows via FitAddon and resize the PTY accordingly

### Requirement: Inline terminal is independent from the LLM
An inline terminal's input and output SHALL NOT enter the agent's context. No path SHALL forward inline terminal output to the LLM.

#### Scenario: No context forwarding
- **WHEN** the user runs any command inside an inline terminal card
- **THEN** the system SHALL NOT call `pi.sendUserMessage` with the terminal output
- **THEN** the agent context SHALL be unaffected by the terminal session

### Requirement: Ephemeral terminal sessions
Inline terminals SHALL be marked `ephemeral` on their `TerminalSession`. Ephemeral terminals SHALL NOT appear in the content-area `TerminalsView` tab bar.

#### Scenario: Ephemeral excluded from tabs
- **WHEN** an inline terminal is spawned for a folder
- **THEN** its `TerminalSession.ephemeral` SHALL be `true`
- **THEN** it SHALL NOT appear as a tab in that folder's TerminalsView

### Requirement: Inline terminal lifecycle events
The event system SHALL support `inline_terminal_open` and `inline_terminal_close` events so inline terminal cards are reconstructed on reload via event replay.

`inline_terminal_open` data SHALL contain:
- `terminalId` (string): the ephemeral PTY's terminal id.

`inline_terminal_close` data SHALL contain:
- `terminalId` (string): the closed terminal's id.
- `transcript` (string): the captured final scrollback transcript.

#### Scenario: Open event fixes card position
- **WHEN** an inline terminal is opened
- **THEN** an `inline_terminal_open` event SHALL be stored and forwarded
- **THEN** on reload, replay SHALL reconstruct a card at the same position in the chat stream

#### Scenario: Close event freezes transcript
- **WHEN** the user closes a live inline terminal card
- **THEN** the PTY SHALL receive SIGTERM
- **THEN** an `inline_terminal_close` event SHALL be emitted carrying the captured transcript
- **THEN** the card SHALL render as a read-only scrollable transcript

### Requirement: Inline terminal reattach on reload
A live inline terminal whose PTY is still alive SHALL reattach on reload via its `terminalId`, replaying the PTY ring buffer. A live inline terminal whose PTY is no longer alive SHALL render a best-effort transcript or a disconnected notice.

#### Scenario: Reattach live PTY
- **WHEN** the page reloads while an inline terminal is live and its PTY is alive
- **THEN** replay SHALL see `inline_terminal_open` with no matching `inline_terminal_close`
- **THEN** the card SHALL reconnect to `/ws/terminal/:id` and replay the ring buffer

#### Scenario: Closed terminal renders frozen
- **WHEN** the page reloads after an inline terminal was closed
- **THEN** replay SHALL see both `inline_terminal_open` and `inline_terminal_close`
- **THEN** the card SHALL render the stored transcript read-only
