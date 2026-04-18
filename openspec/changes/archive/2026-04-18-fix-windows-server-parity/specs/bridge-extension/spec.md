## ADDED Requirements

### Requirement: Extension server-launcher captures stderr to log file
The bridge extension's `launchServer` function in `packages/extension/src/server-launcher.ts` SHALL capture stdout and stderr of the spawned server process to `~/.pi/dashboard/server.log` (opened in append mode), rather than using `stdio: "ignore"`. The child SHALL remain detached and `unref`'d.

#### Scenario: Launch failure surfaces in log
- **WHEN** the extension spawns the server and the child process exits immediately with an error (e.g. `ERR_UNSUPPORTED_ESM_URL_SCHEME`, missing loader, port bind failure)
- **THEN** the error output SHALL be appended to `~/.pi/dashboard/server.log`
- **AND** SHALL be readable without re-running the command

#### Scenario: Successful launch still detaches
- **WHEN** the extension spawns the server and it starts successfully
- **THEN** the child SHALL be `unref`'d and the parent pi process SHALL be free to exit without terminating the server

### Requirement: Auto-start failure notification includes log path
When the bridge's `autoStartServer` flow catches a `launchServer` failure, the `ui.notify` message SHALL include the absolute path to `~/.pi/dashboard/server.log` so users can inspect the crash output without prior knowledge of the convention.

#### Scenario: Failure notification surfaces log path
- **WHEN** `launchServer` returns `{ success: false }` or throws during auto-start
- **THEN** `ui.notify` SHALL be called with a message that includes the absolute path `~/.pi/dashboard/server.log` (or its platform-expanded equivalent)
