## MODIFIED Requirements

### Requirement: Windows electron builds embed git + bash via dugite-native

Every electron build leg targeting `platform: win32` that produces a
runnable bundle (not `--source-only`) SHALL fetch a pinned
`desktop/dugite-native` GitHub Release tarball matching the target arch,
verify it against a SHA-256 recorded in
`packages/electron/scripts/_git-version.json`, and extract it to
`packages/electron/resources/git/` before `electron:make` runs. After
extraction the leg SHALL provide `resources/git/usr/bin/bash.exe` as a
byte-identical copy of the tarball's `usr/bin/sh.exe` (unless the
tarball already ships `usr/bin/bash.exe`), keeping `usr/bin/sh.exe` in
place. Builds targeting `darwin` or `linux` SHALL NOT fetch or extract
the tarball.

#### Scenario: Win32 x64 build embeds matching x64 git tarball

- **WHEN** the `_electron-build.yml` matrix leg with
  `platform=win32, arch=x64` runs `bundle-server.mjs`
- **THEN** `packages/electron/resources/git/cmd/git.exe`,
  `packages/electron/resources/git/usr/bin/sh.exe`,
  `packages/electron/resources/git/usr/bin/bash.exe`, and
  `packages/electron/resources/git/THIRD-PARTY-LICENSE.txt` SHALL all
  exist before the `electron:make` step is invoked

#### Scenario: Win32 arm64 build embeds matching arm64 git tarball

- **WHEN** the matrix leg with `platform=win32, arch=arm64` runs
- **THEN** the same four paths SHALL exist, sourced from the
  `dugite-native-v<tag>-windows-arm64.tar.gz` tarball (not the x64 one)

#### Scenario: bash.exe is a copy of sh.exe

- **WHEN** the tarball ships `usr/bin/sh.exe` but no `usr/bin/bash.exe`
- **THEN** after extraction `usr/bin/bash.exe` SHALL exist with the same
  bytes as `usr/bin/sh.exe`
- **AND** `usr/bin/sh.exe` SHALL still exist

#### Scenario: macOS and Linux builds do NOT embed git

- **WHEN** any matrix leg with `platform in {darwin, linux}` runs
- **THEN** `packages/electron/resources/git/` SHALL NOT exist in the
  produced artifact
- **AND** no network fetch for a `dugite-native` tarball SHALL occur on
  that leg

#### Scenario: SHA-256 mismatch fails the build

- **WHEN** the downloaded tarball's SHA-256 does not match the value
  recorded in `_git-version.json` for the target arch
- **THEN** `download-git-windows.mjs` SHALL exit non-zero before
  extraction
- **AND** the leg SHALL fail with a clear "checksum mismatch — refusing
  to extract" error

#### Scenario: GO/NO-GO guard on incomplete embed

- **WHEN** any of `resources/git/cmd/git.exe`,
  `resources/git/usr/bin/sh.exe`, `resources/git/usr/bin/bash.exe`, or
  `resources/git/THIRD-PARTY-LICENSE.txt` is missing on a win32 target
- **THEN** `bundle-server.mjs` SHALL fail the build with a "bundled git
  GO/NO-GO failed" error listing the missing paths

## ADDED Requirements

### Requirement: Win32 builds prove pi resolves the bundled bash

Every win32 electron build leg that produces a runnable bundle SHALL,
before `electron:make`, run the bundled server's pi-coding-agent shell
resolution in a spawn env built by the bundle's own PATH helpers (no
host Git) and fail the leg unless pi resolves the bundle's
`usr\bin\bash.exe` running in bash mode.

#### Scenario: Bundled bash resolves in bash mode

- **WHEN** the check runs on a win32 leg with the env produced by the
  shipped system-PATH and bundled-git helpers (bundled git source,
  `windowsBashSource: "bundled"`) AND `%ProgramFiles%` /
  `%ProgramFiles(x86)%` pointing at a directory without Git
- **THEN** pi SHALL resolve the bundle's `usr\bin\bash.exe`
- **AND** on a leg whose target arch matches the runner, a command run
  through it SHALL report a non-empty `$BASH_VERSION` with the `posix`
  option `off`

#### Scenario: Host mode resolves the host shell

- **WHEN** the check runs with the same env but `windowsBashSource:
  "host"` AND a stand-in host directory holding a `bash.exe` is on the
  inherited PATH
- **THEN** pi SHALL resolve the stand-in's `bash.exe`, not the bundle's

#### Scenario: Dashboard readout agrees with pi

- **WHEN** the check runs in either mode
- **THEN** the dashboard's shell resolution (as shipped in the bundle)
  SHALL return the same path pi resolved

#### Scenario: Cross-arch leg checks resolution only

- **WHEN** the target arch differs from the runner arch (win32-arm64
  built on an x64 runner)
- **THEN** the check SHALL still assert that pi resolves the bundle's
  `usr\bin\bash.exe`
- **AND** it SHALL skip executing the shell and log that execution was
  skipped for the cross-arch leg

#### Scenario: Check is Node-native

- **WHEN** the workflow step for the check is defined
- **THEN** it SHALL NOT use `shell: bash`

#### Scenario: Bundle without bash.exe fails the leg

- **WHEN** the bundle lacks `usr\bin\bash.exe` on a win32 leg
- **THEN** the check SHALL exit non-zero naming the shell pi resolved
  instead (or pi's "No bash shell found" error)

#### Scenario: WSL launcher on the runner does not mask the bundle

- **WHEN** the runner has `<SystemRoot>\System32\bash.exe`
- **THEN** the check SHALL pass only if pi resolves the bundled
  `bash.exe`, and SHALL fail if pi resolves the WSL launcher

#### Scenario: Non-Windows legs skip the check

- **WHEN** a `darwin` or `linux` leg runs
- **THEN** the check SHALL not run (or SHALL exit 0 without probing)
