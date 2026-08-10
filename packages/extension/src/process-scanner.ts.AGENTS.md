# process-scanner.ts — index

Detect child processes of a pi session. Exports `getOwnPgid`, `captureChildPgids`, `scanTrackedProcesses`, `scanChildProcesses`, `killProcessByPgid`, `scanWindowsProcesses`, `killWindowsProcess`, `ChildProcessInfo`, `ScanOptions`, `parseEtime`. Unix via ps/PGID two-phase (capture + check); Windows via PowerShell Get-CimInstance. Resolves system tools via global tool registry.
