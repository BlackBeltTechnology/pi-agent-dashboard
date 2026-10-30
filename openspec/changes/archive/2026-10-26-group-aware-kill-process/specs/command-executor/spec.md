## MODIFIED Requirements

### Requirement: Cross-platform tree termination uses killProcess
Code that needs to terminate a spawned session, editor, tunnel, or any process whose descendants MUST also be terminated SHALL use `killProcess(pid, opts)` from the platform module. On Windows this SHALL invoke `taskkill /F /T /PID <pid>`; on POSIX, when `pid` leads its own process group and that group is not the caller's own group, `killProcess` SHALL delegate to `killProcessGroup(pid, opts)` so the process's descendants in that group are terminated with it (parity with the Windows tree kill); otherwise it SHALL send SIGTERM to `pid`, wait up to `timeoutMs` (default 5000), then SIGKILL if the process is still alive. Group leadership SHALL be detected by an errno-aware signal-0 probe of `-pid` (ESRCH ⇒ not a leader). The caller's own process group SHALL be read once via `ps -o pgid= -p <ownPid>` and cached; when it cannot be determined, `killProcess` SHALL fall back to the single-pid ladder so it never signals the caller's own group.

Code that spawned a process as the leader of its own process group (detached on POSIX) and must also terminate descendants that were not reparented away from that group SHALL use `killProcessGroup(pid, opts)` from the platform module. On POSIX it SHALL send SIGTERM to the group (`-pid`), poll every 200ms until no member of the group is alive or `timeoutMs` (default 5000) elapses, re-check that the group still exists before escalating, and then send SIGKILL to the group. On Windows it SHALL delegate to `killProcess(pid, opts)` (`taskkill /F /T`).

#### Scenario: Windows tree kill
- **WHEN** `killProcess(pid)` is invoked with `platform: "win32"`
- **THEN** the platform SHALL execute `taskkill /F /T /PID <pid>` via the wrapped `execSync`
- **AND** return `{ ok: true, forced: false }` on success

#### Scenario: POSIX escalation path
- **WHEN** `killProcess(pid, { timeoutMs: 2000 })` is invoked with `platform: "linux"` or `platform: "darwin"` on a live PID that does not lead its own process group
- **THEN** the platform SHALL send `SIGTERM` to `pid`
- **AND** poll liveness every 200ms until `timeoutMs` elapses
- **AND** send `SIGKILL` if the process is still alive when the deadline passes
- **AND** return `{ ok: true, forced: true }` when SIGKILL was required

#### Scenario: Already-dead process
- **WHEN** `killProcess(pid)` is invoked for a PID that is not alive
- **THEN** the platform SHALL return `{ ok: false, forced: false }` without sending any signal

#### Scenario: POSIX group escalation reaches workers
- **WHEN** `killProcessGroup(pid, { timeoutMs: 2000 })` is invoked on a group leader whose worker child ignores SIGTERM
- **THEN** the platform SHALL send `SIGTERM` to `-pid`, wait up to `timeoutMs`, and send `SIGKILL` to `-pid`
- **AND** no member of the group SHALL be alive afterwards
- **AND** return `{ ok: true, forced: true }`

#### Scenario: Group already gone before escalation
- **WHEN** every member of the group exits during the SIGTERM wait
- **THEN** no SIGKILL SHALL be sent

#### Scenario: Windows group kill delegates
- **WHEN** `killProcessGroup(pid)` is invoked with `platform: "win32"`
- **THEN** it SHALL behave exactly as `killProcess(pid)`

#### Scenario: POSIX group leader is killed with its group
- **WHEN** `killProcess(pid, { timeoutMs: 2000 })` is invoked on POSIX for a live PID that leads its own process group, and that group is not the caller's
- **THEN** the platform SHALL send `SIGTERM` to `-pid`, and `SIGKILL` to `-pid` if a member is still alive after `timeoutMs`
- **AND** a child of `pid` that ignores `SIGTERM` SHALL NOT be alive afterwards

#### Scenario: Never signal the caller's own group
- **WHEN** `killProcess(pid)` is invoked on POSIX and `pid` equals the caller's own process-group id, or the caller's own process-group id cannot be determined
- **THEN** the platform SHALL signal `pid` only (single-pid ladder) and SHALL NOT signal `-pid`
