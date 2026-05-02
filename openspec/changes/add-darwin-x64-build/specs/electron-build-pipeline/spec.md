## MODIFIED Requirements

### Requirement: CI build matrix
A GitHub Actions workflow SHALL build Electron installers for all target platforms AND every supported (platform, arch) tuple. The matrix SHALL include exactly one row per published artifact; missing rows are a regression.

#### Scenario: CI produces macOS arm64 DMG
- **WHEN** the CI workflow runs on `macos-14` runner
- **THEN** it SHALL produce a `.dmg` for arm64
- **AND** the matrix row SHALL declare `platform: darwin, arch: arm64, node-arch: arm64`

#### Scenario: CI produces macOS x64 DMG
- **WHEN** the CI workflow runs on `macos-13` runner
- **THEN** it SHALL produce a `.dmg` for x64
- **AND** the matrix row SHALL declare `platform: darwin, arch: x64, node-arch: x64`
- **AND** the row SHALL NOT be omitted on the grounds that `forge.config.ts` declares `packagerConfig.arch: "universal"` — the workflow's `--arch=${{ matrix.arch }}` CLI flag overrides packagerConfig and the universal hint is a no-op in the current pipeline

#### Scenario: CI produces Linux x64 artifacts
- **WHEN** the CI workflow runs on `ubuntu-latest` runner
- **THEN** it SHALL produce an `.AppImage` and `.deb` for x64

#### Scenario: CI produces Linux arm64 artifacts
- **WHEN** the CI workflow runs on `ubuntu-24.04-arm` runner
- **THEN** it SHALL produce a `.deb` for arm64
- **AND** AppImage SHALL be skipped (appimagetool has no arm64 build)

#### Scenario: CI produces Windows x64 NSIS installer
- **WHEN** the CI workflow runs on `windows-latest` runner with `arch: x64`
- **THEN** it SHALL produce an NSIS `.exe` installer, a ZIP archive, and a portable `.exe`

#### Scenario: CI produces Windows arm64 ZIP and portable
- **WHEN** the CI workflow runs on `windows-latest` runner with `arch: arm64`
- **THEN** it SHALL produce a ZIP archive and a portable `.exe`
- **AND** NSIS SHALL be skipped (no arm64 cross-compile path)

#### Scenario: CI installs Linux build dependencies
- **WHEN** the CI workflow runs on any Linux runner
- **THEN** it SHALL install `dpkg`, `fakeroot`, `libarchive-tools`, `libfuse2`, and `squashfs-tools` before building

#### Scenario: Per-(platform, arch) artifact upload
- **WHEN** any matrix row completes successfully
- **THEN** its artifacts SHALL be uploaded with name `electron-${platform}-${arch}` so the `github-release` job can collect every distributable

### Requirement: Local builder produces correct artifacts across arches
The local-build helper `packages/electron/scripts/build-installer.sh` SHALL produce arch-correct macOS DMGs when invoked back-to-back with different `--arch` values, without requiring the user to manually clean intermediate caches between runs.

#### Scenario: Stale-arch caches are invalidated automatically
- **WHEN** `build-installer.sh` runs on darwin with a requested arch that differs from the previously-built arch (tracked via `resources/.last-arch` sentinel)
- **THEN** it SHALL delete `resources/node/`, `resources/server/`, and `resources/offline-packages/` (when present) before re-running the corresponding bundle steps
- **AND** it SHALL update the sentinel after the bundle completes

#### Scenario: Cross-arch native modules built via Rosetta
- **WHEN** `build-installer.sh` runs on an Apple Silicon host (`uname -m` = `arm64`) with `--arch x64`
- **THEN** it SHALL verify Rosetta 2 is installed by probing `arch -x86_64 /usr/bin/true` and exit non-zero with an actionable error message (`softwareupdate --install-rosetta --agree-to-license`) if the probe fails
- **AND** it SHALL invoke `bundle-server.sh` under `arch -x86_64` so that npm installs x64 prebuilt binaries (notably node-pty's `prebuilds/darwin-x64/pty.node`)

#### Scenario: Intel host cannot cross-build arm64 locally
- **WHEN** `build-installer.sh` runs on an Intel host (`uname -m` = `x86_64`) with `--arch arm64`
- **THEN** it SHALL exit non-zero with a clear message that Intel hosts cannot cross-build arm64 locally (Rosetta is one-way) and recommend using CI for arm64 validation

#### Scenario: --mac-both produces both DMGs in one run
- **WHEN** `build-installer.sh --mac-both` runs on an Apple Silicon host
- **THEN** it SHALL build the arm64 DMG, invalidate per-arch caches, build the x64 DMG, and emit a final smoke summary listing both output files with their Mach-O arch tags from `file`
- **AND** it SHALL fail fast on Intel hosts and on non-darwin hosts with a clear error message
