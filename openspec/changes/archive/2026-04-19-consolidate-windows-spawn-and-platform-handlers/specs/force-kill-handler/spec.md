## MODIFIED Requirements

### Requirement: PID safety check before SIGKILL
Before sending SIGKILL, the server SHALL verify the PID still belongs to a pi-related process. The verification SHALL delegate to `platform/process-identify.ts` `isProcessLikePi(pid)` rather than performing inline `process.platform === "win32"` branching. On Unix, `isProcessLikePi` returns `true` when the process's command line matches `\bpi\b|\bnode\b`; on Windows, it returns `true` unconditionally (Windows pi-ness verification is the responsibility of `headlessPidRegistry`). The handler SHALL NOT contain direct `process.platform` branches.

#### Scenario: PID verified on macOS/Linux
- **WHEN** the server is about to send SIGKILL on `linux` or `darwin`
- **THEN** it SHALL call `isProcessLikePi(pid)` which checks the command line for `pi` or `node`
- **AND** SHALL skip SIGKILL if `isProcessLikePi` returns `false`

#### Scenario: PID verified on Windows
- **WHEN** the server is about to send SIGKILL on `win32`
- **THEN** it SHALL call `isProcessLikePi(pid)` which returns `true`
- **AND** SHALL proceed with SIGKILL (same observable behaviour as today)

#### Scenario: PID check failure is non-fatal
- **WHEN** the process has already exited AND `isProcessLikePi` returns `false` on Unix (or the underlying `ps`/`/proc` command fails)
- **THEN** the server SHALL treat the process as already dead and report success

#### Scenario: No direct platform branches in session-action-handler
- **WHEN** the `no-direct-platform-branch.test.ts` invariant runs
- **THEN** it SHALL NOT include `session-action-handler.ts` in its allowlist
- **AND** the file SHALL have zero `process.platform === "..."` matches

### Requirement: Find headless process by session ID
The server SHALL expose `killHeadlessBySessionId(sessionId)` that attempts to terminate a headless pi agent by its session identifier. The implementation SHALL delegate PID lookup to `platform/process-identify.ts` `findPidByMarker(sessionId)`. On Unix, this scans `ps -eo pid,command` for processes containing both the session ID and the `tail -f /dev/null | pi` / `sleep 2147483647 | pi` sentinel. On Windows, `findPidByMarker` returns `[]` and the handler SHALL return `false` (lookup by session marker is not supported; Windows kill uses the `headlessPidRegistry` path instead, which is wired from the session's stored PID via `session_register`).

#### Scenario: Unix finds and kills headless by session ID
- **WHEN** `killHeadlessBySessionId("session-abc")` is called on Unix AND a matching pi process exists
- **THEN** `findPidByMarker` SHALL return the matching PIDs
- **AND** each PID SHALL be killed with `killPidWithGroup(pid, "SIGTERM")`
- **AND** the function SHALL return `true`

#### Scenario: Unix no match returns false
- **WHEN** `killHeadlessBySessionId("session-missing")` is called on Unix AND no matching process exists
- **THEN** `findPidByMarker` SHALL return `[]`
- **AND** the function SHALL return `false`

#### Scenario: Windows returns false (no command-line lookup)
- **WHEN** `killHeadlessBySessionId("session-abc")` is called on `win32`
- **THEN** `findPidByMarker` SHALL return `[]` without executing any command
- **AND** the function SHALL return `false`
- **AND** the caller SHALL fall back to PID-based kill via `headlessPidRegistry`
