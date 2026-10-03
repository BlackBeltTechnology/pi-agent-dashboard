# session-process-tracker Specification

## Purpose

Defines how running pi processes are discovered on Windows, where the POSIX scanning approach does not apply.

## Requirements

### Requirement: Windows process scanning
On Windows the process scanner SHALL take exactly ONE process snapshot per scan via PowerShell `Get-CimInstance Win32_Process` selecting `ProcessId`, `ParentProcessId`, `CommandLine` and `CreationDate`, serialised as JSON, and SHALL derive the pi process's children and one level of grandchildren from that snapshot in memory: a child with children is replaced by its children, a childless child is kept, and `minElapsedMs` applies (measured from `CreationDate`). Unlike the Unix scanner, the Windows scanner SHALL NOT filter shell wrappers by command name (unchanged from today). It SHALL NOT launch PowerShell once per child. The PowerShell process SHALL be resolved via `resolveSystemTool("powershell")` and launched with `-NoProfile -NonInteractive` and `windowsHide`. The bridge SHALL use the asynchronous variant so the launch never blocks pi's event loop. PIDs present in `excludedPgids` (on Windows a process's group id is its PID) SHALL be excluded from the result, and excluded entries with no live process in the snapshot SHALL be reaped.

#### Scenario: Scan child processes on Windows
- **WHEN** a scan runs on Windows
- **THEN** it SHALL launch PowerShell exactly once and return `ChildProcessInfo[]` with pid and command (pgid MAY equal pid on Windows)

#### Scenario: Single-process JSON normalised
- **WHEN** the snapshot JSON is a single object rather than an array
- **THEN** the scanner SHALL treat it as a one-element list

#### Scenario: Graceful degradation on missing wmic
- **WHEN** `wmic` is not available (removed in newer Windows 11 builds)
- **THEN** the scanner SHALL be unaffected, because it never uses `wmic` or `tasklist` and relies only on the PowerShell `Get-CimInstance` snapshot

#### Scenario: Snapshot failure
- **WHEN** PowerShell exits non-zero, times out, or prints unparseable JSON
- **THEN** the scan SHALL return an empty array without throwing

#### Scenario: Self-spawned dashboard server hidden on Windows
- **WHEN** the bridge auto-started the dashboard server and registered its PID in `excludedPgids`
- **THEN** that process SHALL NOT appear in the Windows scan result

#### Scenario: Kill process on Windows
- **WHEN** `killProcess(pid)` is called on Windows
- **THEN** it SHALL use `taskkill /PID <pid> /T /F` to terminate the process and its children
