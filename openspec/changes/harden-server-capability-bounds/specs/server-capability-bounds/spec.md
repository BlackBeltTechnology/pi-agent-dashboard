## ADDED Requirements

### Requirement: PTY sessions are bounded
The terminal manager SHALL enforce a maximum number of concurrent PTY sessions
(a global cap and a per-cwd cap) and SHALL reject a `create_terminal` request that
would exceed a cap. The manager SHALL reap idle or detached terminals so orphaned
shells do not accumulate.

#### Scenario: create_terminal rejected over the cap
- **WHEN** the global concurrent-PTY cap is already reached and a client requests another terminal
- **THEN** the request SHALL be rejected without spawning a new shell

#### Scenario: idle terminal reaped
- **WHEN** a terminal has been detached/idle beyond the reaper threshold
- **THEN** its PTY process and buffer SHALL be released

#### Scenario: normal multi-terminal use unaffected
- **WHEN** a user opens a handful of terminals below the cap
- **THEN** all SHALL spawn normally

### Requirement: Directory browse and mkdir are confined to allowed roots
The browse and mkdir endpoints SHALL confine their operations to an allowed root
set (`$HOME` plus configured pinned directories). This applies to `/api/browse`,
`/api/browse/mkdir`, and `/api/browse/flags`. A request whose resolved path
escapes the allowed roots SHALL be rejected, and `mkdir` SHALL create directories
only inside those roots.

#### Scenario: enumeration above allowed roots rejected
- **WHEN** a request calls `/api/browse?path=/`
- **THEN** the endpoint SHALL reject it (path outside allowed roots)

#### Scenario: mkdir outside allowed roots rejected
- **WHEN** `/api/browse/mkdir` targets a parent outside `$HOME` and pinned dirs
- **THEN** the endpoint SHALL reject it and create nothing

#### Scenario: browsing an allowed workspace succeeds
- **WHEN** a request browses a directory under `$HOME` or a pinned dir
- **THEN** the endpoint SHALL list it (folder-picker UX preserved)

### Requirement: Recovery server binds loopback and gates mutating actions
The recovery server SHALL bind to the configured host (loopback by default), not
all interfaces, and SHALL gate its mutating actions (`/api/recovery/reinstall`,
`/api/recovery/retry`) on a loopback or local-token check. Unauthenticated remote
requests to those actions SHALL be rejected.

#### Scenario: recovery bound to loopback
- **WHEN** the recovery server starts with the default host
- **THEN** it SHALL listen on loopback only, not `0.0.0.0`/`::`

#### Scenario: remote reinstall rejected
- **WHEN** a non-loopback request without a valid local-token calls `POST /api/recovery/reinstall`
- **THEN** the action SHALL be rejected and no `npm install -g` SHALL run

#### Scenario: local recovery still works
- **WHEN** a loopback request triggers `retry` during a real failure
- **THEN** the action SHALL proceed
