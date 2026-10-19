## Purpose
Install, update, inspect and launch the ArtCraft studio desktop app on macOS and Windows from its upstream GitHub releases, verifying installer authenticity by a pinned platform code signature, and hand files to the installed app.

## ADDED Requirements

### Requirement: Explicit install and update with pinned signature verification
`pi-craft artcraft install [--version <v>]` and `pi-craft artcraft update` SHALL download the host's installer from `storytold/artcraft` releases (macOS on any architecture: the single release asset ending `.app.tar.gz`; Windows x64: the single asset ending `.msi`; other hosts, or zero or several matching assets: exit `69` without downloading) into a staging location and SHALL verify it before installing. macOS: the archive entries are listed before extraction and the install aborts on absolute paths, `..` segments, hard links, special files, or symlinks that are absolute or resolve outside the app bundle (relative in-bundle symlinks are allowed), and the extracted app has a valid strict deep code signature, passes the Gatekeeper execution assessment and is signed by the pinned Team ID. Windows: the installer has a valid Authenticode signature by the pinned publisher. When a SHA-256 is pinned for that version, the digest SHALL also match. When no signing identity is pinned for the host, the commands SHALL refuse before downloading. Any verification failure or refusal SHALL delete the staged files, install nothing and exit `69`. Installation SHALL be per-user (macOS: `~/Applications/ArtCraft.app`; Windows: a per-user MSI install; when the pinned installer metadata marks the ArtCraft msi as per-machine-only, Windows install and update SHALL exit `69` stating so), SHALL happen only on these explicit commands, and on success SHALL record the installed version and path under `<pi agent dir>/artcraft/`. `update` SHALL compare versions as semver after stripping one leading `v`, SHALL install only a newer version, and SHALL report "up to date" with exit `0` otherwise. On Linux, `install`, `update`, `launch` and `open` SHALL exit `69` stating that ArtCraft studio is available for macOS and Windows only, without downloading or launching anything.

#### Scenario: Escaping symlink rejected
- **WHEN** the macOS archive contains a symlink inside the app bundle pointing to `/usr/bin` or outside the bundle
- **THEN** the install aborts before extraction completes, staged files are deleted, and the exit code is `69`

#### Scenario: Wrong signer rejected
- **WHEN** the extracted macOS app is validly signed by a Team ID other than the pinned one
- **THEN** the staged files are deleted, nothing is installed, and the exit code is `69`

#### Scenario: Unsigned installer rejected
- **WHEN** the downloaded Windows `.msi` has no valid Authenticode signature
- **THEN** the staged file is deleted, the OS installer is not invoked, and the exit code is `69`

#### Scenario: No pinned identity
- **WHEN** `pi-craft artcraft install` runs on a host platform with no pinned signing identity
- **THEN** nothing is downloaded and the exit code is `69`

#### Scenario: Pinned digest mismatch
- **WHEN** a SHA-256 is pinned for the requested version and the download's digest differs
- **THEN** the staged files are deleted, nothing is installed, and the exit code is `69`

#### Scenario: Linux host
- **WHEN** `pi-craft artcraft install` runs on Linux
- **THEN** nothing is downloaded, stderr states ArtCraft studio is available for macOS and Windows only, and the exit code is `69`

#### Scenario: Update when current
- **WHEN** `pi-craft artcraft update` runs and the installed version equals the latest release
- **THEN** nothing is downloaded and the command reports up to date with exit `0`

### Requirement: Status, launch and open
`pi-craft artcraft status [--json]` SHALL report the installed version from the install record (or none when the record is absent or its path no longer exists), the latest available version from the cached release lookup (or unknown when nothing is cached), and whether an account session exists, without any network request and without printing any token; `--json` SHALL emit one object with `installed` (version string or `null`), `latest` (version string or `null` when unknown), `session` (boolean) and `mcpEnabled` (boolean). `pi-craft artcraft launch` SHALL start the installed app; `pi-craft artcraft open <file…>` SHALL open the given files in it. `launch` and `open` SHALL fail with exit `1` naming `pi-craft artcraft install` when the app is not installed; `open` SHALL check every argument before launching and SHALL fail with exit `1` without launching anything when no file is given or any argument is not an existing regular file.

#### Scenario: Open without install
- **WHEN** `pi-craft artcraft open frame.png` runs and ArtCraft studio is not installed
- **THEN** nothing is launched, the error names `pi-craft artcraft install`, and the exit code is `1`

#### Scenario: Open a missing file
- **WHEN** `pi-craft artcraft open missing.png` runs and `missing.png` does not exist
- **THEN** nothing is launched and the exit code is `1`

#### Scenario: Status makes no network request
- **WHEN** `pi-craft artcraft status --json` runs with no cached release lookup
- **THEN** no network request is made, the object carries the installed version and `"latest": null`, and it exits `0`
