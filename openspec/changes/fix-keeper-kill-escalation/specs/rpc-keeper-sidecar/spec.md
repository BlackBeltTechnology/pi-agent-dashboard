## ADDED Requirements

### Requirement: Keeper SIGKILLs its pi child on shutdown
When the keeper's `shutdown()` function runs — whether triggered by `SIGTERM`, `SIGINT`, `uncaughtException`, or its own `pi-exit` / `pi-stdin-error` observer — the keeper SHALL attempt to terminate its `piChild` via `piChild.kill("SIGKILL")` before calling `process.exit(exitCode)`. The call SHALL be guarded against double-kill: it SHALL be a no-op when `piChild` is undefined, has already exited (`piChild.exitCode !== null`), or has already been signal-killed (`piChild.signalCode !== null`). Exceptions from the `.kill` call (e.g. EPERM, ESRCH on already-dead PID) SHALL be swallowed; `shutdown()` SHALL NOT throw.

This requirement is defence-in-depth alongside the registry-layer SIGKILL escalation in `headless-spawn`. The current contract — "keeper exits → pi reads stdin EOF → pi shuts down voluntarily" — assumes pi's event loop is responsive. For a pi process hung in a CPU loop, a non-cancellable native call, or a deadlocked tool, the stdin EOF is never observed and pi survives the keeper's exit as an orphaned process (reparented to init/launchd on POSIX). Explicit `SIGKILL` from the keeper bypasses the assumption.

The keeper SHALL NOT delay its own exit waiting for pi to die. The `piChild.kill("SIGKILL")` call is fire-and-forget; the keeper proceeds immediately to `process.exit(exitCode)`. SIGKILL is uninterruptible at the kernel level, so the pi process is guaranteed to terminate even after the keeper has exited.

#### Scenario: Keeper SIGTERM kills hung pi via SIGKILL
- **WHEN** the keeper receives `SIGTERM` from the dashboard server's `killBySessionId` 200 ms fallback AND its `piChild` is hung (event loop blocked, not reading stdin)
- **THEN** the keeper's `shutdown(0, "SIGTERM")` SHALL call `piChild.kill("SIGKILL")` before `process.exit(0)`
- **AND** pi SHALL die from SIGKILL even though it never observed the stdin EOF that the keeper's exit would have produced

#### Scenario: Keeper shutdown after pi already exited is a no-op SIGKILL
- **WHEN** pi exits voluntarily and the keeper's `c.on("exit", ...)` handler calls `shutdown(0, "pi-exit")`
- **THEN** the SIGKILL guard SHALL observe `piChild.exitCode !== null` and skip the `.kill` call
- **AND** no exception SHALL be thrown

#### Scenario: SIGKILL call on race-condition-dead pi swallows ESRCH
- **WHEN** the keeper enters `shutdown()` and pi exits between the `piChild.exitCode === null` guard and the `.kill("SIGKILL")` call
- **THEN** the `try / catch` SHALL absorb the resulting `ESRCH` (or platform-equivalent) error
- **AND** `shutdown()` SHALL proceed to `process.exit(exitCode)`

#### Scenario: SIGINT and uncaughtException paths also kill pi
- **WHEN** the keeper receives `SIGINT` OR an `uncaughtException` triggers `shutdown(1, "uncaughtException")`
- **THEN** the same `piChild.kill("SIGKILL")` guarded call SHALL execute before `process.exit`
- **AND** the keeper SHALL NOT leave pi orphaned regardless of which trigger entered `shutdown()`
