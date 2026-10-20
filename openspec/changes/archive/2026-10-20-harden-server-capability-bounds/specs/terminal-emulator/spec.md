## MODIFIED Requirements

### Requirement: Server-side PTY management
The server SHALL spawn PTY processes using node-pty with the user's default shell (detected from `$SHELL` environment variable). Each PTY SHALL have an associated 256KB ring buffer for output replay. A creation request SHALL be refused, with no PTY spawned, when a terminal cap defined by the `server-capability-bounds` capability is reached.

#### Scenario: Shell detection
- **WHEN** a terminal is created
- **THEN** the server uses the value of `$SHELL` to determine the shell binary
- **THEN** if `$SHELL` is not set, it falls back to `/bin/bash`

#### Scenario: PTY spawn
- **WHEN** a terminal creation request is received and no terminal cap is reached
- **THEN** the server spawns a PTY with node-pty in the requested cwd
- **THEN** the PTY inherits the server's environment variables
- **THEN** the terminal is assigned an ID with `term-` prefix

#### Scenario: PTY spawn refused at a cap
- **WHEN** a terminal creation request is received and a terminal cap is reached
- **THEN** the server SHALL NOT spawn a PTY
- **AND** the requesting socket SHALL receive `terminal_limit_reached` and the terminals view SHALL show a dismissible notice naming the scope and limit
