# dashboard-server — delta

## ADDED Requirements

### Requirement: Spawn environment guarantees Windows System paths on PATH
On Windows, every child process spawned via `ToolResolver.buildSpawnEnv()` SHALL receive an environment whose `PATH` contains, at minimum, the following canonical Windows system directories — regardless of what was present in the inherited PATH from the parent process:

- `%SYSTEMROOT%\System32` (where.exe, tasklist.exe, taskkill.exe, cmd.exe)
- `%SYSTEMROOT%` (notepad.exe, regedit.exe)
- `%SYSTEMROOT%\System32\Wbem` (wmic.exe on systems where it is installed)
- `%SYSTEMROOT%\System32\WindowsPowerShell\v1.0` (powershell.exe)
- `%SYSTEMROOT%\System32\OpenSSH` (ssh.exe — when present)
- `%LOCALAPPDATA%\Microsoft\WindowsApps` (winget-installed shims)

Each directory SHALL be added to PATH only if it physically exists on disk AND is not already present in PATH (case-insensitive substring match per Windows PATH semantics). The helper SHALL be idempotent — calling it twice on the same env returns an env identical to a single call.

#### Scenario: Naked inherited PATH gets System32 restored
- **WHEN** Electron inherits a PATH that lacks `C:\Windows\System32` (e.g. launched from a corporate-policy-restricted environment, a stripped-env shortcut, or a portable .exe extraction)
- **THEN** the child process spawned via `buildSpawnEnv` SHALL receive a PATH that includes `C:\Windows\System32` as one of its leading entries
- **AND** `spawnSync("where", ["powershell"])` from that child SHALL succeed

#### Scenario: Existing System32 not duplicated
- **WHEN** the inherited PATH already contains `C:\Windows\System32` (the common case for terminal-launched apps)
- **THEN** the child's PATH SHALL contain exactly one occurrence of `C:\Windows\System32`
- **AND** the original PATH ordering SHALL be preserved for non-prepended entries

#### Scenario: Non-Windows hosts unaffected
- **WHEN** the helper runs on `darwin` or `linux`
- **THEN** the returned environment SHALL be identical to the input
- **AND** SHALL NOT add any Windows-specific paths

#### Scenario: Missing-on-disk paths skipped
- **WHEN** a candidate directory like `C:\Windows\System32\OpenSSH` does not exist on the host (older Windows builds)
- **THEN** the helper SHALL NOT add that path to PATH
- **AND** the absence SHALL NOT block adding the other present candidates

#### Scenario: Settings → Tools resolves system tools
- **WHEN** the user opens Settings → Tools on a Windows install whose inherited PATH lacked System32
- **THEN** the rows for `powershell`, `tasklist`, `taskkill` SHALL show ✓ with absolute paths under `C:\Windows\System32\`
- **AND** the rows for `wmic` SHALL show ✓ on Win 10 / pre-22H2 (where wmic exists on disk), or be absent on Win 11 22H2+ (where the binary is removed)

#### Scenario: Bridge process-scanner functions
- **WHEN** the bridge extension (running inside a pi session spawned by the dashboard) calls `scanWindowsProcesses(parentPid)`
- **THEN** the call SHALL successfully invoke either `wmic` (where present) or its `Get-CimInstance` PowerShell fallback
- **AND** SHALL return a non-empty `ChildProcessInfo[]` for any pi process with child processes
- **AND** SHALL NOT silently return `[]` due to PATH-lookup failure
