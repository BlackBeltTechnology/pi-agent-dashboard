# photocraft-binary-provisioning Specification

## Purpose
Provision the headless PhotoCraft command-line binary (`photocraft-cli`) for the host platform from the upstream GitHub release on demand: resolve the release version, download the matching asset, verify its checksum, extract it into a versioned cache, and hand back a runnable binary path — without ever installing or launching the desktop application.

## Requirements

### Requirement: Release version resolution
The provisioner SHALL resolve which PhotoCraft release to use from, in precedence order: an explicit binary override (`PHOTOCRAFT_BIN`), a version pin (`PHOTOCRAFT_VERSION`), then the upstream repository's latest non-prerelease release (`storytold/photocraft`). Versions SHALL be normalised by stripping one leading `v` (release tag `v0.7.0` ↔ asset version `0.7.0`). The latest-release lookup result SHALL be cached for 24 hours; an unreadable cache record, or one whose timestamp lies in the future, SHALL be ignored and refetched. When `GITHUB_TOKEN` is set it SHALL be sent as the API bearer credential. Each invocation resolves the version once; a long-running server keeps the version it started with.

#### Scenario: Binary override bypasses provisioning
- **WHEN** `PHOTOCRAFT_BIN` points at an existing executable file
- **THEN** that path is returned as the binary
- **AND** no network request is made and the cache is not touched

#### Scenario: Binary override is not executable
- **WHEN** `PHOTOCRAFT_BIN` points at a directory or a file without execute permission
- **THEN** provisioning fails with an error naming `PHOTOCRAFT_BIN`, the path and the reason

#### Scenario: Binary override points at a missing file
- **WHEN** `PHOTOCRAFT_BIN` is set to a path that does not exist
- **THEN** provisioning fails with an error naming `PHOTOCRAFT_BIN` and the path, and does not fall back to downloading

#### Scenario: Pinned version
- **WHEN** `PHOTOCRAFT_VERSION` is `v0.7.0` (or `0.7.0`)
- **THEN** release `v0.7.0` is used and the latest-release endpoint is not queried

#### Scenario: Latest lookup is cached
- **WHEN** the latest release was resolved less than 24 hours ago
- **THEN** the cached tag is reused without querying the API

#### Scenario: Latest lookup fails but a version is installed
- **WHEN** the latest-release query fails (offline, HTTP 403 rate limit, 5xx) and at least one version is already in the cache
- **THEN** the cached version with the highest semantic version is used, with report `source: "fallback-installed"`
- **AND** a warning is printed to stderr naming the failure and the version used

#### Scenario: Corrupt lookup cache
- **WHEN** the cached latest-release record is not valid JSON
- **THEN** it is ignored and the latest release is queried again

#### Scenario: Latest lookup fails with an empty cache
- **WHEN** the latest-release query fails and no version is cached
- **THEN** provisioning fails with an error naming the HTTP status or network error and suggesting `GITHUB_TOKEN` (for rate limits) or `PHOTOCRAFT_VERSION`/`PHOTOCRAFT_BIN`

### Requirement: Host platform to release asset mapping
The provisioner SHALL map the host OS and CPU architecture to exactly one release asset, and SHALL fail with an "unsupported platform" error naming the OS and architecture for any host outside the table. On linux it SHALL first require glibc ≥ 2.35 (the upstream CLI links glibc 2.35 symbols; musl cannot run it).

| OS | Arch | Asset |
|---|---|---|
| darwin | x64, arm64 | `photocraft-cli-<ver>-macos-universal.zip` |
| linux | x64 | `photocraft-<ver>-linux-x86_64.tar.gz` |
| linux | arm64 | `photocraft-<ver>-linux-aarch64.tar.gz` |
| linux | riscv64 | `photocraft-<ver>-linux-riscv64.tar.gz` |
| win32 | x64 | `photocraft-<ver>-windows-x64-portable.zip` |
| win32 | arm64 | `photocraft-<ver>-windows-arm64-portable.zip` |
| win32 | ia32 | `photocraft-<ver>-windows-x86-portable.zip` |
| freebsd | x64 | `photocraft-<ver>-freebsd-x86_64.tar.gz` |

#### Scenario: Apple silicon resolves the universal CLI zip
- **WHEN** the host is darwin/arm64 and the version is `0.7.0`
- **THEN** the asset is `photocraft-cli-0.7.0-macos-universal.zip`

#### Scenario: Linux x64 resolves the portable tarball
- **WHEN** the host is linux/x64 and the version is `0.7.0`
- **THEN** the asset is `photocraft-0.7.0-linux-x86_64.tar.gz`

#### Scenario: Unsupported host
- **WHEN** the host is linux/s390x
- **THEN** provisioning fails with an error naming `linux` and `s390x` and suggesting `PHOTOCRAFT_BIN`

#### Scenario: Linux C library too old or not glibc
- **WHEN** the host is linux and its C library is musl, or glibc older than 2.35
- **THEN** provisioning fails before any network request with an error naming the detected C library and version, the required glibc ≥ 2.35, and `PHOTOCRAFT_BIN`

#### Scenario: Asset missing from the release
- **WHEN** the resolved release has no asset with the mapped name
- **THEN** provisioning fails with an error naming the release tag and the expected asset name

### Requirement: Checksum verification fails closed
The provisioner SHALL download the release's `SHA256SUMS.txt`, SHALL compute the SHA-256 of the downloaded asset, and SHALL refuse to extract or use the asset unless the sums file contains exactly one entry for that asset whose digest matches. Each entry is a 64-hex digest, whitespace, an optional `*` binary marker, and a file name (a leading `./` ignored; CRLF tolerated).

#### Scenario: Digest matches
- **WHEN** the asset's SHA-256 equals the digest listed for it in `SHA256SUMS.txt`
- **THEN** extraction proceeds

#### Scenario: Digest mismatch
- **WHEN** the computed digest differs from the listed digest
- **THEN** the downloaded file is deleted, nothing is written to the version cache, and provisioning fails with an error showing the expected and actual digests

#### Scenario: Binary-mode marker accepted
- **WHEN** the sums file lists the asset as `<digest> *photocraft-0.7.0-linux-x86_64.tar.gz` and the digest matches
- **THEN** extraction proceeds

#### Scenario: Sums file missing, without an entry, or ambiguous
- **WHEN** `SHA256SUMS.txt` cannot be downloaded, contains no entry for the asset name, or contains two entries for it
- **THEN** provisioning fails and nothing is written to the version cache

### Requirement: Extraction into a versioned cache
The provisioner SHALL list the verified archive's entries before extracting and SHALL abort the install if any entry has an absolute path, a `..` segment, or is a symbolic link, hard link or special file. It SHALL then extract into a staging directory under the cache root, locate the CLI binary — first at the platform's known relative location (`<root>/photocraft-cli` for the macOS zip, `<root>/bin/photocraft-cli` for tarballs, `<root>/photocraft-cli.exe` for Windows zips), else as the single file with that basename outside `__MACOSX` — and move the extracted tree to `<cache root>/<version>/`. The cache root SHALL default to `<pi agent dir>/tools/photocraft` (pi agent dir = `PI_CODING_AGENT_DIR` or `~/.pi/agent`) and SHALL be overridable with `PHOTOCRAFT_HOME`. The binary SHALL be executable after install. Only the binary is ever executed; other bundle contents are kept for the binary's own use.

#### Scenario: Cache hit
- **WHEN** `<cache root>/<version>/` already holds an executable regular file at the binary location for the resolved version
- **THEN** its path is returned without downloading

#### Scenario: Damaged cache entry is re-provisioned
- **WHEN** `<cache root>/<version>/` exists but its binary is missing, empty or not executable
- **THEN** the entry is removed and the version is downloaded and installed again

#### Scenario: Binary not found
- **WHEN** the known location is empty and the extracted tree contains zero, or more than one, file with the binary's basename
- **THEN** the staging directory is removed and provisioning fails naming the asset

#### Scenario: Path-traversal entry
- **WHEN** an archive entry is named `../../x` or `/etc/x`
- **THEN** the install aborts before extraction and nothing is written to the version cache

#### Scenario: Symlink entry
- **WHEN** the archive contains a symbolic-link entry
- **THEN** the install aborts before extraction and nothing is written to the version cache

#### Scenario: Concurrent provisioning of the same version
- **WHEN** two processes provision the same version at the same time on an empty cache
- **THEN** both return a working binary path, the version directory contains exactly one complete install, and the losing process's staging directory is removed

#### Scenario: Interrupted download
- **WHEN** a download is interrupted before completion
- **THEN** no partial file or directory remains under `<cache root>/<version>/`, the run's own staging directory (which also holds the download) is removed, and the next run downloads again
- **AND** a staging directory left by a killed process is removed by a later provisioning run once it is older than one hour

### Requirement: Headless only
The provisioner SHALL never download a desktop installer format (`.dmg`, `.msi`, `.deb`, `.rpm`, `.AppImage`, `.flatpak`) and SHALL never launch the desktop `photocraft` executable.

#### Scenario: Only CLI-bearing archives are fetched
- **WHEN** provisioning runs on any supported host
- **THEN** the only release files requested are the mapped archive and `SHA256SUMS.txt`

### Requirement: Provisioning reports what it did
Each provisioning run SHALL be able to report, as one JSON object: `version` (for an override: the version the binary prints for `--version`, or `null`), `source` (`override`, `pin`, `latest`, `latest-cached`, `fallback-installed`), `asset` (`null` for an override), `cacheHit`, `binary` (absolute path) and `durationMs`. On a macOS install it SHALL additionally record `gatekeeper` — the result of the install-type Gatekeeper assessment of the binary; a rejected assessment SHALL produce a stderr warning but SHALL NOT fail provisioning (integrity is established by the checksum; authenticity is not claimed).

#### Scenario: JSON report on a fresh install
- **WHEN** provisioning installs version `0.7.0` on an empty cache
- **THEN** the report contains `version: "0.7.0"`, `source: "latest"`, the asset name, `cacheHit: false`, the absolute binary path and a duration
