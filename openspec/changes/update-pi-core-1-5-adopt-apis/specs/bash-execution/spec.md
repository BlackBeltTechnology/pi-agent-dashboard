## MODIFIED Requirements

### Requirement: Bash output event type
The dashboard event system SHALL support a `bash_output` event type for forwarding shell execution results from the extension to the browser.

The event data SHALL contain:
- `command` (string): The executed command
- `output` (string): The command's stdout/stderr output
- `exitCode` (number): The process exit code, taken from the `code` field of pi's `pi.exec` result (`ExecResult`), or `1` when `pi.exec` rejects
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

#### Scenario: Nonzero exit status forwarded
- **WHEN** the extension executes a `!` command and `pi.exec` resolves `{ code: 2, killed: false, truncated: false }`
- **THEN** the `bash_output` event SHALL have `exitCode: 2`
- **AND** when `pi.exec` resolves `{ code: 1, killed: true, truncated: true }` (output over pi's cap), the event SHALL have `exitCode: 1`, never `0`

#### Scenario: Timeout-killed run forwards pi's code verbatim
- **WHEN** the extension executes a `!` command and `pi.exec` resolves `{ code: 143, killed: true, truncated: false }` (killed on timeout)
- **THEN** the `bash_output` event SHALL have `exitCode: 143`
- **AND** when `pi.exec` resolves `{ code: 0, killed: true, truncated: false }`, the event SHALL have `exitCode: 0` (the bridge does not derive a status from `killed`)
