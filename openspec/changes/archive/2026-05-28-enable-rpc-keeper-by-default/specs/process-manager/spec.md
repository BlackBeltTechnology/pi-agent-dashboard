## MODIFIED Requirements

### Requirement: Spawn pi session supports headless strategy
The `spawnPiSession` function SHALL accept an optional `strategy` parameter (`"tmux" | "headless" | "wt" | "wsl-tmux"`). When `"headless"`, `spawnPiSession` SHALL spawn the keeper sidecar (see `rpc-keeper-sidecar` capability) instead of spawning pi directly. The keeper SHALL spawn pi as its own child. The keeper path is unconditional — there is no flag to opt out.

When the strategy is `"tmux"`, `"wt"`, or `"wsl-tmux"`, `spawnPiSession` SHALL retain existing behavior unchanged. These strategies do not use the keeper because pi's stdin is owned by the user's terminal, not by the dashboard.

The `buildTmuxCommand` function SHALL continue to shell-escape `cwd` and `sessionFile` parameters using `shellEscape()`.

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

## REMOVED Requirements

### Requirement: Headless spawn fallback to legacy non-keeper path

**Reason:** The keeper path has had one full release cycle of soak time (v0.5.3 → v0.5.4) without regressions. Maintaining a parallel non-keeper spawn branch doubles the test matrix, leaves Windows on a known-broken durability footing (pi dies on every dashboard server restart), and rewards users with a worse experience than the default. The legacy Unix shell-wrapper branch (`sh -c "tail -f /dev/null | pi --mode rpc"`) and the Windows direct-stdin pipe branch are deleted from `process-manager.ts`. The `shouldUseRpcKeeper()` reader and `_setUseRpcKeeperOverrideForTests` test hook are also removed.

**Migration:** Users who had `useRpcKeeper: false` set in `~/.pi/dashboard/config.json` may delete that line. The field is now ignored. The keeper path becomes the unconditional behavior for `strategy: "headless"`. Anyone needing the legacy behavior may downgrade to v0.5.4 or earlier — but the legacy Windows branch loses pi on every dashboard server restart and is not recommended.
