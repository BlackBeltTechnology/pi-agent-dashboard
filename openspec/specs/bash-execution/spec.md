## Purpose

Bash command execution events and their rendering in the dashboard chat view.
## Requirements
### Requirement: Bash output event type
The dashboard event system SHALL support a `bash_output` event type for forwarding shell execution results from the extension to the browser.

The event data SHALL contain:
- `command` (string): The executed command
- `output` (string): The command's stdout/stderr output
- `exitCode` (number): The process exit code
- `excludeFromContext` (boolean): `true` for `!!` commands, `false` for `!` commands

#### Scenario: Bash output event forwarded
- **WHEN** the extension sends an `event_forward` with a `bash_output` event
- **THEN** the server SHALL store and forward the event to subscribed browsers like any other dashboard event

#### Scenario: Silent bash output marked correctly
- **WHEN** the extension executes `!!docker ps`
- **THEN** the `bash_output` event SHALL have `excludeFromContext: true`

#### Scenario: LLM bash output marked correctly
- **WHEN** the extension executes `!git diff`
- **THEN** the `bash_output` event SHALL have `excludeFromContext: false`

### Requirement: Bash output rendering in chat view
The chat view SHALL render `bash_output` events as distinct cards showing:
- The command that was executed (in monospace font)
- The output (in a scrollable pre-formatted block)
- The exit code (with visual indicator: green for 0, red for non-zero)
- A visual distinction between `!` (sent to LLM) and `!!` (silent) — e.g., a "silent" badge or dimmed style for `!!` commands

#### Scenario: Successful bash output rendered
- **WHEN** a `bash_output` event arrives with `exitCode: 0` and `excludeFromContext: false`
- **THEN** the chat view SHALL render a card with the command, output, and a green exit code indicator

#### Scenario: Failed bash output rendered
- **WHEN** a `bash_output` event arrives with `exitCode: 1`
- **THEN** the chat view SHALL render a card with the command, output, and a red exit code indicator

#### Scenario: Silent bash output rendered with badge
- **WHEN** a `bash_output` event arrives with `excludeFromContext: true`
- **THEN** the chat view SHALL render the card with a "silent" or "!!" visual badge indicating output was not sent to the LLM

### Requirement: Command feedback event type
The dashboard event system SHALL support a `command_feedback` event type for showing status of commands like `/compact`.

The event data SHALL contain:
- `command` (string): The command name (e.g., "/compact")
- `status` (string): One of `"started"`, `"completed"`, `"error"`
- `message` (string, optional): Additional context message

#### Scenario: Compact started feedback
- **WHEN** the user sends `/compact` and the extension starts compaction
- **THEN** a `command_feedback` event SHALL be sent with `status: "started"` and `command: "/compact"`

#### Scenario: Command error feedback
- **WHEN** a command fails (e.g., compact when already compacted)
- **THEN** a `command_feedback` event SHALL be sent with `status: "error"` and an error message

### Requirement: Command feedback rendering in chat view
The chat view SHALL render `command_feedback` events as inline status indicators:
- `started`: A subtle info-style card with the command name and a spinner or "in progress" indicator
- `completed`: A success-style card
- `error`: An error-style card with the error message

#### Scenario: Started feedback rendered
- **WHEN** a `command_feedback` event with `status: "started"` arrives
- **THEN** the chat view SHALL show a subtle info card (e.g., "⏳ /compact started")

#### Scenario: Error feedback rendered
- **WHEN** a `command_feedback` event with `status: "error"` arrives
- **THEN** the chat view SHALL show an error card with the error message

### Requirement: Show full output affordance for truncated tool results

When the chat view renders a `toolResult` whose text starts with the truncation marker (`«` U+00AB followed by `<N> earlier lines hidden»`), the UI SHALL render a "Show full output" affordance below the truncated text. Clicking it SHALL fetch the full result via `GET /api/sessions/:sessionId/tool-result/:toolCallId` and replace the rendered text with the full result in-place. Subsequent collapse SHALL re-show the truncated form.

When the endpoint returns 404 (tool call still in flight or evicted from the memory buffer), the UI SHALL render an inline message "result evicted" instead of the full text. The truncated text SHALL remain visible.

This affordance SHALL appear in both `ToolCallStep` and `BashOutputCard` renderers — they are the two places truncated results render today.

#### Scenario: Truncated bash result has Show full output
- **WHEN** a `BashOutputCard` renders text starting with `«300 earlier lines hidden»`
- **THEN** a "Show full output" button SHALL appear below the text

#### Scenario: Click fetches and replaces
- **WHEN** the user clicks "Show full output" and the endpoint returns the full result
- **THEN** the rendered text SHALL update to the full untruncated result

#### Scenario: Evicted result shows inline notice
- **WHEN** the endpoint returns 404 (evicted)
- **THEN** the rendered area SHALL show an inline "result evicted" notice
- **AND** the truncated text SHALL remain visible

#### Scenario: Non-truncated results have no affordance
- **WHEN** the rendered text does not start with the truncation marker (output was ≤ 200 lines)
- **THEN** no "Show full output" button SHALL render

### Requirement: Streaming bash and bash session env adoption SHALL be a documented feasibility spike

pi's streaming `bash_execution_update` events (0.82.0) fire **only for direct RPC bash commands correlated by request id** (`docs/rpc.md`), and the bash-tool session env vars (`PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL`) are injected **only into commands run by pi's LLM-callable/factory bash tools**. The dashboard has no RPC-bash path: dashboard-initiated `!`/`!!`/slash-exec commands run through `handleBashCommand` via `pi.exec(...)` and emit the dashboard's own synthetic `bash_output` event; LLM tool bash renders via `tool_execution_*`; server-side worktreeInit hooks run as separate server child processes. None of these receive `bash_execution_update` or pi's bash-tool session env.

Therefore this change SHALL treat streaming-bash and bash-session-env adoption as a **feasibility spike**, not a committed implementation. The spike SHALL determine whether any dashboard bash path can, in fact, surface `bash_execution_update` or read the pi bash-tool session env (including whether `pi.exec` children inherit `PI_SESSION_*` from the pi process env), and SHALL record the outcome. Code SHALL land ONLY if the spike identifies a concrete applicable path; otherwise the requirement is satisfied by the recorded finding. In all cases the existing dashboard `bash_output` event contract SHALL remain unchanged.

**Spike outcome (recorded):** investigation against pi `0.83.0` + the dashboard source confirms **no applicable path** today — the dashboard issues no RPC `bash` (dashboard bash runs via `pi.exec` in `handleBashCommand` → synthetic `bash_output`; LLM bash → `tool_execution_*`), and pi injects `PI_SESSION_*` only into its own bash-tool command env (`environment-variables.md`), not into `pi.exec` children or the server-side worktreeInit bash (a separate process). No streaming/env code lands; the `bash_output` contract is unchanged. Re-evaluate if the dashboard ever adopts an RPC-bash path.

#### Scenario: Spike finds no applicable path

- **GIVEN** the dashboard issues no RPC bash and registers no pi bash tool
- **WHEN** the streaming-bash / bash-session-env feasibility spike runs
- **THEN** the outcome SHALL be recorded as "not applicable to the current architecture"
- **AND** no streaming code SHALL land
- **AND** the existing `bash_output` event contract SHALL be unchanged

#### Scenario: Spike finds an applicable path

- **GIVEN** the spike identifies a concrete dashboard bash path that surfaces `bash_execution_update` or the bash-tool session env
- **WHEN** an adoption is implemented for that path
- **THEN** it SHALL be feature-detected (present → enhanced, absent → today's behavior)
- **AND** the existing `bash_output` event contract SHALL remain the source of truth for the final rendered card

