## ADDED Requirements

### Requirement: windowsBashSource setting chooses bundled or host bash

The dashboard config SHALL expose `windowsBashSource: "bundled" | "host"`
(default `"bundled"`) on `~/.pi/dashboard/config.json`. An absent or
unrecognised value SHALL resolve to `"bundled"`. The setting SHALL be a
no-op on macOS/Linux and on Windows whenever the active git source is
`"host"`. A change SHALL apply to newly spawned children only, without a
server restart.

#### Scenario: Default is bundled

- **WHEN** `~/.pi/dashboard/config.json` has no `windowsBashSource` key
- **THEN** the resolved effective config SHALL include
  `windowsBashSource: "bundled"`

#### Scenario: Unknown value falls back to bundled

- **WHEN** the config file holds `windowsBashSource: "wsl"`
- **THEN** the resolved effective config SHALL include
  `windowsBashSource: "bundled"`

#### Scenario: No-op when git source is host

- **WHEN** the active git source is `"host"` on win32 AND
  `windowsBashSource` is `"bundled"` or `"host"`
- **THEN** spawned children's PATH SHALL contain no bundled-git entries

#### Scenario: Settings UI exposes the choice on Windows

- **WHEN** the Settings panel renders on a Windows server
- **THEN** a "Bash for agent commands" select field with options
  `bundled` and `host` SHALL appear next to the "Git & Bash source" select field
- **AND** it SHALL stay enabled, with a hint stating that PATH order
  changes only while the active git source is `"bundled"`

#### Scenario: Settings UI hidden on non-Windows

- **WHEN** the Settings panel renders on a `darwin` or `linux` server
- **THEN** the "Bash for agent commands" select field SHALL NOT appear

#### Scenario: Saved value survives a server restart

- **WHEN** `windowsBashSource: "host"` is saved AND the server restarts
- **THEN** the first child spawned after the restart SHALL get PATH
  ordered for `"host"`, without any further config write

#### Scenario: Change applies to new sessions without restart

- **WHEN** the user switches `windowsBashSource` via the config API
- **THEN** the next spawned session or terminal SHALL get PATH ordered
  per the new value
- **AND** already running children SHALL keep their PATH

### Requirement: Bundled shell is resolvable by pi as bash.exe

When the active git source is `"bundled"` and `windowsBashSource` is
`"bundled"` on Windows, the shell pi-coding-agent resolves for its
`bash` tool, user `!` commands and `!cmd` config values SHALL be the
bundled GNU bash, running in bash mode, unless Git for Windows is
installed under `%ProgramFiles%` / `%ProgramFiles(x86)%` (pi prefers
it). The dashboard SHALL NOT add or change `shellPath` in any pi
`settings.json`.

#### Scenario: pi resolves bundled bash without host Git

- **WHEN** a pi session is spawned on win32 with bundled git source and
  `windowsBashSource: "bundled"` AND no
  `%ProgramFiles%\Git\bin\bash.exe` / `%ProgramFiles(x86)%\Git\bin\bash.exe`
  exists
- **THEN** pi SHALL resolve the bundle's `usr\bin\bash.exe`
- **AND** a `bash` tool call SHALL succeed instead of failing with
  "No bash shell found"

#### Scenario: Bundled bash wins over the WSL launcher

- **WHEN** `<SystemRoot>\System32\bash.exe` exists AND the session uses
  bundled git source with `windowsBashSource: "bundled"`
- **THEN** pi SHALL resolve the bundle's `usr\bin\bash.exe`, not the
  WSL launcher

#### Scenario: Host bash chosen explicitly

- **WHEN** the session uses bundled git source with
  `windowsBashSource: "host"` AND `<SystemRoot>\System32\bash.exe` is
  on the inherited PATH
- **THEN** pi SHALL resolve the first host `bash.exe` on PATH (here the
  WSL launcher), not the bundle's
- **AND** bundled `git` SHALL still resolve and run, including
  `#!/bin/sh` hooks

#### Scenario: Host bash requested but none present falls back to bundled

- **WHEN** the session uses bundled git source with
  `windowsBashSource: "host"` AND no host `bash.exe` is on the inherited
  PATH AND no Git for Windows exists under `%ProgramFiles%`
- **THEN** pi SHALL resolve the bundle's `usr\bin\bash.exe`

#### Scenario: Bundled bash runs in bash mode

- **WHEN** a command runs through the resolved bundled shell
- **THEN** `$BASH_VERSION` SHALL be non-empty AND the `posix` shell
  option SHALL be `off`

#### Scenario: Dashboard does not write shellPath

- **WHEN** the dashboard spawns or configures pi sessions on win32
- **THEN** no pi `settings.json` SHALL gain or change a `shellPath` key

## MODIFIED Requirements

### Requirement: ensureBundledGitOnPath prepends bundled tools when active

The helper `ensureBundledGitOnPath(env)` SHALL, when `selectGitSource()`
returns `"bundled"`, place the bundled directories on `env.PATH`
according to `windowsBashSource`:
- `"bundled"`: prepend `resources/git/cmd`, `resources/git/usr/bin`,
  `resources/git/<libdir>/bin` (in that order);
- `"host"`: prepend `resources/git/cmd`, `resources/git/<libdir>/bin`
  (in that order) and append `resources/git/usr/bin` after every
  inherited PATH entry.

In both modes it SHALL set `env.GIT_EXEC_PATH` to
`resources/git/<libdir>/libexec/git-core` and `env.SSL_CERT_FILE` to
`resources/git/ssl/certs/ca-bundle.crt`. The helper SHALL be
idempotent. `<libdir>` SHALL be resolved per-arch (R1 spike): `mingw64`
on win32-x64, `clangarm64` on win32-arm64 — detected by which directory
exists under `resources/git/`, never hardcoded.

#### Scenario: Idempotence

- **WHEN** `ensureBundledGitOnPath` is applied to an env, then applied
  again to the result with the same `windowsBashSource`
- **THEN** the final env SHALL deep-equal the env after a single
  application (no duplicated PATH entries)

#### Scenario: Re-application with a different bash source moves usr/bin

- **WHEN** an env produced with `windowsBashSource: "bundled"` is passed
  again with `windowsBashSource: "host"`
- **THEN** `resources/git/usr/bin` SHALL appear exactly once, as the
  last PATH entry

#### Scenario: Host bash source appends usr/bin

- **WHEN** `windowsBashSource: "host"` AND the source is `"bundled"`
- **THEN** `resources/git/cmd` and `resources/git/<libdir>/bin` SHALL
  precede every inherited entry AND `resources/git/usr/bin` SHALL follow
  every inherited entry

#### Scenario: No-op when source is host

- **WHEN** `selectGitSource()` returns `"host"`
- **THEN** `ensureBundledGitOnPath` SHALL leave `env` unchanged

#### Scenario: Runs AFTER ensureWindowsSystemPath in buildSpawnEnv

- **WHEN** `ToolResolver.buildSpawnEnv` augments a spawn env on win32
- **THEN** `ensureBundledGitOnPath` SHALL run after that method's
  existing `ensureWindowsSystemPath` call so `resources/git/cmd` and
  `resources/git/<libdir>/bin` land before System32 in PATH precedence
  in both modes (bundled git wins lookups when active)
- **AND** `resources/git/usr/bin` SHALL land before System32 only when
  `windowsBashSource` is `"bundled"`

#### Scenario: PTY terminal env receives bundled git

- **WHEN** the terminal-manager spawns a PTY on win32 with
  `selectGitSource()` returning `"bundled"`
- **THEN** the PTY env SHALL include the bundled-git PATH entries placed
  per `windowsBashSource` even though the PTY path does not flow through
  `ToolResolver.buildSpawnEnv` (wired via a direct
  `ensureBundledGitOnPath` call or `getTerminalEnvHints`)
- **AND** `!`/`!!` bang-prefix commands run in that terminal SHALL
  resolve bundled git, and bundled bash when `windowsBashSource` is
  `"bundled"`

### Requirement: Active git/bash source is observable via API and UI

The server SHALL expose the resolved active source via `/api/health`
and reflect it in the Settings panel "Currently active" readout and in
Diagnostics. The reported shell path SHALL be the shell pi-coding-agent
would resolve for a child spawned now: `%ProgramFiles%\Git\bin\bash.exe`,
then `%ProgramFiles(x86)%\Git\bin\bash.exe`, then the first existing
`bash.exe` along the spawn env's PATH (after bundled-git augmentation).
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

- **WHEN** the resolved shell is `<drive>:\Windows\System32\bash.exe`
  or `<drive>:\Windows\Sysnative\bash.exe` AND `windowsBashSource` is
  not `"host"`
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
