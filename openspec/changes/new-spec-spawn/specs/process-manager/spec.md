## MODIFIED Requirements

### Requirement: Spawn pi session supports headless strategy
The `spawnPiSession` function SHALL accept an optional `strategy` parameter (`"tmux" | "headless"`). When `"headless"`, it SHALL spawn `pi --mode rpc` as a child process instead of using tmux. When `"tmux"` or omitted, existing tmux behavior SHALL be preserved. An optional `initialPrompt` parameter SHALL be appended as a positional argument to the pi command.

#### Scenario: Headless spawn with initial prompt
- **WHEN** `spawnPiSession(cwd, { strategy: "headless", initialPrompt: "/opsx:explore" })` is called
- **THEN** it SHALL spawn `pi --mode rpc "/opsx:explore"` with `cwd` set and `PI_DASHBOARD_SPAWNED=1` in env

#### Scenario: Tmux spawn with initial prompt
- **WHEN** `spawnPiSession(cwd, { strategy: "tmux", initialPrompt: "/opsx:explore" })` is called
- **THEN** it SHALL spawn a tmux window running `pi "/opsx:explore"` in the specified cwd

#### Scenario: Spawn without initial prompt unchanged
- **WHEN** `spawnPiSession(cwd, { strategy: "headless" })` is called without `initialPrompt`
- **THEN** behavior SHALL be identical to current implementation

#### Scenario: Headless spawn uses keeper
- **WHEN** `spawnPiSession(cwd, {strategy: "headless"})` is called
- **THEN** the server SHALL spawn the keeper process via `node <path>/keeper.cjs <sessionId>` (detached)
- **AND** the keeper SHALL spawn `pi --mode rpc` as its child with `cwd` and `PI_DASHBOARD_SPAWNED=1` in env
- **AND** the keeper SHALL listen on `<homedir>/.pi/dashboard/sessions/<sessionId>.rpc.sock` (Unix) or `\\.\pipe\pi-rpc-<sessionId>` (Windows)
- **AND** no legacy `tail -f /dev/null` shell wrapper SHALL be invoked
- **AND** no direct-stdin pipe from the dashboard server to pi SHALL be opened on Windows

#### Scenario: Tmux spawn does not use keeper
- **WHEN** `spawnPiSession(cwd, {strategy: "tmux"})` is called
- **THEN** the existing tmux spawn behavior SHALL be used unchanged
- **AND** no keeper SHALL be spawned for tmux sessions

#### Scenario: Headless spawn fresh session
- **WHEN** `spawnPiSession(cwd, { strategy: "headless" })` is called with no sessionFile
- **THEN** the keeper SHALL spawn `pi --mode rpc` with `cwd` set and `PI_DASHBOARD_SPAWNED=1` in env
- **AND** `spawnPiSession` SHALL return `{ success: true, message: "...", pid: <keeper PID> }`

#### Scenario: Headless spawn with continue
- **WHEN** `spawnPiSession(cwd, { strategy: "headless", sessionFile: "...", mode: "continue" })` is called
- **THEN** the keeper SHALL spawn `pi --mode rpc --session <sessionFile>`

#### Scenario: Headless spawn with fork
- **WHEN** `spawnPiSession(cwd, { strategy: "headless", sessionFile: "...", mode: "fork" })` is called
- **THEN** the keeper SHALL spawn `pi --mode rpc --fork <sessionFile>`

#### Scenario: Tmux spawn unchanged
- **WHEN** `spawnPiSession(cwd, { strategy: "tmux" })` or `spawnPiSession(cwd)` is called
- **THEN** existing tmux spawn behavior SHALL be used unchanged

#### Scenario: Tmux command escapes cwd with special characters
- **WHEN** `buildTmuxCommand` is called with a `cwd` containing shell metacharacters (e.g., spaces, semicolons, backticks)
- **THEN** the `cwd` SHALL be shell-escaped in the generated command string to prevent command injection

#### Scenario: Tmux command escapes sessionFile with special characters
- **WHEN** `buildTmuxCommand` is called with a `sessionFile` containing shell metacharacters
- **THEN** the `sessionFile` SHALL be shell-escaped in the generated command string to prevent command injection
