# dashboard-server — delta

## ADDED Requirements

### Requirement: Windows process introspection uses PowerShell Get-CimInstance, not wmic
On Windows, all process and system introspection inside the dashboard codebase SHALL be performed via PowerShell's `Get-CimInstance` cmdlet, not via `wmic.exe`. The `wmic` binary SHALL NOT be invoked from any code path that ships in a release artefact.

This covers, at minimum:
- Virtual-machine detection (`isVirtualMachine` in `packages/shared/src/platform/commands.ts`).
- Editor process command-line resolution (`defaultGetCmdline` in `packages/server/src/editor-pid-registry.ts`).
- Bridge process-scanner descendant lookup (`getWindowsDescendants` in `packages/extension/src/process-scanner.ts`).

Rationale: Windows 11 22H2+ ships without wmic by default. Continued use produces (a) `'wmic' is not recognized as an internal or external command, operable program or batch file.` stderr noise from cmd.exe when wmic is invoked via `execSync` with default stdio, (b) silent feature regression when stderr is suppressed (the call returns null/empty), and (c) red "not found" rows in the Settings → Tools UI for the registered `wmic` tool.

`Get-CimInstance` ships with PowerShell 3.0+ (Windows 8 / Server 2012 onward) and is present on every supported Windows host.

#### Scenario: VM detection works on Win 11 22H2
- **WHEN** `isVirtualMachine()` runs on a Windows 11 22H2 host that is a VMware VM AND `wmic.exe` is absent
- **THEN** the function SHALL return `true`
- **AND** SHALL NOT write any "not recognized" message to the parent process's stderr

#### Scenario: Editor cmdline resolution works on Win 11 22H2
- **WHEN** `defaultGetCmdline(pid)` runs on a Windows 11 22H2 host AND `wmic.exe` is absent
- **THEN** the function SHALL return the actual command line string of the running process
- **AND** SHALL NOT return `null` solely because wmic is missing

#### Scenario: No wmic shell-invocation anywhere in shipped code
- **WHEN** a release artefact's source / dist tree is scanned for `execSync\(.*wmic` or `spawnSync\([^,]*wmic`
- **THEN** zero matches SHALL be found outside of `__tests__` directories

#### Scenario: Settings → Tools row absent
- **WHEN** the user opens Settings → Tools on a Win 11 22H2 install
- **THEN** there SHALL NOT be a row labelled `wmic` with status "Not found"
- **AND** the tool registry SHALL NOT include a `wmic` entry

### Requirement: Process introspection is spawnSync-based, not execSync-based
All Windows process / system introspection calls SHALL use `spawnSync` (argv form, no shell) rather than `execSync` (string command, default shell). When the invoked binary is absent or the cmdlet fails, the failure SHALL be observable via the return value's `status` / `error` fields, NOT leaked to the parent process's inherited stderr.

#### Scenario: Missing binary does not leak to parent stderr
- **WHEN** an introspection call's target binary (e.g. `powershell.exe`) is somehow absent or returns non-zero
- **THEN** the parent process's stderr SHALL NOT receive any output from the failed invocation
- **AND** the function SHALL return its documented "missing / unknown" value (typically `null` or `false`)

#### Scenario: windowsHide honoured end-to-end
- **WHEN** any Windows introspection call runs on a packaged Electron app
- **THEN** no console window flash SHALL be visible to the user
- **AND** the `windowsHide: true` option SHALL be set on every `spawnSync` call performing introspection
