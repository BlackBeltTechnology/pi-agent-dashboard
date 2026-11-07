## MODIFIED Requirements

### Requirement: Active git/bash source is observable via API and UI

The server SHALL expose the resolved active source via `/api/health`
and reflect it in the Settings panel "Currently active" readout and in
Diagnostics. The reported shell path SHALL be the shell pi-coding-agent
would resolve for a child spawned now: `%ProgramFiles%\Git\bin\bash.exe`,
then `%ProgramFiles(x86)%\Git\bin\bash.exe`, then the first existing
`bash.exe` along the spawn env's PATH (after bundled-git augmentation).
Existence SHALL be judged as pi ≥ 1.5.0 judges it (`access(F_OK)`, so a
runnable Store alias counts). The resolved shell SHALL be classified as
the WSL launcher as pi (since 1.4.0) classifies it: when the spawn env sets
`SystemRoot`, exactly `<SystemRoot>\System32\bash.exe` or
`<SystemRoot>\Sysnative\bash.exe` (case-insensitive, after Windows path
normalization), and never when `SystemRoot` is not drive-absolute; only
when `SystemRoot` is unset, `<drive>:\Windows\System32\bash.exe` or
`<drive>:\Windows\Sysnative\bash.exe`.
A file named `sh.exe`, or a bundled path that does not exist, SHALL NOT
be reported as the shell.

#### Scenario: /api/health reports git source on Windows

- **WHEN** `GET /api/health` is called against a Windows server
- **THEN** the response SHALL include a `gitSource` object with
  `{ setting, source: "host" | "bundled", gitPath, gitVersion,
  shellPath, bashSetting, shellIsWslLauncher }`

#### Scenario: /api/health omits gitSource on non-Windows

- **WHEN** `GET /api/health` is called against a macOS or Linux server
- **THEN** the response SHALL carry no git-source data: the `gitSource`
  field SHALL be absent or `null`

#### Scenario: Bundled bash path is bash.exe

- **WHEN** the source is `"bundled"`, `windowsBashSource` is
  `"bundled"`, no Git for Windows exists under `%ProgramFiles%` /
  `%ProgramFiles(x86)%`, and the bundle contains `usr\bin\bash.exe`
- **THEN** `shellPath` SHALL be the bundle's `usr\bin\bash.exe`

#### Scenario: Git for Windows outranks the bundle

- **WHEN** the source is `"bundled"` AND
  `%ProgramFiles%\Git\bin\bash.exe` exists
- **THEN** `shellPath` SHALL be `%ProgramFiles%\Git\bin\bash.exe`

#### Scenario: Bundle missing bash.exe is not reported as bundled bash

- **WHEN** the source is `"bundled"` AND the bundle has `usr\bin\sh.exe`
  but no `usr\bin\bash.exe`
- **THEN** `shellPath` SHALL NOT point into the bundle
- **AND** when no other `bash.exe` resolves, `shellPath` SHALL be `null`
  and the Doctor bash row SHALL NOT be `ok`

#### Scenario: Doctor warns when pi would pick the WSL launcher unasked

- **WHEN** the resolved shell is classified as the WSL launcher
  (`<SystemRoot>\System32\bash.exe` or `<SystemRoot>\Sysnative\bash.exe`,
  or `<drive>:\Windows\…` when `SystemRoot` is unset) AND
  `windowsBashSource` is not `"host"`
- **THEN** the Doctor bash row SHALL be a `warning` stating that pi
  would run commands through the WSL launcher
- **AND** when the source is `"bundled"` and the bundle lacks
  `usr\bin\bash.exe`, the remedy SHALL be to update or reinstall the
  dashboard app
- **AND** when the source is `"host"`, the remedy SHALL be to install
  Git for Windows or set `windowsGitSource` to `"bundled"`

#### Scenario: Host bash requested but bundled bash used

- **WHEN** `windowsBashSource` is `"host"` AND the resolved shell is
  the bundle's `usr\bin\bash.exe` (no host `bash.exe` found)
- **THEN** the Doctor bash row SHALL be `ok` with a detail stating
  that host bash was requested, none was found, and the bundled bash is
  used

#### Scenario: Explicit host choice of the WSL launcher is not a warning

- **WHEN** the resolved shell is the WSL launcher AND
  `windowsBashSource` is `"host"`
- **THEN** the Doctor bash row SHALL be `ok` with a detail noting that
  an installed WSL distro is required

#### Scenario: Settings UI hidden on non-Windows

- **WHEN** the Settings panel renders on a `darwin` or `linux` server
- **THEN** the "Git & Bash source" select field SHALL NOT appear in the
  DOM

#### Scenario: Settings UI shows live active source on Windows

- **WHEN** the Settings panel renders on a Windows server
- **THEN** the "Currently active" readout SHALL display the active
  source name, the resolved git path and version, and the resolved
  shell path

#### Scenario: WSL-launcher classification follows SystemRoot

- **WHEN** the spawn env has `SystemRoot=D:\WINNT` and the resolved
  shell is `D:\WINNT\System32\bash.exe`
- **THEN** `shellIsWslLauncher` SHALL be `true`
- **AND** with the same `SystemRoot`, a resolved
  `C:\Windows\System32\bash.exe` SHALL report `shellIsWslLauncher: false`
- **AND** with `SystemRoot` unset, `C:\Windows\System32\bash.exe` SHALL
  report `shellIsWslLauncher: true`
