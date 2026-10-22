## MODIFIED Requirements

### Requirement: Server-side PTY management
The server SHALL spawn PTY processes using node-pty with the user's default shell (detected from `$SHELL` environment variable). Each PTY SHALL have an associated 256KB ring buffer for output replay. A creation request SHALL be refused, with no PTY spawned, when a terminal cap defined by the `server-capability-bounds` capability is reached. A standalone terminal's cwd SHALL be admitted against the known folders (session cwds plus pinned directories) with the shared asynchronous cwd admission (`admitCwd`) before spawn. A terminal attached to a session (inline) SHALL spawn in that session's own cwd as recorded by the server's session manager and SHALL ignore any client-supplied cwd; a request naming an unknown session SHALL be refused. Every refusal other than a cap SHALL send the requesting socket only a `terminal_error` message `{ type: "terminal_error", code: "cwd_not_admitted" | "cwd_admission_unavailable" | "session_not_found", cwd: string, inline: boolean, message: string }` and spawn no PTY; the browser SHALL show it as a dismissible notice (as for `terminal_limit_reached`). The terminal caps SHALL be re-checked after the asynchronous admission completes (or a slot reserved synchronously before it), so concurrent requests cannot exceed a cap. A standalone cwd that is not a non-empty absolute string SHALL be refused with `cwd_not_admitted`; an inline request whose session has no recorded cwd SHALL be refused with `cwd_not_admitted`; an unexpected failure during admission or spawn SHALL be refused with `cwd_admission_unavailable`. Admission SHALL be decided first: a refused cwd gets `terminal_error` even when a cap is also reached, and the cap SHALL be re-checked after a successful admission. When the requesting socket closes before admission completes, no PTY SHALL be spawned. In the browser, a newer terminal notice SHALL replace an older one. Handler promises SHALL be handled by the caller so a failure never becomes an unhandled rejection.

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

#### Scenario: Standalone terminal in a known folder
- **WHEN** a standalone terminal is requested with a cwd that is a session cwd or a pinned directory
- **THEN** the server SHALL spawn the PTY in that cwd

#### Scenario: Standalone terminal in an unknown folder is refused
- **WHEN** a standalone terminal is requested with a cwd that is neither a session cwd nor a pinned directory
- **THEN** the server SHALL NOT spawn a PTY
- **AND** the requesting socket SHALL receive `terminal_error` with `code: "cwd_not_admitted"` and the browser SHALL show a dismissible notice

#### Scenario: Indeterminate admission is not an admission
- **WHEN** admission for a standalone terminal cwd is `indeterminate`
- **THEN** the server SHALL NOT spawn a PTY and the requesting socket SHALL receive `terminal_error` with `code: "cwd_admission_unavailable"`

#### Scenario: Concurrent creations cannot pass the cap
- **WHEN** two standalone terminal requests whose admission is still pending both arrive while only one slot below the cap remains
- **THEN** at most one PTY SHALL be spawned and the other requester SHALL receive `terminal_limit_reached`

#### Scenario: Inline terminal ignores client cwd
- **WHEN** an inline terminal for session `s1` is requested with a client-supplied cwd that differs from `s1`'s cwd
- **THEN** the PTY SHALL spawn in `s1`'s own cwd

#### Scenario: Inline terminal for an unknown session is refused
- **WHEN** an inline terminal is requested for a session id the server does not know
- **THEN** the server SHALL NOT spawn a PTY and the requesting socket SHALL receive `terminal_error` with `code: "session_not_found"`

#### Scenario: Invalid standalone cwd is refused
- **WHEN** a standalone terminal is requested with a cwd that is not a string, is empty, or is a relative path
- **THEN** the server SHALL NOT spawn a PTY and the requesting socket SHALL receive `terminal_error` with `code: "cwd_not_admitted"`

#### Scenario: Inline session without a recorded cwd is refused
- **WHEN** an inline terminal is requested for a known session that has no recorded cwd
- **THEN** the server SHALL NOT spawn a PTY and the requesting socket SHALL receive `terminal_error` with `code: "cwd_not_admitted"`

#### Scenario: Unexpected admission or spawn failure
- **WHEN** admission or spawn throws unexpectedly for a terminal request
- **THEN** the requesting socket SHALL receive `terminal_error` with `code: "cwd_admission_unavailable"` and no unhandled rejection SHALL occur

#### Scenario: Refused cwd wins over a reached cap
- **WHEN** a standalone terminal is requested with a non-admitted cwd while a terminal cap is reached
- **THEN** the requesting socket SHALL receive `terminal_error` with `code: "cwd_not_admitted"`, not `terminal_limit_reached`

#### Scenario: Requester disconnects during admission
- **WHEN** the requesting socket closes while admission is pending
- **THEN** no PTY SHALL be spawned for that request

#### Scenario: Newer terminal notice replaces the older one
- **WHEN** a second terminal notice arrives while an earlier one is still shown
- **THEN** the browser SHALL show only the newer notice
