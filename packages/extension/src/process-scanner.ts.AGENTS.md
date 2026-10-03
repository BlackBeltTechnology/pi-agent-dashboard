# process-scanner.ts — index

Detect child processes of a pi session. Exports `getOwnPgid`, `parseProcessSnapshot`, `scanFromSnapshot`, `scanChildProcesses`, `scanChildProcessesAsync`, `killProcessByPgid`, `killWindowsProcess`, `ChildProcessInfo`, `ProcRow`, `ScanOptions`, `SpawnSyncFn`, `parseEtime`.
One snapshot per scan: Unix `ps -A -o pid=,ppid=,pgid=,etime=,args=`; Windows one `Get-CimInstance Win32_Process | ConvertTo-Json`. Tree, leaf-only rule, tracked-PGID liveness and exclusion reaping derive in memory (pure `scanFromSnapshot`; Windows twin private). `args` may be empty (zombie) without dropping the tree edge. Windows applies `excludedPgids` by PID, no shell-wrapper name filter. Failure → `[]`, `trackedPgids` untouched. Sync + async twins share parser/decision code and bump poll-cost counters. `captureChildPgids`/`scanTrackedProcesses`/`scanWindowsProcesses` removed. Resolves system tools via global tool registry.
See change: optimize-polling-hot-paths.
