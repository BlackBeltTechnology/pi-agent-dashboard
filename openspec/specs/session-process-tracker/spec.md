# session-process-tracker Specification

## Purpose

Defines how running pi processes are discovered on Windows, where the POSIX scanning approach does not apply.

## Requirements

### Requirement: Windows process scanning
The process scanner SHALL support Windows via `wmic` or `tasklist` instead of returning empty results.

#### Scenario: Scan child processes on Windows
- **WHEN** `scanProcesses()` is called on Windows during an active bash tool call
- **THEN** it SHALL use `wmic process` or `tasklist` to find child processes of the pi session
- **AND** return `ChildProcessInfo[]` with pid (pgid may be omitted on Windows)

#### Scenario: Kill process on Windows
- **WHEN** `killProcess(pid)` is called on Windows
- **THEN** it SHALL use `taskkill /PID <pid> /T /F` to terminate the process and its children

#### Scenario: Graceful degradation on missing wmic
- **WHEN** `wmic` is not available (removed in newer Windows 11 builds)
- **THEN** the scanner SHALL fall back to `tasklist` or `Get-Process` via PowerShell
