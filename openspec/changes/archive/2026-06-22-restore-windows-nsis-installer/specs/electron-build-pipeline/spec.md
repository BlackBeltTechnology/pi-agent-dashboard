## MODIFIED Requirements

### Requirement: NSIS Windows installer
The Windows installer SHALL be produced by `electron-builder --win nsis` extended with a custom include script at `packages/electron/build/installer.nsh` (consumed via electron-builder's `nsis.include` config option). The installer SHALL be a per-user assisted wizard install — NOT a one-click silent install AND NOT a multi-user install — that lets the user choose the install directory. The installer SHALL NOT present an install-mode page and SHALL NOT offer a per-machine ("Install for everyone") option. Installer filename, default install directory, Start Menu shortcut, Apps & Features registry entry, and uninstaller display name SHALL all be pinned explicitly via electron-builder NSIS config so that defaults derived from the npm package name cannot reintroduce mismatches. The `appId` SHALL be `hu.blackbelt.pi-dashboard` and SHALL NOT change once shipped.

#### Scenario: NSIS toolchain
- **WHEN** the Windows installer is built
- **THEN** it SHALL be produced by `npx electron-builder --win nsis --<arch> --config electron-builder-nsis.json`
- **AND** the electron-builder config SHALL reference `packages/electron/build/installer.nsh` via the `nsis.include` option
- **AND** the build SHALL NOT use `@felixrieseberg/electron-forge-maker-nsis` (removed in v0.5.0 and not reintroduced)
- **AND** the build SHALL NOT use `nsis.script` (full script replacement — we extend electron-builder's generated script, not replace it)

#### Scenario: Per-user assisted wizard install
- **WHEN** the user runs Setup.exe
- **THEN** electron-builder NSIS config SHALL set `oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true`, and `allowElevation: true`
- **AND** the config SHALL NOT omit `perMachine` (omission would enable multi-user mode, which is forbidden)
- **AND** the wizard SHALL present, in order: Welcome → Choose Install Location (editable, pre-filled with the per-user default) → Install progress → Finish
- **AND** the wizard SHALL NOT present an install-mode page
- **AND** the Finish page SHALL offer a "Launch PI Dashboard" checkbox (default checked)

#### Scenario: Per-user install (default path)
- **WHEN** the user accepts the default install location
- **THEN** the install SHALL proceed without UAC elevation
- **AND** the default install dir SHALL be `%LOCALAPPDATA%\Programs\PI Dashboard\`
- **AND** the Add/Remove Programs entry SHALL be registered under `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PI Dashboard`
- **AND** the Start Menu shortcut SHALL be created under the user's per-profile Start Menu
- **AND** the installer SHALL NOT write to `HKLM` and SHALL NOT register a per-machine entry

#### Scenario: User-chosen install location
- **WHEN** the user changes the install location in the Choose-Install-Location page (or passes `/D=<path>` on a silent install)
- **THEN** the installer SHALL install to that path
- **AND** the executable SHALL be `<chosen path>\PI Dashboard.exe`
- **AND** the uninstaller SHALL be written to `<chosen path>\Uninstall PI Dashboard.exe`
- **AND** the Add/Remove Programs entry's `InstallLocation` registry value SHALL contain the chosen path

#### Scenario: Start Menu shortcut
- **WHEN** installation completes
- **THEN** a Start Menu shortcut named `PI Dashboard` SHALL exist under `%APPDATA%\Microsoft\Windows\Start Menu\Programs\`
- **AND** the shortcut target SHALL be `%LOCALAPPDATA%\Programs\PI Dashboard\PI Dashboard.exe`

#### Scenario: Add/Remove Programs entry contents
- **WHEN** installation completes
- **THEN** the Add/Remove Programs entry (under HKCU — per-user only) SHALL contain: DisplayName `PI Dashboard`, Publisher `BlackBelt Technology`, DisplayVersion matching the release version, DisplayIcon pointing at `<install dir>\PI Dashboard.exe`, UninstallString and QuietUninstallString pointing at `<install dir>\Uninstall PI Dashboard.exe`, InstallLocation equal to the actual install dir, EstimatedSize, NoModify=1, NoRepair=1
- **AND** the entry SHALL be visible in Settings → Apps → Installed apps

#### Scenario: Uninstaller preserves user data
- **WHEN** the user runs the uninstaller
- **THEN** it SHALL remove `%LOCALAPPDATA%\Programs\PI Dashboard\` and the Add/Remove Programs entry
- **AND** it SHALL NOT delete `%USERPROFILE%\.pi\` (agent runtime, sessions, settings)
- **AND** it SHALL NOT delete `%USERPROFILE%\.pi-dashboard\` (managed dependencies, version markers)
- **AND** the uninstaller's final page SHALL display a notice that user data has been preserved and how to remove it manually

#### Scenario: Installer artifact naming
- **WHEN** the Windows installer is built
- **THEN** the produced artifact SHALL be named `PI-Dashboard-Setup-${version}-${arch}.exe` (e.g. `PI-Dashboard-Setup-0.5.5-x64.exe`)
- **AND** the artifact SHALL be uploaded to the GitHub Release alongside the `.zip` artifacts
- **AND** the filename SHALL satisfy the marketing-site classifier in `site/src/lib/github-release.ts` such that it is routed to `kind: "Installer (.exe)"` with priority 0

#### Scenario: NSIS compatible with electron-updater
- **WHEN** the app is installed via Setup.exe on Windows
- **THEN** the on-disk layout SHALL be compatible with `electron-updater`'s NSIS differ channel (wiring of the channel itself is out of scope for this requirement; see `fix-electron-auto-update-pipeline`)

### Requirement: CI build matrix
A GitHub Actions workflow SHALL build Electron installers for all target platforms AND every supported (platform, arch) tuple. The matrix SHALL include exactly one row per published artifact; missing rows are a regression.

#### Scenario: CI produces macOS arm64 DMG
- **WHEN** the CI workflow runs on `macos-14` runner
- **THEN** it SHALL produce a `.dmg` for arm64
- **AND** the matrix row SHALL declare `platform: darwin, arch: arm64, node-arch: arm64`

#### Scenario: CI produces macOS x64 DMG
- **WHEN** the CI workflow runs on the GitHub-hosted Intel x86_64 macOS runner (currently `macos-15-intel`; was `macos-13` until its retirement on 2025-12-08)
- **THEN** it SHALL produce a `.dmg` for x64
- **AND** the matrix row SHALL declare `platform: darwin, arch: x64, node-arch: x64`
- **AND** the row SHALL NOT be omitted on the grounds that `forge.config.ts` declares `packagerConfig.arch: "universal"` — the workflow's `--arch=${{ matrix.arch }}` CLI flag overrides packagerConfig and the universal hint is a no-op in the current pipeline
- **AND** when GitHub retires `macos-15-intel` (announced end-of-life 2027-08), the team MUST migrate to a universal-binary build OR a self-hosted Intel runner OR drop x64 macOS support — there will be no GitHub-hosted Intel x86_64 replacement after that date

#### Scenario: CI produces Linux x64 artifacts
- **WHEN** the CI workflow runs on `ubuntu-latest` runner
- **THEN** it SHALL produce an `.AppImage` and `.deb` for x64

#### Scenario: CI produces Linux arm64 artifacts
- **WHEN** the CI workflow runs on `ubuntu-24.04-arm` runner
- **THEN** it SHALL produce a `.deb` for arm64
- **AND** AppImage SHALL be skipped (appimagetool has no arm64 build)

#### Scenario: CI produces Windows x64 NSIS installer
- **WHEN** the CI workflow runs on `windows-latest` runner with `arch: x64`
- **THEN** it SHALL produce a `PI-Dashboard-Setup-${version}-x64.exe` (NSIS) and a ZIP archive
- **AND** it SHALL NOT produce a portable `.exe` (the 7-Zip SFX portable target was removed by this change)

#### Scenario: CI produces Windows arm64 NSIS installer
- **WHEN** the CI workflow runs on `windows-latest` runner with `arch: arm64`
- **THEN** it SHALL produce a `PI-Dashboard-Setup-${version}-arm64.exe` (NSIS) and a ZIP archive
- **AND** it SHALL NOT produce a portable `.exe`
- **AND** arm64 NSIS support SHALL be provided by electron-builder's native arm64 NSIS templating

#### Scenario: CI installs Linux build dependencies
- **WHEN** the CI workflow runs on any Linux runner
- **THEN** it SHALL install `dpkg`, `fakeroot`, `libarchive-tools`, `libfuse2`, and `squashfs-tools` before building

#### Scenario: Per-(platform, arch) artifact upload
- **WHEN** any matrix row completes successfully
- **THEN** its artifacts SHALL be uploaded with name `electron-${platform}-${arch}` so the `github-release` job can collect every distributable

## ADDED Requirements

### Requirement: CI smoke-tests the NSIS installer on the build runner
The `windows-latest` legs that build Setup.exe SHALL smoke-test it on the same runner, after the build, via a `.github/workflows/_electron-build.yml` step (`if: matrix.platform == 'win32'`). Because the installer is per-user (`/S` needs no admin), the smoke runs unprivileged with no VM and no external QA harness. The step SHALL run install, no-per-machine, branding, and uninstall assertions as **hard gates** (fail the job). It SHALL NOT launch the app: `pi-dashboard.exe` is a GUI-subsystem binary and GitHub-hosted runners have no interactive desktop session, so the Electron main process never reaches the server-spawn step (observed: process stays alive, `~/.pi/dashboard/server.log` never created, stdout/stderr empty). Launch + server-start validation is therefore out of scope for the build-runner smoke; it runs on a VM with a real desktop (`qa/tests/07-electron-bootstrap-v2.ps1` + `windows-nsis-launch.ps1` via the `automate-windows-remote-qa` harness) or by manual install.

#### Scenario: each win32 leg runs install→uninstall hard gates
- **WHEN** a `windows-latest` win32 leg finishes building `PI-Dashboard-Setup-${version}-${arch}.exe`
- **THEN** the workflow SHALL run `qa/tests/windows-nsis-install.ps1`, `windows-nsis-no-permachine.ps1`, `windows-nsis-branding.ps1`, and `windows-nsis-uninstall.ps1` as hard gates against the built artifact
- **AND** a hard-gate failure SHALL fail the job
- **AND** the workflow SHALL NOT attempt to launch the app on the runner (no display; GUI Electron cannot start the server headlessly)

#### Scenario: launch / server-start validated off the build runner
- **WHEN** launch / server-start needs verification (e.g. the nodejs#58515 Node-version regression)
- **THEN** it SHALL be validated on a VM with a desktop session via `qa/tests/07-electron-bootstrap-v2.ps1` / `windows-nsis-launch.ps1`, or by manual install
- **AND** the build-runner smoke SHALL NOT be relied upon for server-start coverage

### Requirement: NSIS install location is bootstrap-agnostic
The NSIS install location SHALL NOT be hardcoded anywhere in the bootstrap, server, or shared code. The bootstrap state machine SHALL resolve the running install location dynamically via `app.getPath('exe')` and `process.resourcesPath`. This guarantees the existing `selectLaunchSource()` resolver in `packages/electron/src/lib/launch-source.ts` works identically for the per-user default (`%LOCALAPPDATA%\Programs\PI Dashboard\`) and any user-chosen path like `D:\MyApps\PI Dashboard\`.

#### Scenario: Setup.exe-installed app resolves via existing launch source regardless of install dir
- **WHEN** the user launches `PI Dashboard.exe` from any directory chosen during install (per-user default or user-chosen)
- **THEN** `selectLaunchSource()` SHALL resolve to the same `installed` / `extracted` branch that today's `.zip`-extracted install resolves to
- **AND** no new source kind SHALL be added to handle Setup.exe installs
- **AND** no module under `packages/electron/src/`, `packages/server/src/`, or `packages/shared/src/` SHALL contain a hardcoded path matching `%LOCALAPPDATA%\Programs\PI Dashboard` outside of documentation strings

### Requirement: NSIS appId is stable across releases
The electron-builder NSIS `appId` value SHALL be pinned to `hu.blackbelt.pi-dashboard` and SHALL NOT change between releases once the first NSIS release has shipped. Changing the appId strands users on the old appId (their uninstaller stays registered under the old GUID and the new installer registers a second, parallel entry).

#### Scenario: appId pinned in config
- **WHEN** the electron-builder NSIS config is read
- **THEN** the `appId` field SHALL equal exactly the literal string `hu.blackbelt.pi-dashboard`
- **AND** subsequent releases SHALL use the same value
- **AND** the value SHALL be documented in `docs/release-process.md` as immutable

### Requirement: Pi-branded installer assets
The NSIS installer SHALL display Pi branding throughout the wizard: a Pi-branded installer icon on the Setup.exe binary, a Pi-branded uninstaller icon on the uninstaller binary, a Pi-branded welcome / finish page bitmap (164×314 BMP), a Pi-branded header bitmap on the Choose-Install-Location and Install-progress pages (150×57 BMP), and the branding text `BlackBelt Technology — PI Dashboard` in the bottom-left of every page. Assets SHALL be derived deterministically at build time from a single Pi master asset (`packages/electron/build/installer-assets/master.png`) by `packages/electron/scripts/build-installer-assets.mjs`.

#### Scenario: Installer icon is Pi-branded
- **WHEN** the user views Setup.exe in File Explorer
- **THEN** the icon SHALL be the Pi mark (derived from `master.png`), NOT the electron-builder default electron-logo icon
- **AND** the icon SHALL include multi-resolution entries (16, 24, 32, 48, 64, 128, 256) so Windows can pick the appropriate size for taskbar / file-list / large-icon view

#### Scenario: MUI2 page bitmaps are Pi-branded
- **WHEN** the installer wizard is open on the Welcome or Finish page
- **THEN** the left-edge side bitmap SHALL render as Pi-branded `welcome-banner.bmp` (164×314, 24-bit BMP)
- **WHEN** the installer wizard is on any other page (Choose Install Location, Install Progress)
- **THEN** the top header bitmap SHALL render as Pi-branded `header-banner.bmp` (150×57, 24-bit BMP)

#### Scenario: Uninstaller icon is Pi-branded
- **WHEN** the user views `Uninstall PI Dashboard.exe` in File Explorer
- **THEN** the icon SHALL be the Pi-branded uninstaller variant (derived from `master.png` with deterministic differentiation, e.g. red tint or grayscale), NOT the electron-builder default

#### Scenario: Branding text on every page
- **WHEN** the installer wizard is open on any page
- **THEN** the bottom-left brand area SHALL display `BlackBelt Technology — PI Dashboard` via the NSIS `BrandingText` macro

#### Scenario: Asset derivation is deterministic
- **WHEN** `node packages/electron/scripts/build-installer-assets.mjs` runs against an unchanged `master.png`
- **THEN** the output ICO + BMP files SHALL be byte-identical across runs (deterministic SHA-256)
- **AND** the script SHALL print per-asset SHA-256 so CI can detect master-asset drift

#### Scenario: Branding asset generation runs in CI
- **WHEN** the CI workflow runs the NSIS build step on a `windows-latest` leg
- **THEN** `node packages/electron/scripts/build-installer-assets.mjs` SHALL run before `electron-builder --win nsis`
- **AND** the produced assets in `packages/electron/build/installer-assets/` SHALL be consumed by electron-builder via the `installerIcon` / `uninstallerIcon` / `installerSidebar` / `installerHeader` config keys

### Requirement: NSIS is a CI-only artifact
The Docker cross-build path SHALL produce ZIP only for Windows. NSIS Setup.exe SHALL be produced exclusively by the CI `windows-latest` legs. Local builds on macOS/Linux hosts SHALL NOT attempt to build NSIS (no Wine dependency in `Dockerfile.build`).

#### Scenario: Docker cross-build skips NSIS
- **WHEN** `packages/electron/scripts/docker-make.sh` runs with Windows target
- **THEN** it SHALL produce `PI-Dashboard-win32-${arch}.zip` only
- **AND** it SHALL NOT invoke `electron-builder --win nsis`
- **AND** the script SHALL log a clear message: "Docker path produces ZIP only; NSIS Setup.exe is CI-only (windows-latest)"

#### Scenario: Local Windows-host build optionally produces NSIS
- **WHEN** `packages/electron/scripts/build-windows-zip.sh` runs on a Windows host (`$OSTYPE` matches `msys`, `cygwin`, or equivalent) with the `--with-nsis` flag
- **THEN** it MAY invoke `electron-builder --win nsis` after the ZIP step
- **AND** without `--with-nsis` (or on non-Windows hosts) it SHALL skip NSIS silently
