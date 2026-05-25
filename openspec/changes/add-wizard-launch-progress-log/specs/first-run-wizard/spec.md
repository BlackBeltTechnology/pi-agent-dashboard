# first-run-wizard — delta

## ADDED Requirements

### Requirement: Bootstrap log surfaced in wizard window
The first-run wizard SHALL surface a structured log of the Electron bootstrap process in a collapsible pane attached to the launch-progress view. The log SHALL receive events from the Electron main process via an IPC channel and SHALL display each step of the 6-state startup machine (`check-health`, `wizard`, `spawn`, `health-wait`, `done`, `loading-page-error`) with timing, command invocation, and live server stdout/stderr lines.

The pane SHALL default to collapsed on first launch (so the initial visual remains a clean spinner) and SHALL persist the user's expand/collapse choice across launches. While collapsed, the existing spinner + label SHALL remain the primary visual.

#### Scenario: Pane appears on first event
- **WHEN** the first `bootstrap-log` event arrives at the renderer
- **THEN** the collapsed pane SHALL render its toggle ("Show details ▼") if not already visible
- **AND** the spinner + label SHALL remain unchanged

#### Scenario: Step transitions visible when expanded
- **WHEN** the user expands the pane AND the bootstrap reaches the `spawn` step
- **THEN** the pane SHALL contain a bold line `▶ spawn` followed by an indented argv line `$ node --import file:///… cli.ts`
- **AND** when `spawn` completes, a `✓ spawn (<elapsed>ms)` line SHALL appear

#### Scenario: Server output streams live
- **WHEN** the spawned server writes to stdout or stderr during `health-wait`
- **THEN** lines SHALL appear in the pane within 500 ms of being written, at a rate capped at 50 lines/second per stream
- **AND** dropped lines SHALL be flagged with a `truncated` marker on the next delivered line

#### Scenario: Expand/collapse persists
- **WHEN** the user expands the pane and quits the app
- **THEN** the next launch SHALL render the pane expanded by default
- **AND** the spinner + label SHALL still be visible above

#### Scenario: Accessibility live region
- **WHEN** a screen reader is attached
- **THEN** the pane SHALL be marked `role="log" aria-live="polite" aria-atomic="false"`
- **AND** new entries SHALL be announced without re-announcing existing entries

### Requirement: Sensitive data redaction in bootstrap log
The bootstrap log SHALL redact strings matching common credential patterns from line events before they reach the IPC channel and before they are written to the persistent log file. Argv events SHALL omit values derived from `process.env`.

The redaction set covers, at minimum, case-insensitive matches of `key=`, `token=`, `secret=`, `password=`, and `authorization:` (with optional whitespace). Matched values SHALL be replaced with `[redacted]`. The persistent log file SHALL never be uploaded by the application; it lives at `<userData>/wizard-bootstrap.jsonl` and is opened only on explicit user action via "View full log".

#### Scenario: Authorization header redacted
- **WHEN** the spawned server logs `Authorization: Bearer abc123`
- **THEN** the line delivered to the renderer SHALL contain `Authorization: [redacted]`
- **AND** the line appended to `wizard-bootstrap.jsonl` SHALL contain `Authorization: [redacted]`

#### Scenario: Key-value secret redacted
- **WHEN** the spawned server logs `OPENAI_API_KEY=sk-abc123 starting up`
- **THEN** the line delivered SHALL contain `OPENAI_API_KEY=[redacted] starting up`

#### Scenario: Non-secret keyword preserved
- **WHEN** the spawned server logs `keyword extraction enabled` (substring match but no `=`)
- **THEN** the line SHALL be delivered unchanged

#### Scenario: Argv strips env-derived values
- **WHEN** the `spawn` step emits its argv event
- **THEN** the array SHALL contain only the literal argv (binary path, `--import`, loader URL, entry path)
- **AND** SHALL NOT contain any value sourced from `process.env`

### Requirement: Persistent bootstrap log file with size cap and rotation
The bootstrap log events SHALL be appended as JSONL to `<userData>/wizard-bootstrap.jsonl`. When the file size exceeds 1 MB after an append, the file SHALL be renamed to `wizard-bootstrap.1.jsonl` (overwriting any prior backup) and a fresh file started. Single-backup rotation is sufficient — the log is a diagnostic, not an audit trail.

The wizard pane SHALL surface a "View full log" link that opens the current `wizard-bootstrap.jsonl` in the OS default text editor via `shell.openPath`.

#### Scenario: First-launch file creation
- **WHEN** the bootstrap emitter writes its first event on a fresh install
- **THEN** `<userData>/wizard-bootstrap.jsonl` SHALL be created with that event as its sole line

#### Scenario: Rotation at 1 MB
- **WHEN** an append would take the file size above 1 MB
- **THEN** the file SHALL be renamed to `wizard-bootstrap.1.jsonl` and a new empty `wizard-bootstrap.jsonl` SHALL be created
- **AND** the next event SHALL be appended to the new file

#### Scenario: Open in editor
- **WHEN** the user clicks "View full log"
- **THEN** `shell.openPath(<userData>/wizard-bootstrap.jsonl)` SHALL be invoked
- **AND** SHALL NOT block the wizard
