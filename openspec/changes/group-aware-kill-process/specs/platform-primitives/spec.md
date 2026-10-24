## MODIFIED Requirements

### Requirement: Process primitive (kill, find-port, is-alive)
The `platform/process.ts` module SHALL expose:
- `findPortHolders(port, opts?)` — `netstat -ano` on Windows, `lsof -t -i :<port> -sTCP:LISTEN` on Unix; returns PIDs (excluding self) or `[]` on failure
- `killProcess(pid, opts?)` — `taskkill /F /T /PID` on Windows (tree kill); on Unix `SIGTERM` → `SIGKILL` to the process group (`-pid`) when `pid` leads its own group that is not the caller's, else to `pid` alone
- `isProcessAlive(pid)` — cross-platform via `process.kill(pid, 0)` (semantics identical on all OSes)
- `killPidWithGroup(pid, signal, opts?)` — Unix signals the process group (`-pid`), Windows targets the pid directly

#### Scenario: killProcess uses taskkill on Windows
- **WHEN** `killProcess(12345, { platform: "win32", exec: fake })` is called
- **THEN** it SHALL invoke `taskkill /F /T /PID 12345`
- **AND** SHALL NOT invoke `process.kill(12345, "SIGTERM")`

#### Scenario: killPidWithGroup signals the process group on Unix
- **WHEN** `killPidWithGroup(12345, "SIGTERM", { platform: "linux", kill: fakeKill })` is called
- **THEN** `fakeKill` SHALL be called with `(-12345, "SIGTERM")`

#### Scenario: killPidWithGroup targets the pid directly on Windows
- **WHEN** `killPidWithGroup(12345, "SIGTERM", { platform: "win32", kill: fakeKill })` is called
- **THEN** `fakeKill` SHALL be called with `(12345, "SIGTERM")` (positive pid)

#### Scenario: findPortHolders falls back silently on parse failure
- **WHEN** `netstat` output cannot be parsed (unexpected format, permission error, empty output)
- **THEN** `findPortHolders(port, { platform: "win32" })` SHALL return `[]` without throwing
